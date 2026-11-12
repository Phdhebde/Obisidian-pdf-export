/*
 * Report Exporter — Word engine (environment-agnostic).
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
  DECOR,
  DEFAULT_PAGE_MARGINS,
  PAGE_H,
  PAGE_W,
  IMAGE_REF_RE,
  bodySize,
  coverBracket,
  decorAccents,
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
  planDocument,
  tint,
  tlpColor,
  type DocumentPlan,
  type MdToken
} from './generator.ts';
import { columnsLang, parseColBlock, parseColMd, type ColSettings, type ColumnSpec } from './columns.ts';
import { FOOTNOTE_TAG_RE, extractFootnotes, type Footnote } from './footnotes.ts';
import { iconSvg, type IconName } from './icons.ts';
import { calloutSpan } from './columns.ts';
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
import { HEADING_LEVELS, type DocContact, type DocVersion, type Preset, type ReportVars, type SectionKey, type TlpKey, type WordRole } from './types.ts';

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

/** A4 in twips (PAGE_W and PAGE_H, in points, come from the PDF engine). */
const PAGE_W_TW = 11906;
const PAGE_H_TW = 16838;
const ONE_INCH_TW = 1440;

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
  footnoteText: { name: 'footnote text', type: 'paragraph' },
  footnoteReference: { name: 'footnote reference', type: 'character' },
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
    case 'footnoteText':
      return { pPr: `<w:spacing w:after="${tw(2)}" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>`, rPr: sizeEl(B - 2) };
    case 'footnoteReference':
      return { rPr: '<w:vertAlign w:val="superscript"/>' };
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
  /** Styles added from the PDF template, which the template had no say in. */
  private own = new Set<string>();
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
    const hidden = role === 'hyperlink' || /^toc\d|^footnote/.test(role) ? '<w:uiPriority w:val="39"/><w:unhideWhenUsed/>' : '';
    this.added.push(
      `<w:style w:type="${type}"${isDefault ? ' w:default="1"' : ''} w:styleId="${xmlEscape(id)}">` +
        `<w:name w:val="${xmlEscape(name)}"/>${basedOn}${next}${hidden}<w:qFormat/>` +
        (body.pPr ? `<w:pPr>${body.pPr}</w:pPr>` : '') +
        (body.rPr ? `<w:rPr>${body.rPr}</w:rPr>` : '') +
        (body.extra || '') +
        '</w:style>'
    );
    this.own.add(id);
    const info: StyleInfo = { id, name, type, numbered: false };
    this.byName.set(name.toLowerCase(), info);
    return info;
  }

  /** True when the role's style was added from the PDF template rather than found in the Word one. */
  isOwn(role: WordRole): boolean {
    return this.own.has(this.id(role));
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
/* Footnotes                                                           */
/* ------------------------------------------------------------------ */

/**
 * The note's footnotes as Word's own, in the footnotes part: Word numbers them
 * and places each at the foot of the page that cites it. Appended after a
 * template's own notes, with ids clear of theirs.
 */
class FootnoteBook {
  /** Relationships of the footnotes part: a link in a note is related from it. */
  readonly rels: Relationships;
  private notes = new Map<number, string>();
  /** Note number -> its place among the document's footnotes, as Word numbers them. */
  private shown = new Map<number, number>();
  /** Footnotes the template has already, which Word counts before ours. */
  private before: number;
  private written: string[] = [];
  private next: number;
  private xml: string | null;

  constructor(xml: string | null, rels: string | null, notes: Footnote[]) {
    this.xml = xml;
    this.rels = new Relationships(rels);
    for (const f of notes) this.notes.set(f.n, f.md);
    const ids = [...(xml || '').matchAll(/<w:footnote\s[^>]*w:id="(-?\d+)"/g)].map((m) => parseInt(m[1], 10));
    this.next = Math.max(0, ...ids) + 1;
    this.before = [...(xml || '').matchAll(/<w:footnote\s(?![^>]*w:type=)[^>]*>/g)].length;
  }

  get used(): boolean {
    return this.written.length > 0;
  }

  /** The reference mark; the note itself is written the first time only. */
  ref(n: number, ctx: WordContext): string {
    const refStyle = xmlEscape(ctx.styles.id('footnoteReference'));
    const known = this.shown.get(n);
    // Cited again: the same number, as Obsidian shows it.
    if (known !== undefined) return `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:t>${known}</w:t></w:r>`;
    const md = this.notes.get(n);
    if (md === undefined) return '';
    const id = this.next++;
    const text = renderInline(marked.Lexer.lexInline(md), { ...ctx, rels: this.rels });
    this.written.push(
      `<w:footnote w:id="${id}"><w:p>${pPr({ style: ctx.styles.id('footnoteText') })}` +
        `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${text}</w:p></w:footnote>`
    );
    this.shown.set(n, this.before + this.written.length);
    return `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  }

  toXml(): string {
    const sep = (type: string, id: number, mark: string) =>
      `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r>${mark}</w:r></w:p></w:footnote>`;
    const xml = this.xml ||
      `${XML_DECL}<w:footnotes xmlns:w="${NS.w}" xmlns:r="${NS.r}">` +
        sep('separator', -1, '<w:separator/>') + sep('continuationSeparator', 0, '<w:continuationSeparator/>') +
        '</w:footnotes>';
    return ensureRootNs(xml, 'r', NS.r).replace(/<\/w:footnotes>\s*$/, this.written.join('') + '</w:footnotes>');
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

function pictureRun(p: Picture, ctx: WordContext): string {
  const n = ctx.ids.drawing++;
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
function rasterPicture(img: RasterImage, key: string, rels: Relationships, ctx: WordContext): Omit<Picture, 'cx' | 'cy'> | null {
  const png = parseDataUrl(img.png);
  if (!png) return null;
  const id = ctx.media.add(rels, key + ':png', png.bytes, png.ext);
  const svg = img.svg ? ctx.media.add(rels, key + ':svg', new TextEncoder().encode(img.svg), 'svg') : undefined;
  return { id, svg };
}

/**
 * Draws behind the text of a header part, in points from the top-left corner
 * of the page, with the argument order of a canvas (`x, y, width, height`).
 */
interface PageArt {
  /** A solid rectangle. */
  rect(color: string, x: number, y: number, width: number, height: number): string;
  /** A data-URL picture, `width` points wide; without `height`, its height follows its proportions. */
  image(url: string, key: string, x: number, y: number, width: number, height?: number): string;
}

/** A `PageArt` whose pictures belong to the header part that `rels` describes. */
function pageArt(rels: Relationships, ctx: WordContext): PageArt {
  const anchored = (id: string, x: number, y: number, width: number, height: number) =>
    pictureRun({ id, cx: width * EMU_PER_PT, cy: height * EMU_PER_PT, anchor: { x: x * EMU_PER_PT, y: y * EMU_PER_PT } }, ctx);
  return {
    rect(color, x, y, width, height) {
      const rgb = hex(color);
      return anchored(ctx.media.add(rels, 'solid:' + rgb, solidPng(rgb), 'png'), x, y, width, height);
    },
    image(url, key, x, y, width, height) {
      const img = parseDataUrl(url);
      if (!img || img.ext === 'svg') return '';
      const size = imageSize(img.bytes);
      const proportional = size && size.w ? (width * size.h) / size.w : width;
      return anchored(ctx.media.add(rels, key, img.bytes, img.ext), x, y, width, height ?? proportional);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

interface TocEntry {
  level: number;
  text: string;
  bookmark: string;
}

interface WordContext {
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
  /** The note's footnotes, written as Word's own. */
  notes: FootnoteBook;
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

function rPr(format: Fmt, ctx: WordContext): string {
  const parts = [
    format.code ? `<w:rStyle w:val="${xmlEscape(ctx.styles.id('inlineCode'))}"/>` : format.link ? `<w:rStyle w:val="${xmlEscape(ctx.styles.id('hyperlink'))}"/>` : '',
    format.font ? fontEl(format.font) : '',
    format.bold ? '<w:b/><w:bCs/>' : '',
    format.italic ? '<w:i/><w:iCs/>' : '',
    format.strike ? '<w:strike/>' : '',
    format.color ? `<w:color w:val="${format.color}"/>` : '',
    format.size ? sizeEl(format.size) : '',
    format.mark ? `<w:shd w:val="clear" w:color="auto" w:fill="${format.mark}"/>` : ''
  ].join('');
  return parts ? `<w:rPr>${parts}</w:rPr>` : '';
}

/** A run of text; line breaks and tabs become Word's own. */
function run(text: string, format: Fmt, ctx: WordContext): string {
  const body = text
    .split('\n')
    .map((line) => line.split('\t').map((s) => (s ? `<w:t xml:space="preserve">${xmlEscape(s)}</w:t>` : '')).join('<w:tab/>'))
    .join('<w:br/>');
  return body ? `<w:r>${rPr(format, ctx)}${body}</w:r>` : '';
}

/** A Word field: PAGE, NUMPAGES, PAGEREF… with the text shown until Word updates it. */
function field(instr: string, shown: string, format: Fmt, ctx: WordContext): string {
  const props = rPr(format, ctx);
  return `<w:r>${props}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${props}<w:instrText xml:space="preserve"> ${xmlEscape(instr)} </w:instrText></w:r>` +
    `<w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r>${run(shown, format, ctx)}<w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
}

function markFill(preset: Preset): string {
  return hex(tint(tlpColor(preset, 'AMBER').bg, 0.75));
}

function renderInline(tokens: MdToken[] | undefined, ctx: WordContext, inherited: Fmt = {}): string {
  if (!tokens) return '';
  let out = '';
  // As in the PDF: spans are not printed, only their text, highlighted while
  // one that marks a restricted phrase is open.
  const spans: boolean[] = [];
  for (const token of tokens) {
    const html = token.type === 'html' ? String(token.text ?? '') : '';
    if (/^<span\b/i.test(html)) { spans.push(html.includes(PHRASE_MARK_ATTR)); continue; }
    if (/^<\/span\s*>$/i.test(html)) { spans.pop(); continue; }
    const format: Fmt = spans.includes(true) ? { ...inherited, mark: markFill(ctx.preset) } : inherited;
    switch (token.type) {
      case 'text':
        out += token.tokens && token.tokens.length ? renderInline(token.tokens, ctx, format) : run(decodeEntities(token.text), format, ctx);
        break;
      case 'strong': out += renderInline(token.tokens, ctx, { ...format, bold: true }); break;
      case 'em': out += renderInline(token.tokens, ctx, { ...format, italic: true }); break;
      case 'del': out += renderInline(token.tokens, ctx, { ...format, strike: true }); break;
      case 'codespan': out += run(decodeEntities(token.text), { ...format, code: true }, ctx); break;
      case 'br': out += '<w:r><w:br/></w:r>'; break;
      case 'escape': out += run(String(token.text ?? ''), format, ctx); break;
      case 'link': {
        const href = String(token.href || '');
        const runs = renderInline(token.tokens, ctx, { ...format, link: true });
        if (/^https?:|^mailto:/i.test(href)) {
          const id = ctx.rels.add(REL_TYPES.hyperlink, href, true);
          out += `<w:hyperlink r:id="${id}" w:history="1">${runs}</w:hyperlink>`;
        } else {
          out += runs;
        }
        break;
      }
      case 'image': break; // a block of its own, see paragraph()
      case 'html':
        // A footnote reference; as in the PDF, a line break breaks, any other
        // tag is printed as written.
        if (FOOTNOTE_TAG_RE.test(html.trim())) out += ctx.notes.ref(Number(FOOTNOTE_TAG_RE.exec(html.trim())?.[1]), ctx);
        else out += /^<br\s*\/?>$/i.test(html.trim()) ? '<w:r><w:br/></w:r>' : run(html, format, ctx);
        break;
      default:
        if (token.text) out += run(decodeEntities(token.text), format, ctx);
    }
  }
  return out;
}

/** A tag `renderInline` prints as written, as the plain text shows it too. */
function printedTag(html: string): string {
  const tag = html.trim();
  if (/^<\/?span\b/i.test(tag) || FOOTNOTE_TAG_RE.test(tag)) return '';
  return /^<br\s*\/?>$/i.test(tag) ? ' ' : tag;
}

/** The text of inline tokens as the reader sees it: the table of contents shows it before Word updates it. */
function plainText(tokens: MdToken[] | undefined): string {
  return (tokens || [])
    .map((token) => (token.tokens ? plainText(token.tokens) : token.type === 'html' ? printedTag(String(token.text ?? '')) : decodeEntities(token.text ?? '')))
    .join('');
}

/* Images ------------------------------------------------------------ */

function imageBlock(token: MdToken, ctx: WordContext): string {
  const href = String(token.href || '');
  const ref = IMAGE_REF_RE.exec(href);
  const url = ref ? ctx.images[ref[1]] : /^data:image\//i.test(href) ? href : null;
  const img = parseDataUrl(url);
  if (!img || img.ext === 'svg') {
    const label = token.text || token.href || '';
    return label ? para({ style: ctx.styles.id('caption') }, run('[' + tr('inline.image', { label }) + ']', {}, ctx)) : '';
  }
  const id = ctx.media.add(ctx.rels, ref ? ref[1] : href, img.bytes, img.ext);
  const size = imageSize(img.bytes);
  const hint = parseInt(String(token.title), 10);
  const px = !isNaN(hint) && hint > 0 ? hint : size?.w || 600;
  const cx = Math.min(px * EMU_PER_PX, ctx.width * EMU_PER_TWIP);
  const cy = size && size.w ? (cx * size.h) / size.w : cx * 0.75;
  return para(
    { jc: 'center', spacing: `<w:spacing w:before="${tw(6)}" w:after="${tw(8)}"/>` },
    pictureRun({ id, cx, cy, alt: String(token.text || '') }, ctx)
  );
}

/* Blocks ------------------------------------------------------------ */

function paragraph(t: MdToken, ctx: WordContext): string {
  const toks = t.tokens || [];
  if (toks.some((x) => x.type === 'image')) {
    let out = '';
    let buf: MdToken[] = [];
    const flush = () => {
      if (buf.length && plainText(buf).trim()) out += para({ style: ctx.styles.id('body') }, renderInline(buf, ctx));
      buf = [];
    };
    for (const token of toks) {
      if (token.type === 'image') { flush(); out += imageBlock(token, ctx); }
      else buf.push(token);
    }
    flush();
    return out;
  }
  const plain = plainText(toks).trim();
  if (CAPTION_RE.test(plain)) return caption(plain, ctx);
  return para({ style: ctx.styles.id('body') }, renderInline(toks, ctx));
}

/**
 * A caption. "Figure 3: …" gets its number as a sequence field, as Word's own
 * Insert Caption does, so Word's table of figures lists it and numbers it
 * again when a figure is added; the number written stays shown until then.
 */
function caption(text: string, ctx: WordContext): string {
  const style = ctx.styles.id('caption');
  const m = /^(\S+?)(\s+)(\d+)(?![\d.,]\d)([\s\S]*)$/.exec(text);
  if (!m || !CAPTION_RE.test(m[1])) return para({ style }, run(text, {}, ctx));
  // "Fig." counts with the figures; any other label keeps a list of its own.
  const label = /^fig\.?$/i.test(m[1]) ? 'Figure' : m[1].replace(/[^\p{L}\p{N}_]/gu, '');
  const seq = label.charAt(0).toUpperCase() + label.slice(1);
  return para({ style }, run(m[1] + m[2], {}, ctx) + field(`SEQ ${seq} \\* ARABIC`, m[3], {}, ctx) + run(m[4], {}, ctx));
}

function heading(t: MdToken, ctx: WordContext, breakBefore: boolean): string {
  const depth = Math.min(Math.max(Number(t.depth) || 1, 1), HEADING_LEVELS);
  const i = depth - 1;
  ctx.counters[i] = (ctx.counters[i] || 0) + 1;
  for (let k = depth; k < HEADING_LEVELS; k++) ctx.counters[k] = 0;

  const toc = ctx.preset.toc || defaultToc();
  const style = ctx.styles.get(`heading${depth}` as WordRole);
  // A template whose heading styles number themselves keeps its numbering;
  // otherwise the PDF template's numbering is written as text.
  const label = style.numbered ? '' : headingLabel(toc, ctx.counters, i);
  // A bookmark per heading: the table of contents links to it.
  const n = ctx.ids.bookmark++;
  const name = `_TocReport${n}`;
  if (toc.levels[i]) ctx.toc.push({ level: depth, text: label + plainText(t.tokens).trim(), bookmark: name });
  return para(
    { style: style.id, pageBreakBefore: breakBefore },
    `<w:bookmarkStart w:id="${n}" w:name="${name}"/>` + (label ? run(label, {}, ctx) : '') + renderInline(t.tokens, ctx) + `<w:bookmarkEnd w:id="${n}"/>`
  );
}

function list(t: MdToken, ctx: WordContext, depth: number, numId: number | null): string {
  const asColumns = listColumns(t);
  if (asColumns) return columns(asColumns, {}, ctx);

  const items = t.items || [];
  const tasks = items.some((it) => it.task);
  const id = tasks ? null : numId ?? ctx.numbering.list(!!t.ordered, Number(t.start) || 1);
  const level = Math.min(depth, 8);
  const indent = `<w:ind w:left="${720 * (level + 1)}"/>`;
  const style = ctx.styles.id('listParagraph');
  let out = '';
  for (const item of items) {
    let first = true;
    for (const token of item.tokens || []) {
      if (token.type === 'list') {
        // A nested list of the same kind continues the instance one level
        // down; another kind needs an instance of its own.
        const same = !!token.ordered === !!t.ordered && !tasks && !(token.items || []).some((x) => x.task);
        out += list(token, ctx, depth + 1, same ? id : null);
        continue;
      }
      if (token.type === 'text' || token.type === 'paragraph') {
        // A task list has no Word numbering: its boxes are text, and so is the
        // bullet of an item in it that is not a task.
        const box = !first || !tasks ? ''
          : item.task ? run(item.checked ? '☑ ' : '☐ ', { color: item.checked ? hex(ctx.preset.colors.brand) : '767676' }, ctx)
          : run('• ', {}, ctx);
        const runs = renderInline(token.tokens || [{ type: 'text', text: token.text }], ctx);
        out += para(first && id !== null ? { style, num: { id, level } } : { style, ind: indent }, box + runs);
        first = false;
        continue;
      }
      out += renderBlock(token, { ...ctx, top: false });
      first = false;
    }
  }
  return out;
}

/** A table: header row repeated on each page, widths measured as in the PDF. */
function grid(
  header: string[],
  rows: string[][],
  ctx: WordContext,
  o: { widths?: number[]; align?: string[]; cell?: (text: string, row: number, col: number, format: Fmt) => string } = {}
): string {
  const cols = Math.max(header.length, ...rows.map((r) => r.length));
  if (!cols) return '';
  let pts = o.widths;
  if (!pts) {
    const cells: TableCell[][] = [header, ...rows].map((r, i) => r.map((text) => ({ runs: [{ text }], bold: i === 0 })));
    const fit = fitTable(cells, {
      width: ctx.width / 20, font: ctx.preset.fonts.bodyFont, fontSize: bodySize(ctx.preset) - 1, padding: 10, rule: 0.75
    });
    pts = fit ? fit.widths : new Array<number>(cols).fill(1);
  }
  const total = pts.reduce((a, b) => a + b, 0) || 1;
  const twips = pts.map((p) => Math.max(200, Math.round((p / total) * ctx.width)));
  // A table style of our own is the PDF's: its header text and tight rows are
  // written on the cells too, as the body style's colour and spacing would
  // otherwise win over the table style's. A template's own style is left alone.
  const own = ctx.styles.isOwn('table');
  const head: Fmt = own ? { bold: true, color: hex(ctx.preset.colors.tableHeaderText, 'FFFFFF') } : { bold: true };
  const tight = own ? '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' : undefined;
  const cell = (text: string, i: number, j: number) =>
    `<w:tc><w:tcPr><w:tcW w:w="${twips[j]}" w:type="dxa"/></w:tcPr>` +
    para({ jc: o.align?.[j] || 'left', spacing: tight }, o.cell ? o.cell(text, i, j, i === 0 ? head : {}) : run(text, i === 0 ? head : {}, ctx)) +
    '</w:tc>';
  const row = (r: string[], i: number) =>
    `<w:tr>${i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
    Array.from({ length: cols }, (_, j) => cell(r[j] ?? '', i, j)).join('') +
    '</w:tr>';
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="${xmlEscape(ctx.styles.id('table'))}"/><w:tblW w:w="${twips.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    '<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
    `<w:tblGrid>${twips.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>` +
    [header, ...rows].map(row).join('') +
    '</w:tbl>' +
    // Two tables in a row would merge in Word; an empty paragraph keeps them apart.
    para({ spacing: `<w:spacing w:before="0" w:after="${tw(6)}"/>` }, '')
  );
}

function table(t: MdToken, ctx: WordContext): string {
  const header = t.header || [];
  const rows = t.rows || [];
  // Cells keep their inline formatting; the text alone sizes the columns.
  const tokens = [header.map((c) => c.tokens), ...rows.map((r) => r.map((c) => c.tokens))];
  return grid(
    header.map((c) => plainText(c.tokens)),
    rows.map((r) => r.map((c) => plainText(c.tokens))),
    ctx,
    {
      align: (t.align || []).map((a) => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left')),
      cell: (_text, i, j, format) => renderInline(tokens[i]?.[j] || [], ctx, format)
    }
  );
}

function code(text: string, ctx: WordContext): string {
  return para({ style: ctx.styles.id('code') }, run(text.replace(/\n$/, ''), {}, ctx));
}

/** A Mermaid diagram as the host drew it, or its source when there is no drawing. */
function diagram(t: MdToken, ctx: WordContext): string {
  const key = diagramKey(t.text ?? '');
  const img = ctx.diagrams.get(key);
  const pic = img ? rasterPicture(img, 'diagram:' + key, ctx.rels, ctx) : null;
  if (!img || !pic) {
    ctx.warnings.add(tr('word.diagramsAsCode'));
    return code(String(t.text ?? ''), ctx);
  }
  // Never wider than drawn on screen (px -> pt), never wider than the column.
  const cx = Math.min(img.width * EMU_PER_PX, ctx.width * EMU_PER_TWIP);
  const cy = (cx * img.height) / img.width;
  return para(
    { jc: 'center', spacing: `<w:spacing w:before="${tw(6)}" w:after="${tw(10)}"/>` },
    pictureRun({ ...pic, cx, cy, alt: 'Diagram' }, ctx)
  );
}

function fence(t: MdToken, ctx: WordContext): string {
  const kind = columnsLang(t.lang);
  if (kind === 'col') {
    const group = parseColBlock(String(t.text ?? ''));
    return group.rows.filter((r) => r.length).map((r) => columns(r, group.settings, ctx)).join('');
  }
  // A col-md on its own spans the width, as in the plugin.
  if (kind === 'col-md') return columns([parseColMd(String(t.text ?? ''))], {}, ctx);
  if (isMermaidLang(t.lang)) return diagram(t, ctx);
  return code(String(t.text ?? ''), ctx);
}

/** Border (3pt) plus left and right padding (10pt each), as in the PDF's boxes. */
const BOX_INSET = tw(23);

/** A one-cell table: a bar of colour on the left, a tinted fill, the content inside. */
function box(inner: string, accent: string, fill: string, ctx: WordContext): string {
  const nil = (side: string) => `<w:${side} w:val="nil"/>`;
  const content = /<\/w:p>$/.test(inner) ? inner : inner + '<w:p/>';
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${ctx.width}" w:type="dxa"/>` +
    `<w:tblBorders>${nil('top')}<w:left w:val="single" w:sz="24" w:space="0" w:color="${accent}"/>${nil('bottom')}${nil('right')}${nil('insideH')}${nil('insideV')}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${tw(6)}" w:type="dxa"/><w:left w:w="${tw(10)}" w:type="dxa"/>` +
    `<w:bottom w:w="${tw(2)}" w:type="dxa"/><w:right w:w="${tw(10)}" w:type="dxa"/></w:tblCellMar>` +
    '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${ctx.width}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${ctx.width}" w:type="dxa"/>` +
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

function blockquote(t: MdToken, ctx: WordContext): string {
  const call = parseCallout(String(t.raw || ''));
  const inner: WordContext = { ...ctx, top: false, width: Math.max(tw(40), ctx.width - BOX_INSET) };
  if (call && call.type === 'col') return calloutColumns(call.body, ctx);
  if (call && columnsLang(call.type) === 'col-md') return columns([{ settings: {}, content: call.body }], {}, ctx);
  const brand = ctx.preset.colors.brand;
  if (!call) {
    const body = (t.tokens || []).map((x) => renderBlock(x, inner)).join('');
    return box(body, hex(brand), hex(tint(brand, 0.93)), ctx);
  }

  const style = CALLOUT_STYLES[call.type] || { accent: brand, tint: tint(brand, 0.93), icon: 'info' };
  const accent = hex(style.accent);
  const label = call.type.charAt(0).toUpperCase() + call.type.slice(1);
  const iconImg = ctx.preset.calloutIcons !== false ? ctx.icons[calloutIconKey(style.icon, style.accent)] : undefined;
  const icon = iconImg ? rasterPicture(iconImg, 'icon:' + calloutIconKey(style.icon, style.accent), ctx.rels, ctx) : null;
  const size = bodySize(ctx.preset);
  const title = para(
    { keepNext: !!call.body.trim(), spacing: `<w:spacing w:before="0" w:after="${tw(call.body.trim() ? 4 : 0)}"/>`, jc: 'left' },
    (icon ? pictureRun({ ...icon, cx: 12 * EMU_PER_PT, cy: 12 * EMU_PER_PT, alt: label }, ctx) + run(' ', {}, ctx) : '') +
      renderInline(marked.Lexer.lexInline(call.title || label), ctx, { bold: true, color: accent, size })
  );
  return box(title + (call.body.trim() ? renderBlocks(call.body, inner) : ''), accent, hex(style.tint), ctx);
}

/* Columns ----------------------------------------------------------- */

/** Gutter between two columns, as in the PDF: 12pt. */
const COL_GAP = tw(12);

/** CSS `text-align` as Word's `w:jc`. */
const COL_ALIGN: Record<string, string> = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', centre: 'center', justify: 'both' };

/** Align every paragraph of a column, as the PDF pushes it down to every line. */
function alignAll(xml: string, jc: string): string {
  return xml
    .replace(/<w:p>(?!<w:pPr>)/g, `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>`)
    .replace(/<w:pPr>((?:(?!<\/w:pPr>)[\s\S])*?)<\/w:pPr>/g, (_m, inner: string) =>
      `<w:pPr>${inner.replace(/<w:jc w:val="[^"]*"\/>/, '')}<w:jc w:val="${jc}"/></w:pPr>`);
}

/** A CSS length in twips; a bare number is pixels, as in CSS. */
function cssTwips(value: string | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?)[ \t]*(px|pt|em|rem)?$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'px').toLowerCase();
  return tw(unit === 'pt' ? n : unit === 'px' ? n * 0.75 : n * 11);
}

/** The border a column asks for, on every side of its cell; null for none. */
function colBorder(s: ColSettings, ctx: WordContext): { xml: string; pad: number } | null {
  if (!['bordercolor', 'borderstyle', 'borderwidth', 'borderradius', 'borderpadding'].some((k) => k in s)) return null;
  const style = String(s.borderstyle ?? '').trim().toLowerCase();
  if (style === 'none' || style === 'hidden') return null;
  const width = cssTwips(s.borderwidth) ?? tw(0.75);
  const val = style === 'dashed' ? 'dashed' : style === 'dotted' ? 'dotted' : 'single';
  // `w:sz` is in eighths of a point; the plugin's white default is invisible on paper.
  const color = hex(s.bordercolor, hex(ctx.preset.colors.tableBorder));
  const sz = Math.min(96, Math.max(2, Math.round((width / 20) * 8)));
  const side = (k: string) => `<w:${k} w:val="${val}" w:sz="${sz}" w:space="0" w:color="${color}"/>`;
  return { xml: `<w:tcBorders>${['top', 'left', 'bottom', 'right'].map(side).join('')}</w:tcBorders>`, pad: cssTwips(s.borderpadding) ?? 0 };
}

/**
 * One row of columns, side by side: a borderless table, each cell as wide as
 * its `flexGrow` share, with the PDF's gutter between them. A table rather
 * than Word's own section columns, which flow text from one column into the
 * next instead of keeping each column's content apart.
 */
function columns(cols: ColumnSpec[], group: ColSettings, ctx: WordContext): string {
  if (!cols.length) return '';
  const grows = cols.map((c) => {
    const g = parseFloat(String(c.settings.flexgrow ?? ''));
    return isFinite(g) && g > 0 ? g : 1;
  });
  const total = grows.reduce((a, b) => a + b, 0);
  const avail = Math.max(tw(40) * cols.length, ctx.width - COL_GAP * (cols.length - 1));
  const half = Math.round(COL_GAP / 2);
  const widths = grows.map((g, i) => Math.max(tw(40), Math.round((avail * g) / total)) + (i > 0 ? half : 0) + (i < cols.length - 1 ? half : 0));
  const nil = (side: string) => `<w:${side} w:val="nil"/>`;
  const groupAlign = COL_ALIGN[String(group.textalign ?? '').trim().toLowerCase()];
  const cells = cols.map((c, i) => {
    const border = colBorder(c.settings, ctx);
    const left = i > 0 ? half : 0;
    const right = i < cols.length - 1 ? half : 0;
    const pad = border ? border.pad : 0;
    const inner = widths[i] - left - right - 2 * pad;
    let xml = renderBlocks(c.content, { ...ctx, top: false, width: Math.max(tw(40), inner) });
    const align = COL_ALIGN[String(c.settings.textalign ?? '').trim().toLowerCase()] || groupAlign;
    if (align) xml = alignAll(xml, align);
    // A cell must end with a paragraph.
    if (!/<\/w:p>$/.test(xml)) xml += '<w:p/>';
    const mar = `<w:tcMar><w:top w:w="${pad}" w:type="dxa"/><w:left w:w="${left + pad}" w:type="dxa"/><w:bottom w:w="${pad}" w:type="dxa"/><w:right w:w="${right + pad}" w:type="dxa"/></w:tcMar>`;
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${border ? border.xml : ''}${mar}</w:tcPr>${xml}</w:tc>`;
  });
  const sum = widths.reduce((a, b) => a + b, 0);
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${sum}" w:type="dxa"/>` +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(nil).join('')}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
    `<w:tblGrid>${widths.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>` +
    // A row of columns stays on one page, as in the PDF.
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr></w:tbl>` +
    para({ spacing: `<w:spacing w:before="0" w:after="${tw(6)}"/>` }, '')
  );
}

/** `> [!col]`: each item a column; a nested `> [!col-md-2]` one column 2 units wide. */
function calloutColumns(body: string, ctx: WordContext): string {
  const cols: ColumnSpec[] = [];
  for (const token of lex(body)) {
    if (token.type === 'space') continue;
    const inner = token.type === 'blockquote' ? parseCallout(String(token.raw || '')) : null;
    if (inner && columnsLang(inner.type) === 'col-md') {
      const span = calloutSpan(inner.type);
      cols.push({ settings: span ? { flexgrow: String(span) } : {}, content: inner.body });
      continue;
    }
    cols.push({ settings: {}, content: String(token.raw || '') });
  }
  return columns(cols, {}, ctx);
}

function hr(): string {
  return para({ border: '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/>' }, '');
}

/** Where a restricted passage this version keeps begins: its label on amber. */
function markStart(label: string, ctx: WordContext): string {
  const amber = tlpColor(ctx.preset, 'AMBER');
  return para(
    { keepNext: true, border: `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${hex(amber.bg)}"/>` },
    run(` ${label} `, { bold: true, color: hex(amber.fg), mark: hex(amber.bg), size: 7.5 }, ctx) +
      run('  ' + tr('audience.bannerNote'), { italic: true, color: '6B6B6B', size: 7.5 }, ctx)
  );
}

/** Where it ends: a dashed rule in the same colour. */
function markEnd(ctx: WordContext): string {
  return para(
    { border: `<w:bottom w:val="dashed" w:sz="6" w:space="1" w:color="${hex(tlpColor(ctx.preset, 'AMBER').bg)}"/>`, spacing: `<w:spacing w:after="${tw(10)}"/>` },
    ''
  );
}

function renderBlock(t: MdToken, ctx: WordContext): string {
  switch (t.type) {
    case 'heading': return heading(t, ctx, false);
    case 'paragraph': return paragraph(t, ctx);
    case 'list': return list(t, ctx, 0, null);
    case 'table': return table(t, ctx);
    case 'code': return fence(t, ctx);
    case 'blockquote': return blockquote(t, ctx);
    case 'hr': return hr();
    default: return '';
  }
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** A Markdown string as body XML, with page breaks and confidentiality marks. */
function renderBlocks(md: string, ctx: WordContext): string {
  const breaks = (ctx.preset.toc || defaultToc()).pageBreak;
  let out = '';
  let pending = false;
  for (const t of lex(md)) {
    if (isPageBreakToken(t)) { pending = true; continue; }
    if (t.type === 'html') {
      const raw = String(t.raw || t.text || '').trim();
      const start = MARK_START_RE.exec(raw);
      if (start) { out += markStart(start[1], ctx); continue; }
      if (MARK_END_RE.test(raw)) { out += markEnd(ctx); continue; }
    }
    if (t.type === 'space') continue;
    if (pending) { out += PAGE_BREAK; pending = false; }

    if (t.type === 'heading') {
      // As in the PDF: not at the very start, and a chain of headings moves together.
      const breakBefore = ctx.top && breaks[(t.depth ?? 1) - 1] === true && ctx.breakable;
      out += heading(t, ctx, breakBefore);
      ctx.breakable = false;
      continue;
    }
    const xml = renderBlock(t, ctx);
    if (xml) { out += xml; ctx.breakable = true; }
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
function tocField(ctx: WordContext, title: string | null): string {
  const toc = ctx.preset.toc || defaultToc();
  const deepest = toc.levels.lastIndexOf(true) + 1;
  if (!deepest) return '';
  const tab = `<w:tab w:val="right" w:leader="dot" w:pos="${ctx.width}"/>`;
  const begin =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> TOC \\o "1-${deepest}" \\h \\z \\u </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
  const entries = ctx.toc.map((e, i) =>
    para(
      { style: ctx.styles.id(`toc${e.level}` as WordRole), tabs: tab },
      (i === 0 ? begin : '') +
        `<w:hyperlink w:anchor="${e.bookmark}" w:history="1">${run(e.text, {}, ctx)}<w:r><w:tab/></w:r>` +
        field(`PAGEREF ${e.bookmark} \\h`, '', {}, ctx) +
        '</w:hyperlink>'
    )
  );
  const body = entries.length
    ? entries.join('') + para({}, '<w:r><w:fldChar w:fldCharType="end"/></w:r>')
    : para({}, begin + '<w:r><w:fldChar w:fldCharType="end"/></w:r>');
  const heading = title ? para({ style: ctx.styles.id('tocHeading') }, run(title, {}, ctx)) : '';
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
function coverText(vars: ReportVars, ctx: WordContext, top: number, left: number): { xml: string; ruleY: number } {
  const p = ctx.preset;
  const cv = p.layout.cover;
  const raw = (vars.coverTitle || vars.docTitle || 'REPORT').toUpperCase();
  const fitted = fitCoverTitle(raw, cv.titleSize, cv.titleMaxChars);
  const lines = fitted.text.split('\n');
  const titleBottom = cv.titleY + lines.length * fitted.fontSize * COVER_LINE;
  const next = cv.showRule !== false ? cv.ruleY : Math.min(cv.subtitleY, cv.acronymY);
  const shift = Math.max(0, Math.ceil(titleBottom + 4 - next));

  let cursor = top;
  let xml = '';
  const line = (style: WordRole, text: string, y: number, size: number, format: Fmt) => {
    const before = Math.max(0, y - cursor);
    const height = size * COVER_LINE;
    cursor = Math.max(cursor, y) + height * text.split('\n').length;
    xml += para(
      {
        style: ctx.styles.id(style),
        spacing: `<w:spacing w:before="${tw(before)}" w:after="0" w:line="${tw(height)}" w:lineRule="exact"/>`,
        ind: `<w:ind w:left="${tw(cv.x - left)}"/>`
      },
      run(text, { ...format, size }, ctx)
    );
  };
  line('title', fitted.text, cv.titleY, fitted.fontSize, {});
  if (vars.coverSubtitle) line('subtitle', vars.coverSubtitle, cv.subtitleY + shift, cv.subtitleSize, { font: wordFont(p.fonts.bodyFont, 'Arial') });
  if (vars.coverSubtitle2) line('subtitle', vars.coverSubtitle2, cv.acronymY + shift, cv.acronymSize, { font: wordFont(p.fonts.headingFont, 'Arial Black'), color: '141414' });
  return { xml, ruleY: cv.ruleY + shift };
}

/** The cover's artwork, or the built-in decoration, with the logo and the rule. */
function coverHeader(ctx: WordContext, rels: Relationships, ruleY: number, logo: string | null): string {
  const p = ctx.preset;
  const C = p.colors;
  const cv = p.layout.cover;
  const draw = pageArt(rels, ctx);
  // The artwork, when Word can show it; otherwise the decoration, as in the PDF.
  let art = p.assets.coverBg ? draw.image(p.assets.coverBg, 'coverBg', 0, 0, PAGE_W, PAGE_H) : '';
  if (!art && p.layout.decor !== false) {
    // Word has no lines to anchor: the bracket's strokes are thin rectangles,
    // the vertical one capped by half a stroke at each end to close the corners.
    const { x, top, bottom } = coverBracket(p, ruleY - cv.ruleY);
    const stroke = DECOR.bracketStroke;
    const half = stroke / 2;
    art +=
      draw.rect(C.brand, 0, 0, DECOR.coverBar, PAGE_H) +
      draw.rect(C.brand, x - half, top - half, stroke, bottom - top + stroke) +
      draw.rect(C.brand, x, top - half, DECOR.bracketArm, stroke) +
      draw.rect(decorAccents(p).bracketEnd, x, bottom - half, DECOR.bracketArm, stroke) +
      draw.rect(C.dark, 0, PAGE_H - DECOR.coverFootBand, PAGE_W, DECOR.coverFootBand) +
      draw.rect(C.brand, 0, PAGE_H - DECOR.coverFootBand - DECOR.coverFootRule, PAGE_W * DECOR.ruleSpan, DECOR.coverFootRule);
  }
  if (cv.showRule !== false) art += draw.rect('#141414', cv.x, ruleY, cv.ruleW, 3);
  if (logo) art += draw.image(logo, 'coverLogo', cv.logoX, cv.logoY, cv.logoW);
  return `${XML_DECL}<w:hdr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${para({}, art)}</w:hdr>`;
}

/** The header of every other page: the frame artwork or the bands, then the title and the client. */
function frameHeader(vars: ReportVars, ctx: WordContext, rels: Relationships, right: number): string {
  const p = ctx.preset;
  const C = p.colors;
  const draw = pageArt(rels, ctx);
  let art = p.assets.frame ? draw.image(p.assets.frame, 'frame', 0, 0, PAGE_W, PAGE_H) : '';
  if (!art && p.layout.decor !== false) {
    art +=
      draw.rect(C.banner, 0, 0, PAGE_W, DECOR.headerBand) +
      draw.rect(decorAccents(p).bannerRule, 0, DECOR.headerBand, PAGE_W, DECOR.accentRule) +
      draw.rect(C.dark, 0, PAGE_H - DECOR.footerBand, PAGE_W, DECOR.footerBand) +
      draw.rect(C.brand, 0, PAGE_H - DECOR.footerBand - DECOR.accentRule, PAGE_W * DECOR.ruleSpan, DECOR.accentRule);
  }
  // The text ends where the PDF's does, `headerRight` from the edge of the page.
  const ind = `<w:ind w:right="${tw(p.layout.headerRight - right)}"/>`;
  const format: Fmt = { color: hex(C.headerText), size: 12, font: wordFont(p.fonts.bodyFont, 'Arial') };
  return (
    `${XML_DECL}<w:hdr xmlns:w="${NS.w}" xmlns:r="${NS.r}">` +
    para({ jc: 'right', ind, spacing: '<w:spacing w:before="0" w:after="0"/>' }, art + run(vars.docTitle || '', format, ctx)) +
    (vars.client ? para({ jc: 'right', ind, spacing: `<w:spacing w:before="${tw(4)}" w:after="0"/>` }, run(vars.client, format, ctx)) : '') +
    '</w:hdr>'
  );
}

/** The footer: the TLP marking, then the page number, at the right as in the PDF. */
function footerXml(ctx: WordContext, tlp: TlpKey | null, right: number): string {
  const p = ctx.preset;
  const ind = `<w:ind w:right="${tw(p.layout.footerRight - right)}"/>`;
  const font = wordFont(p.fonts.bodyFont, 'Arial');
  const paging = String(p.layout.pagination ?? '')
    .split(/(\{\{\s*(?:page|total|pages)\s*\}\})/i)
    .map((part) => {
      const format: Fmt = { color: hex(p.colors.footerText), size: 10, font };
      const key = /^\{\{\s*(page|total|pages)\s*\}\}$/i.exec(part)?.[1].toLowerCase();
      // {{page}} and {{total}} become Word fields, so the numbers stay right.
      if (key) return field(key === 'page' ? 'PAGE' : 'NUMPAGES', '1', format, ctx);
      return run(part, format, ctx);
    })
    .join('');
  const lines =
    (tlp
      ? para(
          { jc: 'right', ind, spacing: '<w:spacing w:before="0" w:after="0"/>' },
          run('TLP:' + tlp, { bold: true, color: hex(tlpColor(p, tlp).bg), size: 11, font }, ctx)
        )
      : '') +
    (String(p.layout.pagination ?? '').trim()
      ? para({ jc: 'right', ind, spacing: `<w:spacing w:before="${tw(tlp ? 2 : 7)}" w:after="0"/>` }, paging)
      : '');
  return `${XML_DECL}<w:ftr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${lines || para({}, '')}</w:ftr>`;
}

/** Where the footer sits from the bottom edge, so its text lands where the PDF prints it. */
function footerDistance(ctx: WordContext, tlp: boolean): number {
  const L = ctx.preset.layout;
  const height = (tlp ? 13 : 0) + (String(L.pagination ?? '').trim() ? (tlp ? 2 : 7) + 12 : 0);
  return Math.max(0, L.pageMargins[3] - L.footerY - height);
}

/** The references page: document status, contacts, recipients, with empty rows to fill by hand. */
function references(vars: ReportVars, ctx: WordContext): string {
  const L = ctx.preset.labels || defaultLabels();
  const title = (role: WordRole, text: string) => para({ style: ctx.styles.id(role) }, run(text, {}, ctx));
  const recipients = vars.recipients || [];
  return (
    title('sectionTitle', L.references) +
    title('sectionSubtitle', L.status) +
    versionsTable(vars.versions || [], ctx, HAND_ROWS) +
    title('sectionSubtitle', L.contacts) +
    contactsTable(vars.contacts || [], 'contacts', ctx, HAND_ROWS) +
    (ctx.preset.showRecipients || recipients.length
      ? title('sectionSubtitle', L.recipients) + contactsTable(recipients, 'recipients', ctx, HAND_ROWS)
      : '')
  );
}

/** Rows the references page always has, empty ones to fill by hand after printing. */
const HAND_ROWS = 3;

/** `rows`, with empty rows added up to `count`. */
function padRows(rows: string[][], count: number): string[][] {
  while (rows.length < count) rows.push(['', '', '']);
  return rows;
}

/** The document status: version, date and status of each line of `versions`. */
function versionsTable(versions: DocVersion[], ctx: WordContext, minRows = 0): string {
  const L = ctx.preset.labels || defaultLabels();
  const rows = versions.map((v) => [v.version ?? '', v.date ?? '', v.etat ?? '']);
  return grid([L.versionColumn, L.versionDate, L.versionState], padRows(rows, minRows), ctx, {
    widths: [70, 90, Math.max(100, ctx.width / 20 - 160)]
  });
}

/** Contacts or recipients: name, role (or company), email in the link colour. */
function contactsTable(people: DocContact[], kind: 'contacts' | 'recipients', ctx: WordContext, minRows = 0): string {
  const L = ctx.preset.labels || defaultLabels();
  const header =
    kind === 'contacts' ? [L.contactColumn, L.contactRole, L.contactEmail] : [L.recipientColumn, L.recipientRole, L.recipientEmail];
  const rows = people.map((c) => [c.nom ?? '', c.poste || c.societe || '', c.courriel ?? '']);
  return grid(header, padRows(rows, minRows), ctx, {
    widths: [1, 1, 1],
    cell: (text, i, j, format) => run(text, i === 0 ? format : j === 2 ? { color: hex(ctx.preset.colors.link) } : {}, ctx)
  });
}

/** The TLP reminder page: each level's badge beside its definition. */
function tlpReminder(ctx: WordContext): string {
  const p = ctx.preset;
  const L = p.labels || defaultLabels();
  const nil = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="nil"/>`).join('');
  const badge = tw(80);
  const rows = (p.tlpReminder || []).map((lv) => {
    const col = tlpColor(p, lv.key);
    return (
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="${badge}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${hex(col.bg)}"/><w:vAlign w:val="center"/></w:tcPr>` +
      para({ jc: 'center', spacing: '<w:spacing w:before="0" w:after="0"/>' }, run('TLP:' + lv.key, { bold: true, color: hex(col.fg), size: bodySize(p) - 2 }, ctx)) +
      `</w:tc><w:tc><w:tcPr><w:tcW w:w="${ctx.width - badge}" w:type="dxa"/></w:tcPr>` +
      para({ style: ctx.styles.id('body'), spacing: `<w:spacing w:before="0" w:after="${tw(12)}"/>` }, run(lv.text, { size: bodySize(p) - 1 }, ctx)) +
      '</w:tc></w:tr>'
    );
  });
  return (
    para({ style: ctx.styles.id('sectionTitle') }, run(L.tlpReminder, {}, ctx)) +
    para({ spacing: `<w:spacing w:before="${tw(2)}" w:after="${tw(10)}"/>` }, run(L.tlpReminderSubtitle, { bold: true }, ctx)) +
    (rows.length
      ? `<w:tbl><w:tblPr><w:tblW w:w="${ctx.width}" w:type="dxa"/><w:tblBorders>${nil}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
        '<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tblCellMar>' +
        '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
        `<w:tblGrid><w:gridCol w:w="${badge}"/><w:gridCol w:w="${ctx.width - badge}"/></w:tblGrid>${rows.join('')}</w:tbl>` + para({}, '')
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

/** The package being written, with its main part's relationships and its content types. */
interface DocumentParts {
  pkg: Package;
  /** Path of the main part, `word/document.xml` in a generated package. */
  main: string;
  rels: Relationships;
  contentTypes: ContentTypes;
}

/** A part the main part has at most one of; its relationship and content type share its name. */
type SinglePart = 'styles' | 'numbering' | 'settings' | 'footnotes';

/** The path of the template's own `kind` part, or null when it has none. */
function existingPart(parts: DocumentParts, kind: SinglePart): string | null {
  const rel = parts.rels.ofType(REL_TYPES[kind])[0];
  return rel ? resolveTarget(parts.main, rel.target) : null;
}

/** The path of the `kind` part, created (as `styles.xml`, `numbering.xml`…) when there is none. */
function partOf(parts: DocumentParts, kind: SinglePart): string {
  const existing = existingPart(parts, kind);
  if (existing) return existing;
  const name = `${kind}.xml`;
  parts.rels.add(REL_TYPES[kind], name);
  const path = resolveTarget(parts.main, name);
  parts.contentTypes.setOverride(path, CONTENT_TYPES[kind]);
  return path;
}

/**
 * Text width of the document's last section, in twips. A margin the section
 * does not give is Word's default, one inch; a width that is missing or
 * narrower than an inch falls back to Word's blank A4 page.
 */
function textWidth(doc: string): number {
  const sect = doc.lastIndexOf('<w:sectPr');
  const tail = sect >= 0 ? doc.slice(sect) : '';
  const twips = (el: string, attr: string) => parseInt(attrOf(tail, el, attr) ?? '', 10);
  const marginOr = (value: number) => (isNaN(value) ? ONE_INCH_TW : value);
  const width = twips('w:pgSz', 'w:w') - marginOr(twips('w:pgMar', 'w:left')) - marginOr(twips('w:pgMar', 'w:right'));
  return isFinite(width) && width > ONE_INCH_TW ? width : PAGE_W_TW - 2 * ONE_INCH_TW;
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

/** A header or footer part: its file name under `word/`, its XML and its own relationships. */
interface HeaderFooterPart {
  kind: 'header' | 'footer';
  name: string;
  xml: string;
  rels: Relationships;
}

/** Add a header or footer part to a generated package and return its relationship id. */
function addPart(parts: DocumentParts, part: HeaderFooterPart): string {
  const path = `word/${part.name}`;
  parts.pkg.setText(path, part.xml);
  if (part.rels.list.length) parts.pkg.setText(relsPath(path), part.rels.toXml());
  parts.contentTypes.setOverride(path, CONTENT_TYPES[part.kind]);
  return parts.rels.add(REL_TYPES[part.kind], part.name);
}

export function buildDocx(md: string, vars: ReportVars, preset: Preset, options: DocxOptions = {}): DocxResult {
  const parts = openParts(options.template ? openTemplate(options.template) : skeleton());
  const extracted = extractFootnotes(md);
  const ctx = createContext(parts, preset, options, extracted.notes);
  // The body first: the table of contents lists its headings.
  const report = renderBlocks(extracted.md, ctx);
  const main = options.template
    ? fillWordTemplate(parts, ctx, vars, markerValues(vars, preset, options.date || ''), report)
    : layOutGenerated(parts, ctx, planDocument(vars, preset, options.clientLogo), report);
  parts.pkg.setText(parts.main, main.xml);
  writeSupportParts(parts, ctx, main.usesToc);
  setCoreProperties(parts.pkg, vars);

  const warnings = [...ctx.warnings];
  if (ctx.styles.unknown.length) warnings.push(tr('word.stylesUnknown', { names: ctx.styles.unknown.join(', ') }));
  return { bytes: parts.pkg.toBytes(), warnings };
}

/** The main part's new XML, and whether it holds a table of contents. */
interface MainXml {
  xml: string;
  usesToc: boolean;
}

function openParts(pkg: Package): DocumentParts {
  const main = mainPart(pkg);
  return {
    pkg,
    main,
    rels: new Relationships(pkg.text(relsPath(main))),
    contentTypes: new ContentTypes(pkg.text('[Content_Types].xml') || '')
  };
}

/** The main part as the package holds it, with the relationships namespace declared. */
function mainXml(parts: DocumentParts): string {
  return ensureRootNs(parts.pkg.text(parts.main) || '', 'r', NS.r);
}

/** A generated document's margins: the PDF template's, in points. */
function generatedMargins(preset: Preset): { left: number; top: number; right: number; bottom: number } {
  const [left, top, right, bottom] = DEFAULT_PAGE_MARGINS.map((fallback, i) => preset.layout.pageMargins[i] ?? fallback);
  return { left, top, right, bottom };
}

/** The rendering context, building on the template's own styles, numbering and footnotes. */
function createContext(parts: DocumentParts, preset: Preset, options: DocxOptions, notes: Footnote[]): WordContext {
  const { pkg, main } = parts;
  const generated = !options.template;
  const styles = new StyleBook(
    pkg.text(partOf(parts, 'styles')) || `${XML_DECL}<w:styles xmlns:w="${NS.w}"></w:styles>`,
    preset,
    generated ? {} : preset.word?.styles || {}
  );
  const numberingPath = existingPart(parts, 'numbering');
  const footnotesPath = existingPart(parts, 'footnotes');
  const margins = generatedMargins(preset);
  return {
    preset,
    styles,
    rels: parts.rels,
    numbering: new NumberingBook(numberingPath ? pkg.text(numberingPath) : null),
    media: new MediaBook(pkg, main.slice(0, main.lastIndexOf('/') + 1)),
    images: options.images || {},
    diagrams: renderedRasters(options.diagrams),
    icons: options.icons || {},
    width: generated ? PAGE_W_TW - tw(margins.left) - tw(margins.right) : textWidth(mainXml(parts)),
    counters: new Array<number>(HEADING_LEVELS).fill(0),
    ids: { drawing: 10000, bookmark: 10000 },
    toc: [],
    notes: new FootnoteBook(
      footnotesPath ? pkg.text(footnotesPath) : null,
      footnotesPath ? pkg.text(relsPath(footnotesPath)) : null,
      notes
    ),
    warnings: new Set(),
    top: true,
    breakable: false
  };
}

/** The diagrams that were actually rendered, keyed by `diagramKey(source)`. */
function renderedRasters(diagrams: Record<string, RasterImage> = {}): Map<string, RasterImage> {
  const rendered = new Map<string, RasterImage>();
  for (const [source, d] of Object.entries(diagrams)) {
    if (d && d.png && d.width > 0 && d.height > 0) rendered.set(diagramKey(source), d);
  }
  return rendered;
}

/* Generated document ------------------------------------------------- */

/** A document without a Word template, laid out like the PDF: its pages, bands and margins. */
function layOutGenerated(parts: DocumentParts, ctx: WordContext, plan: DocumentPlan, report: string): MainXml {
  const pages = generatedPages(plan, ctx, report);
  const sectPr = generatedSection(parts, ctx, plan, pages.coverRuleY);
  return {
    xml: mainXml(parts).replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${pages.body}${sectPr}</w:body>`),
    usesToc: pages.usesToc
  };
}

/** Each section the plan lists, on a new page; where the cover's rule ended up, for its header. */
function generatedPages(plan: DocumentPlan, ctx: WordContext, report: string): { body: string; coverRuleY: number | null; usesToc: boolean } {
  const { vars, preset } = plan;
  const { top, left } = generatedMargins(preset);
  let coverRuleY: number | null = null;
  let usesToc = false;
  const page = (sec: SectionKey): string => {
    switch (sec) {
      case 'cover': {
        const cover = coverText(vars, ctx, top, left);
        coverRuleY = cover.ruleY;
        return cover.xml;
      }
      case 'references': return references(vars, ctx);
      case 'tlp': return tlpReminder(ctx);
      case 'toc': {
        const toc = tocField(ctx, vars.tocTitle || preset.labels.toc);
        if (toc) usesToc = true;
        return toc;
      }
      case 'body': return report;
      default: return '';
    }
  };
  const pages = plan.sections.map(page).filter(Boolean);
  return { body: pages.map((xml, i) => (i === 0 ? xml : onNewPage(xml))).join(''), coverRuleY, usesToc };
}

/** The section properties: headers and footers, an A4 page and the PDF template's margins. */
function generatedSection(parts: DocumentParts, ctx: WordContext, plan: DocumentPlan, coverRuleY: number | null): string {
  const { vars, preset, tlp } = plan;
  const { left, top, right, bottom } = generatedMargins(preset);
  // Headers and footers: the cover page has its own, every other page the frame.
  const headerRels = new Relationships(null);
  const header = addPart(parts, { kind: 'header', name: 'header1.xml', xml: frameHeader(vars, ctx, headerRels, right), rels: headerRels });
  const footer = addPart(parts, { kind: 'footer', name: 'footer1.xml', xml: footerXml(ctx, tlp, right), rels: new Relationships(null) });
  const first = plan.hasCover && coverRuleY !== null ? coverHeaderFooter(parts, ctx, coverRuleY, plan.coverLogo) : '';
  return (
    `<w:sectPr><w:headerReference w:type="default" r:id="${header}"/><w:footerReference w:type="default" r:id="${footer}"/>${first}` +
    `<w:pgSz w:w="${PAGE_W_TW}" w:h="${PAGE_H_TW}"/>` +
    `<w:pgMar w:top="${tw(top)}" w:right="${tw(right)}" w:bottom="${tw(bottom)}" w:left="${tw(left)}" ` +
    `w:header="${tw(preset.layout.headerY)}" w:footer="${tw(footerDistance(ctx, !!tlp))}" w:gutter="0"/>` +
    `${plan.hasCover ? '<w:titlePg/>' : ''}</w:sectPr>`
  );
}

/** The cover page's own header (its artwork, logo and rule) and an empty footer; their references. */
function coverHeaderFooter(parts: DocumentParts, ctx: WordContext, ruleY: number, logo: string | null): string {
  const coverRels = new Relationships(null);
  const header = addPart(parts, { kind: 'header', name: 'header2.xml', xml: coverHeader(ctx, coverRels, ruleY, logo), rels: coverRels });
  const footer = addPart(parts, {
    kind: 'footer',
    name: 'footer2.xml',
    xml: `${XML_DECL}<w:ftr xmlns:w="${NS.w}">${para({}, '')}</w:ftr>`,
    rels: new Relationships(null)
  });
  return `<w:headerReference w:type="first" r:id="${header}"/><w:footerReference w:type="first" r:id="${footer}"/>`;
}

/* Word template ------------------------------------------------------ */

/**
 * The user's Word template with its markers filled: the report at `{{content}}`,
 * the table of contents at `{{toc}}`, the tables at `{{versions}}`,
 * `{{contacts}}` and `{{recipients}}`, the note's values everywhere else.
 */
function fillWordTemplate(parts: DocumentParts, ctx: WordContext, vars: ReportVars, values: Record<string, MarkerValue>, report: string): MainXml {
  const fill = (name: string) => values[name] ?? null;
  let usesToc = false;
  // An empty list removes its marker's paragraph, as an empty {{tlp}} leaves nothing.
  const blocks: Record<string, () => string> = {
    toc: () => {
      usesToc = true;
      return tocField(ctx, null);
    },
    versions: () => (vars.versions?.length ? versionsTable(vars.versions, ctx) : ''),
    contacts: () => (vars.contacts?.length ? contactsTable(vars.contacts, 'contacts', ctx) : ''),
    recipients: () => (vars.recipients?.length ? contactsTable(vars.recipients, 'recipients', ctx) : '')
  };
  const fillAround = (xml: string) => fillBlockMarkers(fillMarkers(xml, fill), blocks);
  // Markers are filled around the report, never inside it: a note that
  // writes "{{title}}" in its text keeps it.
  const doc = mainXml(parts);
  const split = splitAtMarker(doc, 'content');
  let xml: string;
  if (split) {
    xml = fillAround(split.before) + keepPageBreak(split, report) + fillAround(split.after);
  } else {
    ctx.warnings.add(tr('word.noContentMarker'));
    xml = beforeLastSection(fillAround(doc), report);
  }
  // Headers and footers carry markers too: the TLP marking, the title.
  const { pkg, main, rels } = parts;
  for (const rel of [...rels.ofType(REL_TYPES.header), ...rels.ofType(REL_TYPES.footer)]) {
    const path = resolveTarget(main, rel.target);
    const part = pkg.text(path);
    if (part) pkg.setText(path, fillMarkers(part, fill));
  }
  return { xml, usesToc };
}

/** Each paragraph holding only a block marker, replaced by what `blocks` renders for it. */
function fillBlockMarkers(xml: string, blocks: Record<string, () => string>): string {
  for (const [name, render] of Object.entries(blocks)) {
    let done = '';
    let rest = xml;
    for (let at = splitAtMarker(rest, name); at; at = splitAtMarker(rest, name)) {
      done += at.before + keepPageBreak(at, render());
      rest = at.after;
    }
    xml = done + rest;
  }
  return xml;
}

/** What replaces a marker's paragraph starts a new page if the paragraph did. */
function keepPageBreak(marker: { pageBreakBefore: boolean }, xml: string): string {
  return marker.pageBreakBefore && xml ? onNewPage(xml) : xml;
}

/** `content` at the end of the body: before its closing section properties, if they come last. */
function beforeLastSection(doc: string, content: string): string {
  const sectPr = doc.lastIndexOf('<w:sectPr');
  const cut = sectPr > doc.lastIndexOf('</w:p>') ? sectPr : doc.lastIndexOf('</w:body>');
  return doc.slice(0, cut) + content + doc.slice(cut);
}

/* Package ------------------------------------------------------------ */

/** The parts the report filled in or used: settings, numbering, footnotes, styles, relationships, content types. */
function writeSupportParts(parts: DocumentParts, ctx: WordContext, usesToc: boolean): void {
  const { pkg, main, rels, contentTypes } = parts;
  if (usesToc) {
    const path = partOf(parts, 'settings');
    pkg.setText(path, withUpdateFields(pkg.text(path) || `${XML_DECL}<w:settings xmlns:w="${NS.w}"></w:settings>`));
  }
  if (ctx.numbering.used) pkg.setText(partOf(parts, 'numbering'), ctx.numbering.toXml());
  if (ctx.notes.used) {
    const path = partOf(parts, 'footnotes');
    pkg.setText(path, ctx.notes.toXml());
    if (ctx.notes.rels.list.length) pkg.setText(relsPath(path), ctx.notes.rels.toXml());
  }
  pkg.setText(partOf(parts, 'styles'), ctx.styles.toXml());
  pkg.setText(relsPath(main), rels.toXml());

  // A .dotx opened in Word starts a new document; saved as is, it must
  // declare itself a document or Word refuses it.
  contentTypes.setOverride(main, CONTENT_TYPES.document);
  for (const ext of ctx.media.types) contentTypes.ensureDefault(ext, MEDIA_MIME[ext]);
  pkg.setText('[Content_Types].xml', contentTypes.toXml());
}

const MEDIA_MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };

/** The note's title and author in the file's properties, when the package has a core part. */
function setCoreProperties(pkg: Package, vars: ReportVars): void {
  const coreRel = new Relationships(pkg.text('_rels/.rels')).ofType(REL_TYPES.core)[0];
  const corePath = coreRel ? resolveTarget('', coreRel.target) : null;
  const core = corePath ? pkg.text(corePath) : null;
  if (corePath && core) pkg.setText(corePath, setCoreTitle(core, vars));
}
