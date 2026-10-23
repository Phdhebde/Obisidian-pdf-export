/*
 * PDF Report Exporter — Word engine (environment-agnostic, beta).
 *
 * Exposes:
 *   buildDocx(md, vars, preset, options) -> .docx bytes, and what went wrong
 *   listWordStyles(template)             -> the styles a Word template offers
 *   calloutIcons(preset)                 -> the icons a host may rasterise
 *
 * The report fills a Word template. With the company's own .dotx or .docx,
 * its cover, headers, footers, theme and styles stay as they are: markers
 * such as {{title}} are replaced, the report goes where {{content}} stands and
 * a table of contents where {{toc}} does. Without one, the document is laid
 * out like the PDF — cover, banded pages, references, TLP reminder, table of
 * contents — in the PDF template's colours, with its artwork when it has some.
 * Either way the body is styled through named Word styles (`heading 1`,
 * `caption`…), so a template's own styles win.
 *
 * Like generator.ts, it runs in Node for the tests and must not import
 * 'obsidian'. Anything that needs a browser — rasterising a diagram or an
 * icon — is done by the host and handed in.
 */
import { marked } from 'marked';
import {
  CALLOUT_STYLES,
  CAPTION_RE,
  IMAGE_REF_RE,
  bodySize,
  decodeEntities,
  defaultLabels,
  defaultToc,
  diagramKey,
  fitCoverTitle,
  headingLabel,
  isMermaidLang,
  isPageBreakToken,
  lex,
  listColumns,
  reportTlp,
  resolveSections,
  tint,
  tlpColor,
  type MdToken
} from './generator.ts';
import { columnsLang, parseColBlock, parseColMd } from './columns.ts';
import { iconSvg, type IconName } from './icons.ts';
import { parseCallout } from './textScan.ts';
import { fitTable, type TableCell } from './tableLayout.ts';
import { imageSize } from './imageSize.ts';
import { getLocale, t as tr } from './i18n.ts';
import { MARK_END_RE, MARK_START_RE, PHRASE_MARK_ATTR } from './redact.ts';
import {
  CONTENT_TYPES,
  ContentTypes,
  NS,
  Package,
  REL_TYPES,
  Relationships,
  XML_DECL,
  attrOf,
  ensureRootNs,
  fillMarkers,
  parseDataUrl,
  parseStyles,
  relsPath,
  resolveTarget,
  solidPng,
  splitAtMarker,
  withUpdateFields,
  xmlEscape,
  type MarkerValue,
  type StyleInfo,
  type StyleType
} from './ooxml.ts';
import { HEADING_LEVELS, type DocContact, type Preset, type ReportVars, type TlpKey, type WordRole } from './types.ts';

/** A drawing the host rasterised: the PNG every Word shows, the SVG recent ones prefer. */
export interface RasterImage {
  /** PNG data URL. */
  png: string;
  /** Standalone SVG, embedded alongside so Word 2016 and later draw vectors. */
  svg?: string;
  /** Natural size in CSS pixels. */
  width: number;
  height: number;
}

export interface DocxOptions {
  /** Images the Markdown references as `report-image:<name>`: name -> data URL. */
  images?: Record<string, string>;
  /** The Word template's bytes, or null to generate the document. */
  template?: Uint8Array | null;
  /** Fallback for {{date}} when the note's versions carry none. */
  date?: string;
  /** Mermaid diagrams, keyed by their source. */
  diagrams?: Record<string, RasterImage>;
  /** Callout icons, keyed by `calloutIconKey`. */
  icons?: Record<string, RasterImage>;
  /** The note's own logo, as a data URL; it wins over the template's. */
  clientLogo?: string | null;
}

export interface DocxResult {
  bytes: Uint8Array;
  warnings: string[];
}

/** Raised for a template the engine cannot fill; its message is shown as is. */
export class WordTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WordTemplateError';
  }
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

/** A4 in points, then in twips. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PAGE_W_TW = 11906;
const PAGE_H_TW = 16838;

const tw = (pt: number) => Math.round(pt * 20);
const EMU_PER_PT = 12700;
const EMU_PER_PX = 9525;
const EMU_PER_TWIP = 635;
/** Half-points, the unit of `w:sz`. */
const hp = (pt: number) => Math.max(2, Math.round(pt * 2));

/** `#1F5F8B` -> `1F5F8B`; anything unreadable -> `fallback`. */
function hex(color: string | undefined, fallback = '000000'): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color ?? '').trim());
  return m ? m[1].toUpperCase() : fallback;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

/** The style each role uses unless the template's settings name another. */
export const DEFAULT_WORD_STYLES: Record<WordRole, { name: string; type: StyleType }> = {
  title: { name: 'Title', type: 'paragraph' },
  subtitle: { name: 'Subtitle', type: 'paragraph' },
  body: { name: 'Normal', type: 'paragraph' },
  heading1: { name: 'heading 1', type: 'paragraph' },
  heading2: { name: 'heading 2', type: 'paragraph' },
  heading3: { name: 'heading 3', type: 'paragraph' },
  heading4: { name: 'heading 4', type: 'paragraph' },
  heading5: { name: 'heading 5', type: 'paragraph' },
  heading6: { name: 'heading 6', type: 'paragraph' },
  listParagraph: { name: 'List Paragraph', type: 'paragraph' },
  caption: { name: 'caption', type: 'paragraph' },
  // Word's own built-in names, so Word recognises them as its styles.
  code: { name: 'HTML Preformatted', type: 'paragraph' },
  inlineCode: { name: 'HTML Code', type: 'character' },
  hyperlink: { name: 'Hyperlink', type: 'character' },
  table: { name: 'Table Grid', type: 'table' },
  // Titles of the pages around the body. Not headings: they stay out of the
  // table of contents, as in the PDF.
  sectionTitle: { name: 'Report Section Title', type: 'paragraph' },
  sectionSubtitle: { name: 'Report Section Subtitle', type: 'paragraph' },
  tocHeading: { name: 'TOC Heading', type: 'paragraph' },
  toc1: { name: 'toc 1', type: 'paragraph' },
  toc2: { name: 'toc 2', type: 'paragraph' },
  toc3: { name: 'toc 3', type: 'paragraph' },
  toc4: { name: 'toc 4', type: 'paragraph' },
  toc5: { name: 'toc 5', type: 'paragraph' },
  toc6: { name: 'toc 6', type: 'paragraph' }
};

/**
 * The bundled PDF fonts have no business in a Word file, which only shows
 * fonts the reader has installed: each maps to the common font it imitates.
 */
const WORD_FONTS: Record<string, string> = {
  Liberation: 'Arial',
  Archivo: 'Arial Black',
  LiberationMono: 'Consolas'
};

function wordFont(key: string, fallback: string): string {
  return WORD_FONTS[key] || fallback;
}

const fontEl = (name: string) => `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}"/>`;
const sizeEl = (pt: number) => `<w:sz w:val="${hp(pt)}"/><w:szCs w:val="${hp(pt)}"/>`;

/**
 * The definition of a style the template lacks, drawn from the PDF template:
 * same colours, same sizes relative to the body, the nearest common fonts.
 */
function styleBody(role: WordRole, preset: Preset): { pPr?: string; rPr?: string; extra?: string } {
  const B = bodySize(preset);
  const C = preset.colors;
  const F = preset.fonts;
  const heading = wordFont(F.headingFont, 'Arial Black');
  const mono = wordFont(F.monoFont, 'Consolas');
  const h = (level: number | null, rPr: string, before: number, after: number) => ({
    pPr: `<w:keepNext/><w:keepLines/><w:spacing w:before="${tw(before)}" w:after="${tw(after)}"/><w:jc w:val="left"/>` +
      (level === null ? '' : `<w:outlineLvl w:val="${level}"/>`),
    rPr
  });
  const toc = (level: number, rPr: string, before: number) => ({
    pPr: `<w:spacing w:before="${tw(before)}" w:after="${tw(2)}"/><w:ind w:left="${tw([0, 16, 30, 44, 58, 72][level])}"/><w:jc w:val="left"/>`,
    rPr
  });
  switch (role) {
    case 'body':
      return {
        pPr: `<w:spacing w:after="${tw(8)}" w:line="${Math.round(240 * 1.22)}" w:lineRule="auto"/><w:jc w:val="${preset.justify === false ? 'left' : 'both'}"/>`,
        rPr: `${fontEl(wordFont(F.bodyFont, 'Arial'))}<w:color w:val="${hex(C.text)}"/>${sizeEl(B)}`
      };
    case 'title':
      return { pPr: '<w:spacing w:before="0" w:after="0"/><w:jc w:val="left"/>', rPr: `${fontEl(heading)}<w:color w:val="141414"/>` };
    case 'subtitle':
      return { pPr: '<w:spacing w:before="0" w:after="0"/><w:jc w:val="left"/>', rPr: '<w:color w:val="222222"/>' };
    case 'heading1': return h(0, `${fontEl(heading)}<w:color w:val="${hex(C.brand)}"/>${sizeEl(B * 2)}`, 16, 8);
    case 'heading2': return h(1, `<w:b/><w:bCs/><w:color w:val="000000"/>${sizeEl(B + 3)}`, 12, 5);
    case 'heading3': return h(2, '<w:b/><w:bCs/><w:color w:val="000000"/>', 8, 4);
    case 'heading4': return h(3, '<w:b/><w:bCs/><w:i/><w:iCs/><w:color w:val="000000"/>', 6, 3);
    case 'heading5': return h(4, `<w:b/><w:bCs/><w:color w:val="333333"/>${sizeEl(B - 1)}`, 6, 3);
    case 'heading6': return h(5, `<w:i/><w:iCs/><w:color w:val="555555"/>${sizeEl(B - 1)}`, 5, 3);
    case 'sectionTitle': return h(null, `${fontEl(heading)}<w:color w:val="${hex(C.brand)}"/>${sizeEl(B * 2)}`, 0, 8);
    case 'sectionSubtitle': return h(null, `${fontEl(heading)}<w:color w:val="000000"/>${sizeEl(B + 5)}`, 12, 6);
    case 'tocHeading': return h(null, `<w:b/><w:bCs/><w:color w:val="${hex(C.tocTitle)}"/>${sizeEl(B + 5)}`, 0, 12);
    case 'toc1': return toc(0, `<w:b/><w:bCs/><w:color w:val="${hex(C.brand)}"/>${sizeEl(B + 1)}`, 6);
    case 'toc2': return toc(1, '<w:color w:val="000000"/>', 1);
    case 'toc3': return toc(2, '<w:color w:val="000000"/>', 1);
    case 'toc4': return toc(3, '<w:color w:val="000000"/>', 1);
    case 'toc5': return toc(4, '<w:color w:val="000000"/>', 1);
    case 'toc6': return toc(5, '<w:color w:val="000000"/>', 1);
    case 'listParagraph':
      return { pPr: `<w:spacing w:after="${tw(3)}"/><w:ind w:left="720"/><w:contextualSpacing/><w:jc w:val="left"/>` };
    case 'caption':
      return {
        pPr: `<w:spacing w:before="${tw(4)}" w:after="${tw(12)}"/><w:jc w:val="center"/>`,
        rPr: `<w:i/><w:iCs/><w:color w:val="555555"/>${sizeEl(B - 2)}`
      };
    case 'code':
      // Never justified: stretched spaces break a command copied out of the file.
      return {
        pPr: `<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:spacing w:before="${tw(4)}" w:after="${tw(10)}" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>`,
        rPr: `${fontEl(mono)}<w:color w:val="2A2A2A"/>${sizeEl(B - 1.5)}`
      };
    case 'inlineCode':
      return { rPr: `${fontEl(mono)}${sizeEl(B - 1.5)}<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>` };
    case 'hyperlink':
      return { rPr: `<w:color w:val="${hex(C.link)}"/><w:u w:val="single"/>` };
    case 'table': {
      const border = (side: string) => `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="${hex(C.tableBorder)}"/>`;
      return {
        extra:
          `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>` +
          `<w:rPr><w:color w:val="333333"/>${sizeEl(B - 1)}</w:rPr>` +
          `<w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
          '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
          `<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${hex(C.tableBodyBg, 'FFFFFF')}"/></w:tcPr>` +
          `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/><w:color w:val="${hex(C.tableHeaderText, 'FFFFFF')}"/></w:rPr>` +
          `<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${hex(C.tableHeaderBg)}"/></w:tcPr></w:tblStylePr>`
      };
    }
  }
}

/**
 * The styles the body uses, looked up in the template by internal name.
 *
 * A style the template does not have is added to it, drawn from the PDF
 * template. That is routine rather than worth a warning: Word itself only
 * writes a built-in style such as `caption` or `Table Grid` into a file once
 * it is used, so most templates lack several of them.
 */
class StyleBook {
  private byName = new Map<string, StyleInfo>();
  private ids = new Set<string>();
  private added: string[] = [];
  readonly unknown: string[] = [];
  private xml: string;
  private preset: Preset;
  private names: Partial<Record<WordRole, string>>;

  constructor(xml: string, preset: Preset, names: Partial<Record<WordRole, string>>) {
    this.xml = xml;
    this.preset = preset;
    this.names = names;
    for (const s of parseStyles(xml)) {
      this.ids.add(s.id);
      const key = s.name.toLowerCase();
      if (!this.byName.has(key)) this.byName.set(key, s);
    }
  }

  private find(name: string, type: StyleType): StyleInfo | null {
    const s = this.byName.get(name.trim().toLowerCase());
    return s && s.type === type ? s : null;
  }

  /** The style of a role: the one the settings name, else the default, created when missing. */
  get(role: WordRole): StyleInfo {
    const def = DEFAULT_WORD_STYLES[role];
    const wanted = this.names[role];
    if (wanted) {
      const hit = this.find(wanted, def.type);
      if (hit) return hit;
      if (!this.unknown.includes(wanted)) this.unknown.push(wanted);
    }
    return this.find(def.name, def.type) || this.create(role);
  }

  id(role: WordRole): string {
    return this.get(role).id;
  }

  private create(role: WordRole): StyleInfo {
    const { name, type } = DEFAULT_WORD_STYLES[role];
    const base = name.replace(/(^|\s)(\w)/g, (_m, _s: string, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
    let id = base;
    for (let n = 2; this.ids.has(id); n++) id = base + n;
    this.ids.add(id);

    const body = styleBody(role, this.preset);
    const isDefault = role === 'body' && !parseStyles(this.xml).some((s) => s.type === 'paragraph');
    const basedOn = type === 'paragraph' && role !== 'body' ? `<w:basedOn w:val="${this.id('body')}"/>` : '';
    const next = /^heading|^title|^subtitle|^section|^tocHeading/.test(role) ? `<w:next w:val="${this.id('body')}"/>` : '';
    const hidden = role === 'hyperlink' || /^toc\d/.test(role) ? '<w:uiPriority w:val="39"/><w:unhideWhenUsed/>' : '';
    this.added.push(
      `<w:style w:type="${type}"${isDefault ? ' w:default="1"' : ''} w:styleId="${xmlEscape(id)}">` +
        `<w:name w:val="${xmlEscape(name)}"/>${basedOn}${next}${hidden}<w:qFormat/>` +
        (body.pPr ? `<w:pPr>${body.pPr}</w:pPr>` : '') +
        (body.rPr ? `<w:rPr>${body.rPr}</w:rPr>` : '') +
        (body.extra || '') +
        '</w:style>'
    );
    const info: StyleInfo = { id, name, type, numbered: false };
    this.byName.set(name.toLowerCase(), info);
    return info;
  }

  toXml(): string {
    return this.added.length ? this.xml.replace(/<\/w:styles>\s*$/, this.added.join('') + '</w:styles>') : this.xml;
  }
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

const BULLETS = ['•', '◦', '▪'];

/**
 * List numbering, appended to the template's own. Every list gets a numbering
 * instance of its own, so an ordered list starts again from its first number
 * instead of continuing the previous one.
 */
class NumberingBook {
  private nextAbstract: number;
  private nextNum: number;
  private abstracts: string[] = [];
  private nums: string[] = [];
  private bullet: number | null = null;
  private ordered: number | null = null;
  private xml: string | null;

  constructor(xml: string | null) {
    this.xml = xml;
    const ids = (re: RegExp) => [...(xml || '').matchAll(re)].map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
    this.nextAbstract = Math.max(-1, ...ids(/<w:abstractNum\s[^>]*w:abstractNumId="(\d+)"/g)) + 1;
    this.nextNum = Math.max(0, ...ids(/<w:num\s[^>]*w:numId="(\d+)"/g)) + 1;
  }

  get used(): boolean {
    return this.nums.length > 0;
  }

  private abstract(ordered: boolean): number {
    const have = ordered ? this.ordered : this.bullet;
    if (have !== null) return have;
    const id = this.nextAbstract++;
    const levels = Array.from({ length: 9 }, (_, i) => {
      // Numbers at every depth, as in the PDF.
      const fmt = ordered ? 'decimal' : 'bullet';
      const text = ordered ? `%${i + 1}.` : BULLETS[i % 3];
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>` +
        `<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    });
    this.abstracts.push(
      `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels.join('')}</w:abstractNum>`
    );
    if (ordered) this.ordered = id;
    else this.bullet = id;
    return id;
  }

  /** A new list instance, its first level starting at `start`. */
  list(ordered: boolean, start = 1): number {
    const abs = this.abstract(ordered);
    const id = this.nextNum++;
    const overrides = Array.from({ length: 9 }, (_, i) =>
      `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="${i === 0 ? Math.max(0, start) : 1}"/></w:lvlOverride>`);
    this.nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${abs}"/>${overrides.join('')}</w:num>`);
    return id;
  }

  /** The numbering part; every abstract definition comes before any instance. */
  toXml(): string {
    const xml = this.xml || `${XML_DECL}<w:numbering xmlns:w="${NS.w}"></w:numbering>`;
    const abstracts = this.abstracts.join('');
    const firstNum = /<w:num\s/.exec(xml);
    const withAbstracts = firstNum
      ? xml.slice(0, firstNum.index) + abstracts + xml.slice(firstNum.index)
      : xml.replace(/<\/w:numbering>\s*$/, abstracts + '</w:numbering>');
    return withAbstracts.replace(/<\/w:numbering>\s*$/, this.nums.join('') + '</w:numbering>');
  }
}

/* ------------------------------------------------------------------ */
/* Media and pictures                                                  */
/* ------------------------------------------------------------------ */

/**
 * The media of the package. A file is written once however often it is used,
 * and each part that shows it gets one relationship to it: a header's
 * pictures are related from the header, not from the document.
 */
class MediaBook {
  private files = new Map<string, string>();
  private perPart = new Map<Relationships, Map<string, string>>();
  readonly types = new Set<string>();
  private pkg: Package;
  private dir: string;

  constructor(pkg: Package, dir: string) {
    this.pkg = pkg;
    this.dir = dir;
  }

  add(rels: Relationships, key: string, bytes: Uint8Array, ext: string): string {
    let target = this.files.get(key);
    if (!target) {
      target = `media/report-image${this.files.size + 1}.${ext}`;
      this.pkg.setBytes(this.dir + target, bytes);
      this.files.set(key, target);
      this.types.add(ext);
    }
    let ids = this.perPart.get(rels);
    if (!ids) this.perPart.set(rels, (ids = new Map<string, string>()));
    let id = ids.get(key);
    if (!id) ids.set(key, (id = rels.add(REL_TYPES.image, target)));
    return id;
  }
}

interface Picture {
  /** Relationship id of the PNG (or JPEG, GIF). */
  id: string;
  /** Relationship id of an SVG drawn instead where Word can. */
  svg?: string;
  cx: number;
  cy: number;
  alt?: string;
  /** Placed on the page behind the text instead of in the line. */
  anchor?: { x: number; y: number };
}

/** The extension that carries an SVG alongside its PNG fallback (Office 2016). */
const SVG_BLIP_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const SVG_NS = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';

function pictureRun(p: Picture, w: W): string {
  const n = w.ids.drawing++;
  const cx = Math.max(1, Math.round(p.cx));
  const cy = Math.max(1, Math.round(p.cy));
  const alt = xmlEscape(p.alt || '');
  const blip = p.svg
    ? `<a:blip r:embed="${p.id}"><a:extLst><a:ext uri="${SVG_BLIP_EXT}"><asvg:svgBlip xmlns:asvg="${SVG_NS}" r:embed="${p.svg}"/></a:ext></a:extLst></a:blip>`
    : `<a:blip r:embed="${p.id}"/>`;
  const graphic =
    `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${NS.pic}"><pic:pic xmlns:pic="${NS.pic}">` +
    `<pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic>';
  const docPr = `<wp:docPr id="${n}" name="Picture ${n}" descr="${alt}"/>`;
  const drawing = p.anchor
    ? `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + n}" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1" xmlns:wp="${NS.wp}">` +
      '<wp:simplePos x="0" y="0"/>' +
      `<wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(p.anchor.x)}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(p.anchor.y)}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>${docPr}` +
      `<wp:cNvGraphicFramePr/>${graphic}</wp:anchor>`
    : `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="${NS.wp}"><wp:extent cx="${cx}" cy="${cy}"/>${docPr}` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS.a}" noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic}</wp:inline>`;
  return `<w:r><w:drawing>${drawing}</w:drawing></w:r>`;
}

/** A host-rasterised drawing as a picture: PNG for every Word, SVG for those that can. */
function rasterPicture(img: RasterImage, key: string, rels: Relationships, w: W): Omit<Picture, 'cx' | 'cy'> | null {
  const png = parseDataUrl(img.png);
  if (!png) return null;
  const id = w.media.add(rels, key + ':png', png.bytes, png.ext);
  const svg = img.svg ? w.media.add(rels, key + ':svg', new TextEncoder().encode(img.svg), 'svg') : undefined;
  return { id, svg };
}

/** A solid rectangle on the page, behind the text, in points from the top-left corner. */
function rect(color: string, x: number, y: number, width: number, height: number, rels: Relationships, w: W): string {
  const rgb = hex(color);
  const id = w.media.add(rels, 'solid:' + rgb, solidPng(rgb), 'png');
  return pictureRun({ id, cx: width * EMU_PER_PT, cy: height * EMU_PER_PT, anchor: { x: x * EMU_PER_PT, y: y * EMU_PER_PT } }, w);
}

/** A data-URL image placed on the page, `width` points wide, its height from its proportions. */
function placedImage(url: string, key: string, x: number, y: number, width: number, height: number | null, rels: Relationships, w: W): string {
  const img = parseDataUrl(url);
  if (!img || img.ext === 'svg') return '';
  const size = imageSize(img.bytes);
  const h = height ?? (size && size.w ? (width * size.h) / size.w : width);
  const id = w.media.add(rels, key, img.bytes, img.ext);
  return pictureRun({ id, cx: width * EMU_PER_PT, cy: h * EMU_PER_PT, anchor: { x: x * EMU_PER_PT, y: y * EMU_PER_PT } }, w);
}

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

interface TocEntry {
  level: number;
  text: string;
  bookmark: string;
}

interface W {
  preset: Preset;
  styles: StyleBook;
  /** Relationships of the main part. */
  rels: Relationships;
  numbering: NumberingBook;
  media: MediaBook;
  images: Record<string, string>;
  diagrams: Map<string, RasterImage>;
  icons: Record<string, RasterImage>;
  /** Text width in twips. */
  width: number;
  counters: number[];
  /**
   * Ids shared by every nested context and kept clear of the low ones a
   * template uses: two pictures or bookmarks with one id make Word repair the file.
   */
  ids: { drawing: number; bookmark: number };
  /** Headings met so far, for the table of contents. */
  toc: TocEntry[];
  warnings: Set<string>;
  /** At the top level of the body, where headings may open a new page. */
  top: boolean;
  /** Something was written already, and the last block was not a heading. */
  breakable: boolean;
}

/** Paragraph properties, written in the order the schema requires. */
interface PPr {
  style?: string;
  keepNext?: boolean;
  pageBreakBefore?: boolean;
  num?: { id: number; level: number };
  border?: string;
  tabs?: string;
  spacing?: string;
  ind?: string;
  jc?: string;
}

function pPr(p: PPr): string {
  const parts = [
    p.style ? `<w:pStyle w:val="${xmlEscape(p.style)}"/>` : '',
    p.keepNext ? '<w:keepNext/>' : '',
    p.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    p.num ? `<w:numPr><w:ilvl w:val="${p.num.level}"/><w:numId w:val="${p.num.id}"/></w:numPr>` : '',
    p.border ? `<w:pBdr>${p.border}</w:pBdr>` : '',
    p.tabs ? `<w:tabs>${p.tabs}</w:tabs>` : '',
    p.spacing || '',
    p.ind || '',
    p.jc ? `<w:jc w:val="${p.jc}"/>` : ''
  ].join('');
  return parts ? `<w:pPr>${parts}</w:pPr>` : '';
}

function para(props: PPr, runs: string): string {
  return `<w:p>${pPr(props)}${runs}</w:p>`;
}

/** Inline formatting carried down the token tree. */
interface Fmt {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
  /** Fill behind a restricted phrase this version keeps. */
  mark?: string;
  color?: string;
  size?: number;
  font?: string;
}

function rPr(f: Fmt, w: W): string {
  const parts = [
    f.code ? `<w:rStyle w:val="${xmlEscape(w.styles.id('inlineCode'))}"/>` : f.link ? `<w:rStyle w:val="${xmlEscape(w.styles.id('hyperlink'))}"/>` : '',
    f.font ? fontEl(f.font) : '',
    f.bold ? '<w:b/><w:bCs/>' : '',
    f.italic ? '<w:i/><w:iCs/>' : '',
    f.strike ? '<w:strike/>' : '',
    f.color ? `<w:color w:val="${f.color}"/>` : '',
    f.size ? sizeEl(f.size) : '',
    f.mark ? `<w:shd w:val="clear" w:color="auto" w:fill="${f.mark}"/>` : ''
  ].join('');
  return parts ? `<w:rPr>${parts}</w:rPr>` : '';
}

/** A run of text; line breaks and tabs become Word's own. */
function run(text: string, f: Fmt, w: W): string {
  const body = text
    .split('\n')
    .map((line) => line.split('\t').map((s) => (s ? `<w:t xml:space="preserve">${xmlEscape(s)}</w:t>` : '')).join('<w:tab/>'))
    .join('<w:br/>');
  return body ? `<w:r>${rPr(f, w)}${body}</w:r>` : '';
}

/** A Word field: PAGE, NUMPAGES, PAGEREF… with the text shown until Word updates it. */
function field(instr: string, shown: string, f: Fmt, w: W): string {
  const props = rPr(f, w);
  return `<w:r>${props}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${props}<w:instrText xml:space="preserve"> ${xmlEscape(instr)} </w:instrText></w:r>` +
    `<w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r>${run(shown, f, w)}<w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
}

function markFill(preset: Preset): string {
  return hex(tint(tlpColor(preset, 'AMBER').bg, 0.75));
}

function inline(tokens: MdToken[] | undefined, w: W, f: Fmt = {}): string {
  if (!tokens) return '';
  let out = '';
  // As in the PDF: spans are not printed, only their text, highlighted while
  // one that marks a restricted phrase is open.
  const spans: boolean[] = [];
  for (const tk of tokens) {
    const html = tk.type === 'html' ? String(tk.text ?? '') : '';
    if (/^<span\b/i.test(html)) { spans.push(html.includes(PHRASE_MARK_ATTR)); continue; }
    if (/^<\/span\s*>$/i.test(html)) { spans.pop(); continue; }
    const g: Fmt = spans.includes(true) ? { ...f, mark: markFill(w.preset) } : f;
    switch (tk.type) {
      case 'text':
        out += tk.tokens && tk.tokens.length ? inline(tk.tokens, w, g) : run(decodeEntities(tk.text), g, w);
        break;
      case 'strong': out += inline(tk.tokens, w, { ...g, bold: true }); break;
      case 'em': out += inline(tk.tokens, w, { ...g, italic: true }); break;
      case 'del': out += inline(tk.tokens, w, { ...g, strike: true }); break;
      case 'codespan': out += run(decodeEntities(tk.text), { ...g, code: true }, w); break;
      case 'br': out += '<w:r><w:br/></w:r>'; break;
      case 'escape': out += run(String(tk.text ?? ''), g, w); break;
      case 'link': {
        const href = String(tk.href || '');
        const runs = inline(tk.tokens, w, { ...g, link: true });
        if (/^https?:|^mailto:/i.test(href)) {
          const id = w.rels.add(REL_TYPES.hyperlink, href, true);
          out += `<w:hyperlink r:id="${id}" w:history="1">${runs}</w:hyperlink>`;
        } else {
          out += runs;
        }
        break;
      }
      case 'image': break; // a block of its own, see paragraph()
      case 'html':
        // As in the PDF: a line break breaks, any other tag is printed as written.
        out += /^<br\s*\/?>$/i.test(html.trim()) ? '<w:r><w:br/></w:r>' : run(html, g, w);
        break;
      default:
        if (tk.text) out += run(decodeEntities(tk.text), g, w);
    }
  }
  return out;
}

function plainText(tokens: MdToken[] | undefined): string {
  return (tokens || [])
    .map((tk) => (tk.tokens ? plainText(tk.tokens) : tk.type === 'html' ? '' : decodeEntities(tk.text ?? '')))
    .join('');
}

/* Images ------------------------------------------------------------ */

function imageBlock(tk: MdToken, w: W): string {
  const href = String(tk.href || '');
  const ref = IMAGE_REF_RE.exec(href);
  const url = ref ? w.images[ref[1]] : /^data:image\//i.test(href) ? href : null;
  const img = parseDataUrl(url);
  if (!img || img.ext === 'svg') {
    const label = tk.text || tk.href || '';
    return label ? para({ style: w.styles.id('caption') }, run('[' + tr('inline.image', { label }) + ']', {}, w)) : '';
  }
  const id = w.media.add(w.rels, ref ? ref[1] : href, img.bytes, img.ext);
  const size = imageSize(img.bytes);
  const hint = parseInt(String(tk.title), 10);
  const px = !isNaN(hint) && hint > 0 ? hint : size?.w || 600;
  const cx = Math.min(px * EMU_PER_PX, w.width * EMU_PER_TWIP);
  const cy = size && size.w ? (cx * size.h) / size.w : cx * 0.75;
  return para(
    { jc: 'center', spacing: `<w:spacing w:before="${tw(6)}" w:after="${tw(8)}"/>` },
    pictureRun({ id, cx, cy, alt: String(tk.text || '') }, w)
  );
}

/* Blocks ------------------------------------------------------------ */

function paragraph(t: MdToken, w: W): string {
  const toks = t.tokens || [];
  if (toks.some((x) => x.type === 'image')) {
    let out = '';
    let buf: MdToken[] = [];
    const flush = () => {
      if (buf.length && plainText(buf).trim()) out += para({ style: w.styles.id('body') }, inline(buf, w));
      buf = [];
    };
    for (const tk of toks) {
      if (tk.type === 'image') { flush(); out += imageBlock(tk, w); }
      else buf.push(tk);
    }
    flush();
    return out;
  }
  const plain = plainText(toks).trim();
  if (CAPTION_RE.test(plain)) return para({ style: w.styles.id('caption') }, run(plain, {}, w));
  return para({ style: w.styles.id('body') }, inline(toks, w));
}

function heading(t: MdToken, w: W, breakBefore: boolean): string {
  const depth = Math.min(Math.max(Number(t.depth) || 1, 1), HEADING_LEVELS);
  const i = depth - 1;
  w.counters[i] = (w.counters[i] || 0) + 1;
  for (let k = depth; k < HEADING_LEVELS; k++) w.counters[k] = 0;

  const toc = w.preset.toc || defaultToc();
  const style = w.styles.get(`heading${depth}` as WordRole);
  // A template whose heading styles number themselves keeps its numbering;
  // otherwise the PDF template's numbering is written as text.
  const label = style.numbered ? '' : headingLabel(toc, w.counters, i);
  // A bookmark per heading: the table of contents links to it.
  const n = w.ids.bookmark++;
  const name = `_TocReport${n}`;
  if (toc.levels[i]) w.toc.push({ level: depth, text: label + plainText(t.tokens).trim(), bookmark: name });
  return para(
    { style: style.id, pageBreakBefore: breakBefore },
    `<w:bookmarkStart w:id="${n}" w:name="${name}"/>` + (label ? run(label, {}, w) : '') + inline(t.tokens, w) + `<w:bookmarkEnd w:id="${n}"/>`
  );
}

function list(t: MdToken, w: W, depth: number, numId: number | null): string {
  const asColumns = listColumns(t);
  if (asColumns) return asColumns.map((c) => blocks(c.content, { ...w, top: false })).join('');

  const items = t.items || [];
  const tasks = items.some((it) => it.task);
  const id = tasks ? null : numId ?? w.numbering.list(!!t.ordered, Number(t.start) || 1);
  const level = Math.min(depth, 8);
  const indent = `<w:ind w:left="${720 * (level + 1)}"/>`;
  const style = w.styles.id('listParagraph');
  let out = '';
  for (const item of items) {
    let first = true;
    for (const tk of item.tokens || []) {
      if (tk.type === 'list') {
        // A nested list of the same kind continues the instance one level
        // down; another kind needs an instance of its own.
        const same = !!tk.ordered === !!t.ordered && !tasks && !(tk.items || []).some((x) => x.task);
        out += list(tk, w, depth + 1, same ? id : null);
        continue;
      }
      if (tk.type === 'text' || tk.type === 'paragraph') {
        const box = item.task && first ? run(item.checked ? '☑ ' : '☐ ', { color: item.checked ? hex(w.preset.colors.brand) : '767676' }, w) : '';
        const runs = inline(tk.tokens || [{ type: 'text', text: tk.text }], w);
        out += para(first && id !== null ? { style, num: { id, level } } : { style, ind: indent }, box + runs);
        first = false;
        continue;
      }
      out += block(tk, { ...w, top: false });
      first = false;
    }
  }
  return out;
}

/** A table: header row repeated on each page, widths measured as in the PDF. */
function grid(
  header: string[],
  rows: string[][],
  w: W,
  o: { widths?: number[]; align?: string[]; cell?: (text: string, row: number, col: number) => string } = {}
): string {
  const cols = Math.max(header.length, ...rows.map((r) => r.length));
  if (!cols) return '';
  let pts = o.widths;
  if (!pts) {
    const cells: TableCell[][] = [header, ...rows].map((r, i) => r.map((text) => ({ runs: [{ text }], bold: i === 0 })));
    const fit = fitTable(cells, {
      width: w.width / 20, font: w.preset.fonts.bodyFont, fontSize: bodySize(w.preset) - 1, padding: 10, rule: 0.75
    });
    pts = fit ? fit.widths : new Array<number>(cols).fill(1);
  }
  const total = pts.reduce((a, b) => a + b, 0) || 1;
  const twips = pts.map((p) => Math.max(200, Math.round((p / total) * w.width)));
  const cell = (text: string, i: number, j: number) =>
    `<w:tc><w:tcPr><w:tcW w:w="${twips[j]}" w:type="dxa"/></w:tcPr>` +
    para({ jc: o.align?.[j] || 'left' }, o.cell ? o.cell(text, i, j) : run(text, i === 0 ? { bold: true } : {}, w)) +
    '</w:tc>';
  const row = (r: string[], i: number) =>
    `<w:tr>${i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
    Array.from({ length: cols }, (_, j) => cell(r[j] ?? '', i, j)).join('') +
    '</w:tr>';
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="${xmlEscape(w.styles.id('table'))}"/><w:tblW w:w="${twips.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    '<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
    `<w:tblGrid>${twips.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>` +
    [header, ...rows].map(row).join('') +
    '</w:tbl>' +
    // Two tables in a row would merge in Word; an empty paragraph keeps them apart.
    para({ spacing: `<w:spacing w:before="0" w:after="${tw(6)}"/>` }, '')
  );
}

function table(t: MdToken, w: W): string {
  const header = t.header || [];
  const rows = t.rows || [];
  // Cells keep their inline formatting; the text alone sizes the columns.
  const tokens = [header.map((c) => c.tokens), ...rows.map((r) => r.map((c) => c.tokens))];
  return grid(
    header.map((c) => plainText(c.tokens)),
    rows.map((r) => r.map((c) => plainText(c.tokens))),
    w,
    {
      align: (t.align || []).map((a) => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left')),
      cell: (_text, i, j) => inline(tokens[i]?.[j] || [], w, i === 0 ? { bold: true } : {})
    }
  );
}

function code(text: string, w: W): string {
  return para({ style: w.styles.id('code') }, run(text.replace(/\n$/, ''), {}, w));
}

/** A Mermaid diagram as the host drew it, or its source when there is no drawing. */
function diagram(t: MdToken, w: W): string {
  const key = diagramKey(t.text ?? '');
  const img = w.diagrams.get(key);
  const pic = img ? rasterPicture(img, 'diagram:' + key, w.rels, w) : null;
  if (!img || !pic) {
    w.warnings.add(tr('word.diagramsAsCode'));
    return code(String(t.text ?? ''), w);
  }
  // Never wider than drawn on screen (px -> pt), never wider than the column.
  const cx = Math.min(img.width * EMU_PER_PX, w.width * EMU_PER_TWIP);
  const cy = (cx * img.height) / img.width;
  return para(
    { jc: 'center', spacing: `<w:spacing w:before="${tw(6)}" w:after="${tw(10)}"/>` },
    pictureRun({ ...pic, cx, cy, alt: 'Diagram' }, w)
  );
}

function fence(t: MdToken, w: W): string {
  const kind = columnsLang(t.lang);
  const inner = { ...w, top: false };
  // Columns are laid out side by side from 1.3; until then, one after the other.
  if (kind === 'col') {
    return parseColBlock(String(t.text ?? '')).rows.flat().map((c) => blocks(c.content, inner)).join('');
  }
  if (kind === 'col-md') return blocks(parseColMd(String(t.text ?? '')).content, inner);
  if (isMermaidLang(t.lang)) return diagram(t, w);
  return code(String(t.text ?? ''), w);
}

/** Border (3pt) plus left and right padding (10pt each), as in the PDF's boxes. */
const BOX_INSET = tw(23);

/** A one-cell table: a bar of colour on the left, a tinted fill, the content inside. */
function box(inner: string, accent: string, fill: string, w: W): string {
  const nil = (side: string) => `<w:${side} w:val="nil"/>`;
  const content = /<\/w:p>$/.test(inner) ? inner : inner + '<w:p/>';
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${w.width}" w:type="dxa"/>` +
    `<w:tblBorders>${nil('top')}<w:left w:val="single" w:sz="24" w:space="0" w:color="${accent}"/>${nil('bottom')}${nil('right')}${nil('insideH')}${nil('insideV')}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${tw(6)}" w:type="dxa"/><w:left w:w="${tw(10)}" w:type="dxa"/>` +
    `<w:bottom w:w="${tw(2)}" w:type="dxa"/><w:right w:w="${tw(10)}" w:type="dxa"/></w:tblCellMar>` +
    '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${w.width}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${w.width}" w:type="dxa"/>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>` +
    para({ spacing: `<w:spacing w:before="0" w:after="${tw(6)}"/>` }, '')
  );
}

/** The key a callout icon is handed in under: one per glyph and colour. */
export function calloutIconKey(icon: IconName, accent: string): string {
  return `${icon}:${hex(accent)}`;
}

/** Every icon a callout of this template can show, for the host to rasterise. */
export function calloutIcons(preset: Preset): { key: string; svg: string }[] {
  const seen = new Map<string, string>();
  const styles = [...Object.values(CALLOUT_STYLES), { icon: 'info' as IconName, accent: preset.colors.brand }];
  for (const s of styles) seen.set(calloutIconKey(s.icon, s.accent), iconSvg(s.icon, '#' + hex(s.accent)));
  return [...seen].map(([key, svg]) => ({ key, svg }));
}

function blockquote(t: MdToken, w: W): string {
  const call = parseCallout(String(t.raw || ''));
  const inner: W = { ...w, top: false, width: Math.max(tw(40), w.width - BOX_INSET) };
  if (call && (call.type === 'col' || columnsLang(call.type) === 'col-md')) return blocks(call.body, { ...w, top: false });
  const brand = w.preset.colors.brand;
  if (!call) {
    const body = (t.tokens || []).map((x) => block(x, inner)).join('');
    return box(body, hex(brand), hex(tint(brand, 0.93)), w);
  }

  const style = CALLOUT_STYLES[call.type] || { accent: brand, tint: tint(brand, 0.93), icon: 'info' };
  const accent = hex(style.accent);
  const label = call.type.charAt(0).toUpperCase() + call.type.slice(1);
  const iconImg = w.preset.calloutIcons !== false ? w.icons[calloutIconKey(style.icon, style.accent)] : undefined;
  const icon = iconImg ? rasterPicture(iconImg, 'icon:' + calloutIconKey(style.icon, style.accent), w.rels, w) : null;
  const size = bodySize(w.preset);
  const title = para(
    { keepNext: !!call.body.trim(), spacing: `<w:spacing w:before="0" w:after="${tw(call.body.trim() ? 4 : 0)}"/>`, jc: 'left' },
    (icon ? pictureRun({ ...icon, cx: 12 * EMU_PER_PT, cy: 12 * EMU_PER_PT, alt: label }, w) + run(' ', {}, w) : '') +
      inline(marked.Lexer.lexInline(call.title || label), w, { bold: true, color: accent, size })
  );
  return box(title + (call.body.trim() ? blocks(call.body, inner) : ''), accent, hex(style.tint), w);
}

function hr(): string {
  return para({ border: '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/>' }, '');
}

/** Where a restricted passage this version keeps begins: its label on amber. */
function markStart(label: string, w: W): string {
  const amber = tlpColor(w.preset, 'AMBER');
  return para(
    { keepNext: true, border: `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${hex(amber.bg)}"/>` },
    run(` ${label} `, { bold: true, color: hex(amber.fg), mark: hex(amber.bg), size: 7.5 }, w) +
      run('  ' + tr('audience.bannerNote'), { italic: true, color: '6B6B6B', size: 7.5 }, w)
  );
}

/** Where it ends: a dashed rule in the same colour. */
function markEnd(w: W): string {
  return para(
    { border: `<w:bottom w:val="dashed" w:sz="6" w:space="1" w:color="${hex(tlpColor(w.preset, 'AMBER').bg)}"/>`, spacing: `<w:spacing w:after="${tw(10)}"/>` },
    ''
  );
}

function block(t: MdToken, w: W): string {
  switch (t.type) {
    case 'heading': return heading(t, w, false);
    case 'paragraph': return paragraph(t, w);
    case 'list': return list(t, w, 0, null);
    case 'table': return table(t, w);
    case 'code': return fence(t, w);
    case 'blockquote': return blockquote(t, w);
    case 'hr': return hr();
    default: return '';
  }
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** A Markdown string as body XML, with page breaks and confidentiality marks. */
function blocks(md: string, w: W): string {
  const breaks = (w.preset.toc || defaultToc()).pageBreak;
  let out = '';
  let pending = false;
  for (const t of lex(md)) {
    if (isPageBreakToken(t)) { pending = true; continue; }
    if (t.type === 'html') {
      const raw = String(t.raw || t.text || '').trim();
      const start = MARK_START_RE.exec(raw);
      if (start) { out += markStart(start[1], w); continue; }
      if (MARK_END_RE.test(raw)) { out += markEnd(w); continue; }
    }
    if (t.type === 'space') continue;
    if (pending) { out += PAGE_BREAK; pending = false; }

    if (t.type === 'heading') {
      // As in the PDF: not at the very start, and a chain of headings moves together.
      const breakBefore = w.top && breaks[(t.depth ?? 1) - 1] === true && w.breakable;
      out += heading(t, w, breakBefore);
      w.breakable = false;
      continue;
    }
    const xml = block(t, w);
    if (xml) { out += xml; w.breakable = true; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Table of contents                                                   */
/* ------------------------------------------------------------------ */

/**
 * A Word table of contents, filled in already: each entry links to its
 * heading, so it reads and clicks even where fields are never updated. Word
 * replaces it with its own, page numbers included, when it updates fields.
 */
function tocField(w: W, title: string | null): string {
  const toc = w.preset.toc || defaultToc();
  const deepest = toc.levels.lastIndexOf(true) + 1;
  if (!deepest) return '';
  const tab = `<w:tab w:val="right" w:leader="dot" w:pos="${w.width}"/>`;
  const begin =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> TOC \\o "1-${deepest}" \\h \\z \\u </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
  const entries = w.toc.map((e, i) =>
    para(
      { style: w.styles.id(`toc${e.level}` as WordRole), tabs: tab },
      (i === 0 ? begin : '') +
        `<w:hyperlink w:anchor="${e.bookmark}" w:history="1">${run(e.text, {}, w)}<w:r><w:tab/></w:r>` +
        field(`PAGEREF ${e.bookmark} \\h`, '', {}, w) +
        '</w:hyperlink>'
    )
  );
  const body = entries.length
    ? entries.join('') + para({}, '<w:r><w:fldChar w:fldCharType="end"/></w:r>')
    : para({}, begin + '<w:r><w:fldChar w:fldCharType="end"/></w:r>');
  const heading = title ? para({ style: w.styles.id('tocHeading') }, run(title, {}, w)) : '';
  return (
    '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr>' +
    `<w:sdtContent>${heading}${body}</w:sdtContent></w:sdt>`
  );
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

/** The note's values for the template's markers. */
function markerValues(vars: ReportVars, preset: Preset, date: string): Record<string, MarkerValue> {
  const last = vars.versions.length ? vars.versions[vars.versions.length - 1] : {};
  const tlp = vars.tlp ? tlpColor(preset, vars.tlp) : null;
  return {
    title: { text: vars.docTitle },
    subtitle: { text: vars.coverSubtitle },
    acronym: { text: vars.coverSubtitle2 },
    client: { text: vars.client },
    author: { text: vars.author },
    version: { text: last.version || '' },
    date: { text: last.date || date },
    status: { text: last.etat || '' },
    tlp: vars.tlp && tlp ? { text: 'TLP:' + vars.tlp, bold: true, color: hex(tlp.bg) } : { text: '' }
  };
}

/* ------------------------------------------------------------------ */
/* The generated document: pages around the body                       */
/* ------------------------------------------------------------------ */

/**
 * Start a section on a new page: its first paragraph gets a page break
 * before it, which, unlike a break paragraph, leaves no blank line at the top.
 */
function onNewPage(xml: string): string {
  if (xml.startsWith('<w:sdt>')) {
    const at = xml.indexOf('<w:sdtContent>') + '<w:sdtContent>'.length;
    return xml.slice(0, at) + onNewPage(xml.slice(at));
  }
  if (/^<w:p><w:pPr>(?:(?!<\/w:pPr>)[\s\S])*<w:pageBreakBefore\/>/.test(xml)) return xml;
  // pageBreakBefore comes after pStyle and keepNext in the schema.
  const m = /^<w:p><w:pPr>((?:<w:pStyle [^>]*\/>)?(?:<w:keepNext\/>)?)/.exec(xml);
  if (m) return '<w:p><w:pPr>' + m[1] + '<w:pageBreakBefore/>' + xml.slice(m[0].length);
  if (xml.startsWith('<w:p>')) return '<w:p><w:pPr><w:pageBreakBefore/></w:pPr>' + xml.slice('<w:p>'.length);
  return PAGE_BREAK + xml;
}

/** Line height used to place the cover text, per point of type. */
const COVER_LINE = 1.2;

/**
 * The cover's text, placed where the PDF draws it. Word has no absolute text
 * position outside text boxes, so each line is pushed down from the one
 * before by the gap the PDF leaves; the rule, which has no text, is drawn
 * with the decoration. Returns the paragraphs and where the rule goes.
 */
function coverText(vars: ReportVars, w: W, top: number, left: number): { xml: string; ruleY: number } {
  const p = w.preset;
  const cv = p.layout.cover;
  const raw = (vars.coverTitle || vars.docTitle || 'REPORT').toUpperCase();
  const fitted = fitCoverTitle(raw, cv.titleSize, cv.titleMaxChars);
  const lines = fitted.text.split('\n');
  const titleBottom = cv.titleY + lines.length * fitted.fontSize * COVER_LINE;
  const next = cv.showRule !== false ? cv.ruleY : Math.min(cv.subtitleY, cv.acronymY);
  const shift = Math.max(0, Math.ceil(titleBottom + 4 - next));

  let cursor = top;
  let xml = '';
  const line = (style: WordRole, text: string, y: number, size: number, f: Fmt) => {
    const before = Math.max(0, y - cursor);
    const height = size * COVER_LINE;
    cursor = Math.max(cursor, y) + height * text.split('\n').length;
    xml += para(
      {
        style: w.styles.id(style),
        spacing: `<w:spacing w:before="${tw(before)}" w:after="0" w:line="${tw(height)}" w:lineRule="exact"/>`,
        ind: `<w:ind w:left="${tw(cv.x - left)}"/>`
      },
      run(text, { ...f, size }, w)
    );
  };
  line('title', fitted.text, cv.titleY, fitted.fontSize, {});
  if (vars.coverSubtitle) line('subtitle', vars.coverSubtitle, cv.subtitleY + shift, cv.subtitleSize, { font: wordFont(p.fonts.bodyFont, 'Arial') });
  if (vars.coverSubtitle2) line('subtitle', vars.coverSubtitle2, cv.acronymY + shift, cv.acronymSize, { font: wordFont(p.fonts.headingFont, 'Arial Black'), color: '141414' });
  return { xml, ruleY: cv.ruleY + shift };
}

/** The cover's artwork, or the built-in decoration, with the logo and the rule. */
function coverHeader(w: W, rels: Relationships, ruleY: number, logo: string | null): string {
  const p = w.preset;
  const C = p.colors;
  const cv = p.layout.cover;
  // The artwork, when Word can show it; otherwise the decoration, as in the PDF.
  let art = p.assets.coverBg ? placedImage(p.assets.coverBg, 'coverBg', 0, 0, PAGE_W, PAGE_H, rels, w) : '';
  if (!art && p.layout.decor !== false) {
    const bx = Math.max(0, cv.x - 28);
    const top = Math.max(0, cv.titleY - 40);
    const bottom = Math.min(PAGE_H - 160, Math.max(cv.acronymY, cv.subtitleY) + (ruleY - cv.ruleY) + 90);
    const accent = tint(C.brand, 0.35);
    art +=
      rect(C.brand, 0, 0, 14, PAGE_H, rels, w) +
      rect(C.brand, bx - 1.25, top - 1.25, 2.5, bottom - top + 2.5, rels, w) +
      rect(C.brand, bx, top - 1.25, 90, 2.5, rels, w) +
      rect(accent, bx, bottom - 1.25, 90, 2.5, rels, w) +
      rect(C.dark, 0, PAGE_H - 96, PAGE_W, 96, rels, w) +
      rect(C.brand, 0, PAGE_H - 101, PAGE_W * 0.45, 5, rels, w);
  }
  if (cv.showRule !== false) art += rect('#141414', cv.x, ruleY, cv.ruleW, 3, rels, w);
  if (logo) art += placedImage(logo, 'coverLogo', cv.logoX, cv.logoY, cv.logoW, null, rels, w);
  return `${XML_DECL}<w:hdr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${para({}, art)}</w:hdr>`;
}

/** The header of every other page: the frame artwork or the bands, then the title and the client. */
function frameHeader(vars: ReportVars, w: W, rels: Relationships, right: number): string {
  const p = w.preset;
  const C = p.colors;
  let art = p.assets.frame ? placedImage(p.assets.frame, 'frame', 0, 0, PAGE_W, PAGE_H, rels, w) : '';
  if (!art && p.layout.decor !== false) {
    art +=
      rect(C.banner, 0, 0, PAGE_W, 64, rels, w) +
      rect(tint(C.banner, 0.55), 0, 64, PAGE_W, 3, rels, w) +
      rect(C.dark, 0, PAGE_H - 48, PAGE_W, 48, rels, w) +
      rect(C.brand, 0, PAGE_H - 51, PAGE_W * 0.45, 3, rels, w);
  }
  // The text ends where the PDF's does, `headerRight` from the edge of the page.
  const ind = `<w:ind w:right="${tw(p.layout.headerRight - right)}"/>`;
  const f: Fmt = { color: hex(C.headerText), size: 12, font: wordFont(p.fonts.bodyFont, 'Arial') };
  return (
    `${XML_DECL}<w:hdr xmlns:w="${NS.w}" xmlns:r="${NS.r}">` +
    para({ jc: 'right', ind, spacing: '<w:spacing w:before="0" w:after="0"/>' }, art + run(vars.docTitle || '', f, w)) +
    (vars.client ? para({ jc: 'right', ind, spacing: `<w:spacing w:before="${tw(4)}" w:after="0"/>` }, run(vars.client, f, w)) : '') +
    '</w:hdr>'
  );
}

/** The footer: the TLP marking, then the page number, at the right as in the PDF. */
function footerXml(w: W, tlp: TlpKey | null, right: number): string {
  const p = w.preset;
  const ind = `<w:ind w:right="${tw(p.layout.footerRight - right)}"/>`;
  const font = wordFont(p.fonts.bodyFont, 'Arial');
  const paging = String(p.layout.pagination ?? '')
    .split(/(\{\{\s*(?:page|total|pages)\s*\}\})/i)
    .map((part) => {
      const f: Fmt = { color: hex(p.colors.footerText), size: 10, font };
      const key = /^\{\{\s*(page|total|pages)\s*\}\}$/i.exec(part)?.[1].toLowerCase();
      // {{page}} and {{total}} become Word fields, so the numbers stay right.
      if (key) return field(key === 'page' ? 'PAGE' : 'NUMPAGES', '1', f, w);
      return run(part, f, w);
    })
    .join('');
  const lines =
    (tlp
      ? para(
          { jc: 'right', ind, spacing: '<w:spacing w:before="0" w:after="0"/>' },
          run('TLP:' + tlp, { bold: true, color: hex(tlpColor(p, tlp).bg), size: 11, font }, w)
        )
      : '') +
    (String(p.layout.pagination ?? '').trim()
      ? para({ jc: 'right', ind, spacing: `<w:spacing w:before="${tw(tlp ? 2 : 7)}" w:after="0"/>` }, paging)
      : '');
  return `${XML_DECL}<w:ftr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${lines || para({}, '')}</w:ftr>`;
}

/** Where the footer sits from the bottom edge, so its text lands where the PDF prints it. */
function footerDistance(w: W, tlp: boolean): number {
  const L = w.preset.layout;
  const height = (tlp ? 13 : 0) + (String(L.pagination ?? '').trim() ? (tlp ? 2 : 7) + 12 : 0);
  return Math.max(0, L.pageMargins[3] - L.footerY - height);
}

/** The references page: document status, contacts, recipients. */
function references(vars: ReportVars, w: W): string {
  const L = w.preset.labels || defaultLabels();
  const pad = (rows: string[][]) => {
    while (rows.length < 3) rows.push(['', '', '']);
    return rows;
  };
  const people = (list: DocContact[], headers: string[]) =>
    grid(headers, pad(list.map((c) => [c.nom ?? '', c.poste || c.societe || '', c.courriel ?? ''])), w, {
      widths: [1, 1, 1],
      cell: (text, i, j) => run(text, i === 0 ? { bold: true } : j === 2 ? { color: hex(w.preset.colors.link) } : {}, w)
    });
  const title = (role: WordRole, text: string) => para({ style: w.styles.id(role) }, run(text, {}, w));
  const recipients = vars.recipients || [];
  return (
    title('sectionTitle', L.references) +
    title('sectionSubtitle', L.status) +
    grid([L.versionColumn, L.versionDate, L.versionState], pad((vars.versions || []).map((v) => [v.version ?? '', v.date ?? '', v.etat ?? ''])), w, {
      widths: [70, 90, Math.max(100, w.width / 20 - 160)]
    }) +
    title('sectionSubtitle', L.contacts) +
    people(vars.contacts || [], [L.contactColumn, L.contactRole, L.contactEmail]) +
    (w.preset.showRecipients || recipients.length
      ? title('sectionSubtitle', L.recipients) + people(recipients, [L.recipientColumn, L.recipientRole, L.recipientEmail])
      : '')
  );
}

/** The TLP reminder page: each level's badge beside its definition. */
function tlpReminder(w: W): string {
  const p = w.preset;
  const L = p.labels || defaultLabels();
  const nil = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="nil"/>`).join('');
  const badge = tw(80);
  const rows = (p.tlpReminder || []).map((lv) => {
    const col = tlpColor(p, lv.key);
    return (
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="${badge}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${hex(col.bg)}"/><w:vAlign w:val="center"/></w:tcPr>` +
      para({ jc: 'center', spacing: '<w:spacing w:before="0" w:after="0"/>' }, run('TLP:' + lv.key, { bold: true, color: hex(col.fg), size: bodySize(p) - 2 }, w)) +
      `</w:tc><w:tc><w:tcPr><w:tcW w:w="${w.width - badge}" w:type="dxa"/></w:tcPr>` +
      para({ style: w.styles.id('body'), spacing: `<w:spacing w:before="0" w:after="${tw(12)}"/>` }, run(lv.text, { size: bodySize(p) - 1 }, w)) +
      '</w:tc></w:tr>'
    );
  });
  return (
    para({ style: w.styles.id('sectionTitle') }, run(L.tlpReminder, {}, w)) +
    para({ spacing: `<w:spacing w:before="${tw(2)}" w:after="${tw(10)}"/>` }, run(L.tlpReminderSubtitle, { bold: true }, w)) +
    (rows.length
      ? `<w:tbl><w:tblPr><w:tblW w:w="${w.width}" w:type="dxa"/><w:tblBorders>${nil}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
        '<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tblCellMar>' +
        '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
        `<w:tblGrid><w:gridCol w:w="${badge}"/><w:gridCol w:w="${w.width - badge}"/></w:tblGrid>${rows.join('')}</w:tbl>` + para({}, '')
      : '')
  );
}

/** A package holding an empty document, for a template that has no Word file. */
function skeleton(): Package {
  const pkg = new Package();
  const lang = getLocale() === 'fr' ? 'fr-FR' : 'en-US';
  pkg.setText(
    '[Content_Types].xml',
    `${XML_DECL}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="${CONTENT_TYPES.rels}"/>` +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.document}"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${CONTENT_TYPES.styles}"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${CONTENT_TYPES.settings}"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="${CONTENT_TYPES.core}"/></Types>`
  );
  pkg.setText(
    '_rels/.rels',
    `${XML_DECL}<Relationships xmlns="${NS.rels}">` +
      `<Relationship Id="rId1" Type="${REL_TYPES.officeDocument}" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_TYPES.core}" Target="docProps/core.xml"/></Relationships>`
  );
  pkg.setText(
    'word/_rels/document.xml.rels',
    `${XML_DECL}<Relationships xmlns="${NS.rels}">` +
      `<Relationship Id="rId1" Type="${REL_TYPES.styles}" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_TYPES.settings}" Target="settings.xml"/></Relationships>`
  );
  pkg.setText(
    'word/document.xml',
    `${XML_DECL}<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}"><w:body><w:p><w:r><w:t>{{content}}</w:t></w:r></w:p></w:body></w:document>`
  );
  pkg.setText(
    'word/styles.xml',
    `${XML_DECL}<w:styles xmlns:w="${NS.w}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/>` +
      `<w:lang w:val="${lang}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/>` +
      '</w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
  );
  pkg.setText(
    'word/settings.xml',
    `${XML_DECL}<w:settings xmlns:w="${NS.w}"><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/>` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
  );
  pkg.setText(
    'docProps/core.xml',
    `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title></dc:title><dc:creator></dc:creator></cp:coreProperties>'
  );
  return pkg;
}

/** Open a template, refusing what the engine cannot fill. */
function openTemplate(bytes: Uint8Array): Package {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch {
    throw new WordTemplateError(tr('word.notWord'));
  }
  if ([...pkg.files.keys()].some((p) => /vbaProject\.bin$/i.test(p))) throw new WordTemplateError(tr('word.macros'));
  if (!pkg.has('[Content_Types].xml')) throw new WordTemplateError(tr('word.notWord'));
  return pkg;
}

function mainPart(pkg: Package): string {
  const rel = new Relationships(pkg.text('_rels/.rels')).ofType(REL_TYPES.officeDocument)[0];
  const path = rel ? resolveTarget('', rel.target) : 'word/document.xml';
  if (!pkg.has(path)) throw new WordTemplateError(tr('word.notWord'));
  return path;
}

/** The part a relationship of `type` points to, created when there is none. */
function partOf(main: string, rels: Relationships, ct: ContentTypes, type: string, name: string, contentType: string): string {
  const rel = rels.ofType(type)[0];
  if (rel) return resolveTarget(main, rel.target);
  rels.add(type, name);
  const path = resolveTarget(main, name);
  ct.setOverride(path, contentType);
  return path;
}

/** Text width of the document's last section, in twips. */
function textWidth(doc: string): number {
  const sect = doc.lastIndexOf('<w:sectPr');
  const tail = sect >= 0 ? doc.slice(sect) : '';
  const w = parseInt(attrOf(tail, 'w:pgSz', 'w:w') ?? '', 10);
  const l = parseInt(attrOf(tail, 'w:pgMar', 'w:left') ?? '', 10);
  const r = parseInt(attrOf(tail, 'w:pgMar', 'w:right') ?? '', 10);
  const width = w - (isNaN(l) ? 1440 : l) - (isNaN(r) ? 1440 : r);
  return isFinite(width) && width > 1440 ? width : 9026;
}

function setCoreTitle(xml: string, vars: ReportVars): string {
  const put = (src: string, tag: string, value: string) => {
    if (!value) return src;
    const el = `<${tag}>${xmlEscape(value)}</${tag}>`;
    const re = new RegExp(`<${tag}\\s*/>|<${tag}>[\\s\\S]*?</${tag}>`);
    return re.test(src) ? src.replace(re, el) : src.replace(/<\/cp:coreProperties>\s*$/, el + '</cp:coreProperties>');
  };
  return put(put(xml, 'dc:title', vars.docTitle), 'dc:creator', vars.author);
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

/**
 * The styles a Word template defines, for the settings' style table. Paragraph
 * and character styles only, by internal name.
 */
export function listWordStyles(template: Uint8Array): { name: string; type: StyleType }[] {
  const pkg = openTemplate(template);
  const main = mainPart(pkg);
  const rel = new Relationships(pkg.text(relsPath(main))).ofType(REL_TYPES.styles)[0];
  const xml = rel ? pkg.text(resolveTarget(main, rel.target)) : null;
  return xml ? parseStyles(xml).map((s) => ({ name: s.name, type: s.type })) : [];
}

/** Add a header or footer part to a generated package and return its relationship id. */
function addPart(pkg: Package, docRels: Relationships, ct: ContentTypes, kind: 'header' | 'footer', name: string, xml: string, rels: Relationships): string {
  pkg.setText(`word/${name}`, xml);
  if (rels.list.length) pkg.setText(relsPath(`word/${name}`), rels.toXml());
  ct.setOverride(`word/${name}`, kind === 'header' ? CONTENT_TYPES.header : CONTENT_TYPES.footer);
  return docRels.add(kind === 'header' ? REL_TYPES.header : REL_TYPES.footer, name);
}

export function buildDocx(md: string, vars: ReportVars, preset: Preset, o: DocxOptions = {}): DocxResult {
  const generated = !o.template;
  const pkg = o.template ? openTemplate(o.template) : skeleton();
  const main = mainPart(pkg);
  const rels = new Relationships(pkg.text(relsPath(main)));
  const ct = new ContentTypes(pkg.text('[Content_Types].xml') || '');
  const doc = ensureRootNs(pkg.text(main) || '', 'r', NS.r);

  const stylesPath = partOf(main, rels, ct, REL_TYPES.styles, 'styles.xml', CONTENT_TYPES.styles);
  const styles = new StyleBook(
    pkg.text(stylesPath) || `${XML_DECL}<w:styles xmlns:w="${NS.w}"></w:styles>`,
    preset,
    generated ? {} : preset.word?.styles || {}
  );
  const numberingRel = rels.ofType(REL_TYPES.numbering)[0];
  const numberingPath = numberingRel ? resolveTarget(main, numberingRel.target) : null;

  // A generated page has the PDF template's side margins.
  const margins = preset.layout.pageMargins;
  const left = margins[0] ?? 64;
  const right = margins[2] ?? 64;

  const diagrams = new Map<string, RasterImage>();
  for (const [source, d] of Object.entries(o.diagrams || {})) {
    if (d && d.png && d.width > 0 && d.height > 0) diagrams.set(diagramKey(source), d);
  }
  const w: W = {
    preset,
    styles,
    rels,
    numbering: new NumberingBook(numberingPath ? pkg.text(numberingPath) : null),
    media: new MediaBook(pkg, main.slice(0, main.lastIndexOf('/') + 1)),
    images: o.images || {},
    diagrams,
    icons: o.icons || {},
    width: generated ? PAGE_W_TW - tw(left) - tw(right) : textWidth(doc),
    counters: new Array<number>(HEADING_LEVELS).fill(0),
    ids: { drawing: 10000, bookmark: 10000 },
    toc: [],
    warnings: new Set(),
    top: true,
    breakable: false
  };

  const values = markerValues(vars, preset, o.date || '');
  const fill = (name: string) => values[name] ?? null;
  // The body first: the table of contents lists its headings.
  const report = blocks(md, w);
  let usesToc = false;
  let out: string;

  if (generated) {
    const sections = resolveSections(vars, preset);
    const tlp = reportTlp(vars.tlp, sections);
    const hasCover = sections[0] === 'cover';
    const top = margins[1] ?? 100;
    let cover: { xml: string; ruleY: number } | null = null;
    const pages: string[] = [];
    for (const sec of sections) {
      if (sec === 'cover') pages.push((cover = coverText(vars, w, top, left)).xml);
      else if (sec === 'references') pages.push(references(vars, w));
      else if (sec === 'tlp') pages.push(tlpReminder(w));
      else if (sec === 'toc') {
        const toc = tocField(w, vars.tocTitle || preset.labels.toc);
        if (toc) { pages.push(toc); usesToc = true; }
      } else if (sec === 'body') pages.push(report);
    }
    const body = pages.filter(Boolean).map((xml, i) => (i === 0 ? xml : onNewPage(xml))).join('');

    // Headers and footers: the cover page has its own, every other page the frame.
    const headerRels = new Relationships(null);
    const header = addPart(pkg, rels, ct, 'header', 'header1.xml', frameHeader(vars, w, headerRels, right), headerRels);
    const footer = addPart(pkg, rels, ct, 'footer', 'footer1.xml', footerXml(w, tlp, right), new Relationships(null));
    let first = '';
    if (hasCover && cover) {
      const coverRels = new Relationships(null);
      const logo = o.clientLogo || preset.assets.clientLogo || null;
      const id = addPart(pkg, rels, ct, 'header', 'header2.xml', coverHeader(w, coverRels, cover.ruleY, logo), coverRels);
      const blank = addPart(pkg, rels, ct, 'footer', 'footer2.xml', `${XML_DECL}<w:ftr xmlns:w="${NS.w}">${para({}, '')}</w:ftr>`, new Relationships(null));
      first = `<w:headerReference w:type="first" r:id="${id}"/><w:footerReference w:type="first" r:id="${blank}"/>`;
    }
    const sectPr =
      `<w:sectPr><w:headerReference w:type="default" r:id="${header}"/><w:footerReference w:type="default" r:id="${footer}"/>${first}` +
      `<w:pgSz w:w="${PAGE_W_TW}" w:h="${PAGE_H_TW}"/>` +
      `<w:pgMar w:top="${tw(top)}" w:right="${tw(right)}" w:bottom="${tw(margins[3] ?? 82)}" w:left="${tw(left)}" ` +
      `w:header="${tw(preset.layout.headerY)}" w:footer="${tw(footerDistance(w, !!tlp))}" w:gutter="0"/>` +
      `${hasCover ? '<w:titlePg/>' : ''}</w:sectPr>`;
    out = doc.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${body}${sectPr}</w:body>`);
  } else {
    // Markers are filled around the report, never inside it: a note that
    // writes "{{title}}" in its text keeps it.
    const split = splitAtMarker(doc, 'content');
    const withToc = (xml: string) => {
      const at = splitAtMarker(xml, 'toc');
      if (!at) return xml;
      usesToc = true;
      return at.before + tocField(w, null) + at.after;
    };
    if (split) {
      out = withToc(fillMarkers(split.before, fill)) + report + withToc(fillMarkers(split.after, fill));
    } else {
      w.warnings.add(tr('word.noContentMarker'));
      const filled = withToc(fillMarkers(doc, fill));
      const at = filled.lastIndexOf('<w:sectPr');
      const end = filled.lastIndexOf('</w:body>');
      const cut = at > filled.lastIndexOf('</w:p>') ? at : end;
      out = filled.slice(0, cut) + report + filled.slice(cut);
    }
    // Headers and footers carry markers too: the TLP marking, the title.
    for (const rel of [...rels.ofType(REL_TYPES.header), ...rels.ofType(REL_TYPES.footer)]) {
      const path = resolveTarget(main, rel.target);
      const xml = pkg.text(path);
      if (xml) pkg.setText(path, fillMarkers(xml, fill));
    }
  }
  pkg.setText(main, out);

  if (usesToc) {
    const path = partOf(main, rels, ct, REL_TYPES.settings, 'settings.xml', CONTENT_TYPES.settings);
    pkg.setText(path, withUpdateFields(pkg.text(path) || `${XML_DECL}<w:settings xmlns:w="${NS.w}"></w:settings>`));
  }
  if (w.numbering.used) {
    const path = numberingPath ?? partOf(main, rels, ct, REL_TYPES.numbering, 'numbering.xml', CONTENT_TYPES.numbering);
    pkg.setText(path, w.numbering.toXml());
  }
  pkg.setText(stylesPath, styles.toXml());
  pkg.setText(relsPath(main), rels.toXml());

  // A .dotx opened in Word starts a new document; saved as is, it must
  // declare itself a document or Word refuses it.
  ct.setOverride(main, CONTENT_TYPES.document);
  const mime: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };
  for (const ext of w.media.types) ct.ensureDefault(ext, mime[ext]);
  pkg.setText('[Content_Types].xml', ct.toXml());

  const coreRel = new Relationships(pkg.text('_rels/.rels')).ofType(REL_TYPES.core)[0];
  const corePath = coreRel ? resolveTarget('', coreRel.target) : null;
  const core = corePath ? pkg.text(corePath) : null;
  if (corePath && core) pkg.setText(corePath, setCoreTitle(core, vars));

  const warnings = [...w.warnings];
  if (styles.unknown.length) warnings.push(tr('word.stylesUnknown', { names: styles.unknown.join(', ') }));
  return { bytes: pkg.toBytes(), warnings };
}
