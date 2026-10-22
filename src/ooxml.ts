/*
 * Word package plumbing: the zip, its XML parts, relationships, content types,
 * styles and the template's {{markers}}.
 *
 * String-level on purpose. A .docx is a handful of XML files, and every edit
 * made here is local — a marker, a style, a relationship appended — so a DOM
 * would buy nothing but a parser the Node tests do not have. Like the
 * generator, this module must not import 'obsidian'.
 */
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate';

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types'
};

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
export const REL_TYPES = {
  officeDocument: REL + 'officeDocument',
  styles: REL + 'styles',
  numbering: REL + 'numbering',
  settings: REL + 'settings',
  footer: REL + 'footer',
  header: REL + 'header',
  hyperlink: REL + 'hyperlink',
  image: REL + 'image',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'
};

const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
export const CONTENT_TYPES = {
  document: WML + 'document.main+xml',
  template: WML + 'template.main+xml',
  styles: WML + 'styles+xml',
  numbering: WML + 'numbering+xml',
  settings: WML + 'settings+xml',
  footer: WML + 'footer+xml',
  header: WML + 'header+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml'
};

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/**
 * Escape text for an XML text node or attribute. Characters XML 1.0 forbids
 * outright (most C0 controls) are dropped: one stray form feed pasted into a
 * note would otherwise make Word refuse the whole file.
 */
export function xmlEscape(s: string): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex -- removing exactly the characters XML forbids
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** The value of `attr` on the first `<tag …>` of `xml`, unescaped. */
export function attrOf(xml: string, tag: string, attr: string): string | null {
  const el = new RegExp(`<${tag}(?:\\s[^>]*)?>`).exec(xml) || new RegExp(`<${tag}(?:\\s[^>]*)?/>`).exec(xml);
  if (!el) return null;
  const m = new RegExp(`\\s${attr}="([^"]*)"`).exec(el[0]);
  return m ? xmlUnescape(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Package                                                             */
/* ------------------------------------------------------------------ */

/** The files of a .docx, by their path inside the zip (no leading slash). */
export class Package {
  readonly files = new Map<string, Uint8Array>();

  static open(bytes: Uint8Array): Package {
    const pkg = new Package();
    for (const [path, data] of Object.entries(unzipSync(bytes))) pkg.files.set(path, data);
    return pkg;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  text(path: string): string | null {
    const data = this.files.get(path);
    return data ? strFromU8(data) : null;
  }

  setText(path: string, xml: string): void {
    this.files.set(path, strToU8(xml));
  }

  setBytes(path: string, data: Uint8Array): void {
    this.files.set(path, data);
  }

  /** The zip, `[Content_Types].xml` first as packages conventionally are. */
  toBytes(): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    const first = '[Content_Types].xml';
    const ct = this.files.get(first);
    if (ct) entries[first] = ct;
    for (const [path, data] of this.files) if (path !== first) entries[path] = data;
    return zipSync(entries, { level: 6 });
  }
}

/** `word/document.xml` -> `word/_rels/document.xml.rels`; `''` -> `_rels/.rels`. */
export function relsPath(part: string): string {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

/** Resolve a relationship target against the folder of its source part. */
export function resolveTarget(part: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out = part.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

/** A part's relationships, read once and written back with what was added. */
export class Relationships {
  readonly list: Relationship[] = [];
  private added: Relationship[] = [];
  private seq = 0;
  private xml: string | null;

  constructor(xml: string | null) {
    this.xml = xml;
    const re = /<Relationship\s[^>]*?\/?>/g;
    for (const m of (xml || '').matchAll(re)) {
      const get = (a: string) => {
        const v = new RegExp(`\\s${a}="([^"]*)"`).exec(m[0]);
        return v ? xmlUnescape(v[1]) : '';
      };
      this.list.push({ id: get('Id'), type: get('Type'), target: get('Target'), external: get('TargetMode') === 'External' });
    }
  }

  ofType(type: string): Relationship[] {
    return this.list.filter((r) => r.type === type);
  }

  /** Add a relationship and return its id, unique among the existing ones. */
  add(type: string, target: string, external = false): string {
    const taken = new Set(this.list.map((r) => r.id));
    let id: string;
    do id = `rIdReport${++this.seq}`; while (taken.has(id));
    const rel = { id, type, target, external };
    this.list.push(rel);
    this.added.push(rel);
    return id;
  }

  toXml(): string {
    const line = (r: Relationship) =>
      `<Relationship Id="${xmlEscape(r.id)}" Type="${xmlEscape(r.type)}" Target="${xmlEscape(r.target)}"` +
      (r.external ? ' TargetMode="External"/>' : '/>');
    if (this.xml && /<\/Relationships>/.test(this.xml)) {
      return this.xml.replace(/<\/Relationships>\s*$/, this.added.map(line).join('') + '</Relationships>');
    }
    return `${XML_DECL}<Relationships xmlns="${NS.rels}">${this.list.map(line).join('')}</Relationships>`;
  }
}

/** `[Content_Types].xml`, with a Default per extension and an Override per part. */
export class ContentTypes {
  private xml: string;

  constructor(xml: string) {
    this.xml = xml;
  }

  ensureDefault(ext: string, type: string): void {
    if (new RegExp(`<Default\\s[^>]*Extension="${ext}"`, 'i').test(this.xml)) return;
    this.xml = this.xml.replace('</Types>', `<Default Extension="${ext}" ContentType="${type}"/></Types>`);
  }

  /** Set the content type of a part, replacing the one it had. */
  setOverride(part: string, type: string): void {
    const name = '/' + part;
    const re = new RegExp(`<Override\\s[^>]*PartName="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'i');
    const line = `<Override PartName="${name}" ContentType="${type}"/>`;
    this.xml = re.test(this.xml) ? this.xml.replace(re, line) : this.xml.replace('</Types>', line + '</Types>');
  }

  toXml(): string {
    return this.xml;
  }
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

export type StyleType = 'paragraph' | 'character' | 'table' | 'numbering';

export interface StyleInfo {
  id: string;
  /**
   * The internal name, which is the same whatever the language of Word that
   * saved the file: `heading 1` is `Heading1` in English Word and `Titre1` in
   * French Word, but always named `heading 1`.
   */
  name: string;
  type: StyleType;
  /** Carries its own numbering (`w:numPr`), as numbered heading styles do. */
  numbered: boolean;
}

export function parseStyles(xml: string): StyleInfo[] {
  const out: StyleInfo[] = [];
  for (const m of xml.matchAll(/<w:style\s[^>]*>[\s\S]*?<\/w:style>/g)) {
    const open = /^<w:style\s[^>]*>/.exec(m[0])?.[0] || '';
    const type = /\sw:type="([^"]*)"/.exec(open)?.[1] as StyleType | undefined;
    const id = /\sw:styleId="([^"]*)"/.exec(open)?.[1];
    if (!type || !id) continue;
    const name = /<w:name\s+w:val="([^"]*)"/.exec(m[0])?.[1];
    out.push({
      id: xmlUnescape(id),
      name: xmlUnescape(name ?? id),
      type,
      numbered: /<w:numPr>[\s\S]*?<w:numId\s/.test(m[0])
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

/** What a marker becomes: plain text, or a run of its own (bold, coloured). */
export interface MarkerValue {
  text: string;
  bold?: boolean;
  /** RRGGBB, no '#'. */
  color?: string;
}

/**
 * A paragraph with no paragraph nested inside it. A text box on a cover holds
 * whole paragraphs inside a run of its parent, and those inner paragraphs are
 * where its markers are.
 */
const PARA_RE = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g;
const T_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
const RUN_START_RE = /<w:r(?:\s[^>]*)?>/g;
const MARKER_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

interface TextNode {
  /** Where the whole `<w:t>…</w:t>` element starts and ends in the paragraph. */
  from: number;
  to: number;
  text: string;
  /** The opening tag and properties of the run holding it. */
  runTag: string;
  rPr: string;
}

function textNodes(p: string): TextNode[] {
  const runs = [...p.matchAll(RUN_START_RE)];
  return [...p.matchAll(T_RE)].map((m) => {
    const from = m.index ?? 0;
    const run = runs.filter((r) => (r.index ?? 0) < from).pop();
    const runTag = run ? run[0] : '<w:r>';
    const after = run ? p.slice((run.index ?? 0) + run[0].length) : '';
    const rPr = /^<w:rPr\s*\/>|^<w:rPr>[\s\S]*?<\/w:rPr>/.exec(after)?.[0] || '';
    return { from, to: from + m[0].length, text: xmlUnescape(m[1]), runTag, rPr };
  });
}

/** The text of a paragraph, its runs joined. */
export function paragraphText(p: string): string {
  return textNodes(p).map((n) => n.text).join('');
}

/** Elements of CT_RPr that come after `w:b` and `w:color`, in schema order. */
const AFTER_COLOR = [
  'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr',
  'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'
];
const AFTER_BOLD = [
  'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss',
  'w:imprint', 'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', ...AFTER_COLOR
];

/** Insert `el` into run properties before the first of `before`, keeping schema order. */
function insertProp(rPr: string, el: string, before: string[]): string {
  const body = rPr.replace(/^<w:rPr\s*\/>$/, '<w:rPr></w:rPr>');
  const inner = body.slice('<w:rPr>'.length, -'</w:rPr>'.length);
  const at = before
    .map((tag) => new RegExp(`<${tag}[\\s/>]`).exec(inner)?.index ?? -1)
    .filter((i) => i >= 0)
    .sort((x, y) => x - y)[0];
  return '<w:rPr>' + (at === undefined ? inner + el : inner.slice(0, at) + el + inner.slice(at)) + '</w:rPr>';
}

/** Run properties with bold and a colour set, whatever the run had. */
export function withRunProps(rPr: string, v: { bold?: boolean; color?: string }): string {
  let out = rPr || '<w:rPr></w:rPr>';
  if (v.color) {
    out = /<w:color\s/.test(out)
      ? out.replace(/<w:color\s[^>]*\/>/, `<w:color w:val="${v.color}"/>`)
      : insertProp(out, `<w:color w:val="${v.color}"/>`, AFTER_COLOR);
  }
  if (v.bold && !/<w:b\s*\/>|<w:b\s+w:val="(?:1|true|on)"/.test(out)) {
    out = insertProp(out.replace(/<w:b\s[^>]*\/>/, ''), '<w:b/>', AFTER_BOLD);
  }
  return out;
}

const tNode = (s: string) => `<w:t xml:space="preserve">${xmlEscape(s)}</w:t>`;

/**
 * Replace the markers of one paragraph.
 *
 * Word often splits a marker over several runs — `{{ti` + `tle}}` after a
 * spell check, or a bold first letter — so the runs' text is joined, markers
 * are found in the joined text, and each run then gets back its own share of
 * the result. A marker's value lands in the run where the marker began, and
 * keeps that run's formatting.
 */
function fillParagraph(p: string, fill: (name: string) => MarkerValue | null): string {
  const nodes = textNodes(p);
  const joined = nodes.map((n) => n.text).join('');
  if (!joined.includes('{{')) return p;

  const hits = [...joined.matchAll(MARKER_RE)]
    .map((m) => ({ at: m.index ?? 0, len: m[0].length, value: fill(m[1].toLowerCase()) }))
    .filter((h): h is { at: number; len: number; value: MarkerValue } => h.value !== null);
  if (!hits.length) return p;

  const owner: number[] = [];
  nodes.forEach((n, i) => { for (let k = 0; k < n.text.length; k++) owner.push(i); });
  const pieces: (string | MarkerValue)[][] = nodes.map(() => []);
  const push = (i: number, s: string) => {
    const list = pieces[i];
    const last = list[list.length - 1];
    if (typeof last === 'string') list[list.length - 1] = last + s;
    else list.push(s);
  };
  let k = 0;
  let h = 0;
  while (k < joined.length) {
    const hit = hits[h];
    if (hit && hit.at === k) {
      const { value } = hit;
      if (value.bold || value.color) pieces[owner[k]].push(value);
      else push(owner[k], value.text);
      k += hit.len;
      h++;
      continue;
    }
    push(owner[k], joined[k]);
    k++;
  }

  let out = p;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const xml = pieces[i].length
      ? pieces[i]
          .map((piece) =>
            typeof piece === 'string'
              ? tNode(piece)
              : `</w:r><w:r>${withRunProps(n.rPr, piece)}${tNode(piece.text)}</w:r>${n.runTag}${n.rPr}`)
          .join('')
      : '<w:t xml:space="preserve"></w:t>';
    out = out.slice(0, n.from) + xml + out.slice(n.to);
  }
  return out;
}

/** Replace the markers `fill` knows in every paragraph of a part. */
export function fillMarkers(xml: string, fill: (name: string) => MarkerValue | null): string {
  return xml.replace(PARA_RE, (p) => fillParagraph(p, fill));
}

/**
 * Split a part around the paragraph that holds only `{{name}}` — `{{content}}`
 * for the report, `{{toc}}` for the table of contents — so something else
 * goes in its place. Null when there is no such paragraph.
 */
export function splitAtMarker(xml: string, name: string): { before: string; after: string } | null {
  const only = new RegExp(`^\\{\\{\\s*${name}\\s*\\}\\}$`, 'i');
  for (const m of xml.matchAll(PARA_RE)) {
    if (only.test(paragraphText(m[0]).trim())) {
      const at = m.index ?? 0;
      return { before: xml.slice(0, at), after: xml.slice(at + m[0].length) };
    }
  }
  return null;
}

/** Elements of CT_Settings that come after `w:updateFields`, in schema order. */
const AFTER_UPDATE_FIELDS = [
  'w:hdrShapeDefaults', 'w:footnotePr', 'w:endnotePr', 'w:compat', 'w:docVars', 'w:rsids', 'm:mathPr',
  'w:attachedSchema', 'w:themeFontLang', 'w:clrSchemeMapping', 'w:doNotIncludeSubdocsInStats',
  'w:doNotAutoCompressPictures', 'w:forceUpgrade', 'w:captions', 'w:readModeInkLockDown', 'w:smartTagType',
  'sl:schemaLibrary', 'w:shapeDefaults', 'w:doNotEmbedSmartTags', 'w:decimalSymbol', 'w:listSeparator'
];

/**
 * Ask Word to update the document's fields when it opens it, which is what
 * fills in the page numbers of a table of contents. Word asks the reader to
 * confirm first.
 */
export function withUpdateFields(settings: string): string {
  if (/<w:updateFields\s/.test(settings)) return settings.replace(/<w:updateFields\s[^>]*\/>/, '<w:updateFields w:val="true"/>');
  const at = AFTER_UPDATE_FIELDS
    .map((tag) => new RegExp(`<${tag}[\\s/>]`).exec(settings)?.index ?? -1)
    .filter((i) => i >= 0)
    .sort((x, y) => x - y)[0];
  const el = '<w:updateFields w:val="true"/>';
  if (at !== undefined) return settings.slice(0, at) + el + settings.slice(at);
  return settings.replace(/<\/w:settings>\s*$/, el + '</w:settings>');
}

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A one-pixel PNG of a solid colour. Stretched by Word to any size, it draws
 * the bands and rules of the built-in decoration without a drawing API.
 */
export function solidPng(rgb: string): Uint8Array {
  const n = parseInt(rgb, 16) || 0;
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    body.set(strToU8(type), 0);
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = zlibSync(new Uint8Array([0, (n >> 16) & 255, (n >> 8) & 255, n & 255]));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The bytes and Word extension of an image data URL, or null for a type Word cannot show. */
export function parseDataUrl(url: string | null | undefined): { bytes: Uint8Array; ext: string } | null {
  const m = /^data:image\/([a-z+]+);base64,(.*)$/is.exec(String(url ?? ''));
  const ext = m ? ({ png: 'png', jpeg: 'jpeg', jpg: 'jpeg', gif: 'gif', 'svg+xml': 'svg' } as Record<string, string>)[m[1].toLowerCase()] : undefined;
  if (!m || !ext) return null;
  const bin = atob(m[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext };
}

/** Declare a namespace prefix on the root element if it is not declared yet. */
export function ensureRootNs(xml: string, prefix: string, uri: string): string {
  const root = /<(?!\?)[A-Za-z][\w:.-]*(?:\s[^>]*)?>/.exec(xml);
  if (!root || root[0].includes(`xmlns:${prefix}=`)) return xml;
  const tag = root[0].endsWith('/>') ? root[0].slice(0, -2) : root[0].slice(0, -1);
  const end = root[0].endsWith('/>') ? '/>' : '>';
  const at = root.index ?? 0;
  return xml.slice(0, at) + `${tag} xmlns:${prefix}="${uri}"${end}` + xml.slice(at + root[0].length);
}
