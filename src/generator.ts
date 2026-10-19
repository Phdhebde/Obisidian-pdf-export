/*
 * PDF Report Exporter — PDF generator (environment-agnostic).
 *
 * Exposes:
 *   defaultPreset(assets)                -> the factory preset
 *   buildDocDefinition(md, vars, preset) -> a pdfmake document definition
 *
 * The same code runs in Node (PdfPrinter, for the tests) and in the Obsidian
 * plugin (pdfMake browser build). It must not import 'obsidian'.
 */
import { marked } from 'marked';
import {
  HEADING_LEVELS,
  asText,
  SECTION_KEYS,
  TLP_DEFAULT,
  isSectionKey,
  type DocContact,
  type Preset,
  type PresetAssets,
  type NumberingStyle,
  type PresetLabels,
  type PresetToc,
  type ReportVars,
  type SectionKey,
  type TlpColor,
  type TlpKey,
  type TlpReminderEntry
} from './types.ts';
import { parseCallout } from './textScan.ts';
import {
  calloutSpan,
  columnsLang,
  parseColBlock,
  parseColMd,
  type ColSettings,
  type ColumnSpec
} from './columns.ts';
import { iconSvg, type IconName } from './icons.ts';
import { fitTable, type TableCell } from './tableLayout.ts';
import { getLocale, t as tr, type Locale } from './i18n.ts';

/**
 * A pdfmake content node. pdfmake has no published types, and its node shape is
 * a large open union, so we keep the index signature loose here rather than
 * modelling it — our own logic is still type-checked around it.
 */
export interface PdfNode {
  [key: string]: unknown;
}

/**
 * The parts of a marked token this module reads. marked's own `Token` union
 * ends in a catch-all generic token whose fields are all `any`, so the
 * generator describes what it relies on instead.
 */
export interface MdToken {
  type: string;
  raw?: string;
  text?: string;
  tokens?: MdToken[];
  /** Headings. */
  depth?: number;
  /** Links and images. */
  href?: string;
  title?: string | null;
  /** Fenced code. */
  lang?: string;
  /** Lists and their items. */
  items?: MdToken[];
  ordered?: boolean;
  task?: boolean;
  checked?: boolean;
  /** Tables. */
  header?: MdCell[];
  rows?: MdCell[][];
  align?: (string | null)[];
}

interface MdCell {
  text: string;
  tokens: MdToken[];
}

/** Block-level tokens of a Markdown string. */
function lex(md: string): MdToken[] {
  return marked.lexer(md || '');
}

/** A4 in points — the only page size the generator emits. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export const DEFAULT_PAGINATION = 'page {{page}}/{{total}}';

/**
 * The ready-made page-number formats the settings tab offers. `sample` is what
 * each one looks like on page 3 of 12, which is what the dropdown shows.
 */
export function paginationPresets(): { template: string; sample: string }[] {
  return [
    DEFAULT_PAGINATION,
    '{{page}}/{{total}}',
    '{{page}}',
    tr('pagination.sample'),
    '{{page}} / {{total}}',
    '\u2013 {{page}} \u2013',
    ''
  ].map((template) => ({ template, sample: renderPagination(template, 3, 12) || tr('pagination.none') }));
}

/**
 * Fill a page-number template. `{{page}}` is the current page, `{{total}}` the
 * page count (`{{pages}}` is accepted for it too). An empty or whitespace-only
 * result prints nothing rather than an empty line under the TLP marking.
 */
export function renderPagination(template: unknown, page: number, total: number): string {
  return asText(template)
    .replace(/\{\{\s*(page|total|pages)\s*\}\}/gi, (_m, key: string) =>
      key.toLowerCase() === 'page' ? String(page) : String(total))
    .trim();
}

/** Width of the text column at the default A4 margins, in points. */
const CONTENT_W = 467;

/**
 * Room between the left and right margins of a preset. A preset may set its
 * own margins, and the columns, rules and images laid out below have to be
 * measured against the width that preset actually leaves.
 */
function contentWidth(preset: Preset): number {
  const m = preset && preset.layout && preset.layout.pageMargins;
  const w = Array.isArray(m) ? PAGE_W - (m[0] || 0) - (m[2] || 0) : NaN;
  return isFinite(w) && w > 0 ? w : CONTENT_W;
}

/** Rendering context threaded through the block walk: heading counters. */
interface Ctx {
  /**
   * One counter per heading level, `#` first. A heading increments its own
   * level and zeroes every deeper one, which is what makes `A.` restart its
   * `1.` numbering under each new `##`.
   */
  counters: number[];
  /** True while inside a "Recommandations" H1 — switches bullets to diamonds. */
  diamond: boolean;
  /**
   * Width available to the current block, in points. Full text width at the top
   * level, narrower inside a column or a callout — an image or a horizontal
   * rule has to know how much room it actually has.
   */
  width: number;
  /** Diagram fences met on the way, and the images the host rendered for them. */
  diagrams: DiagramCtx;
  /**
   * True for the body's own flow, false inside a callout or a column: an
   * automatic page break there would split a box or a table cell, so only
   * top-level headings get one.
   */
  top: boolean;
}

/**
 * A diagram the host rendered to SVG. The generator cannot lay out Mermaid
 * itself — that takes a browser — so the host lexes the note once to learn the
 * sources (`collectDiagrams`), renders them, and hands the drawings back here.
 * They stay vectors in the PDF: sharp at any scale, and cheap to embed.
 */
export interface DiagramSvg {
  /** Standalone SVG, styles inlined, with explicit width and height. */
  svg: string;
  /** Natural size of the diagram in CSS pixels. */
  width: number;
  height: number;
}

interface DiagramCtx {
  /** Normalised source -> rendered drawing. */
  rendered: Map<string, DiagramSvg>;
  /** Every distinct diagram source, in document order. */
  found: string[];
}

function newCtx(preset: Preset, rendered = new Map<string, DiagramSvg>()): Ctx {
  return {
    counters: new Array<number>(HEADING_LEVELS).fill(0),
    diamond: false,
    width: contentWidth(preset),
    diagrams: { rendered, found: [] },
    top: true
  };
}

/* ------------------------------------------------------------------ */
/* Default preset                                                      */
/* ------------------------------------------------------------------ */

const LABELS: Record<Locale, PresetLabels> = {
  en: {
    references: 'Document references',
    status: 'Document status',
    contacts: 'Contacts',
    contactColumn: 'CONTACT',
    contactRole: 'ROLE',
    contactEmail: 'EMAIL',
    recipients: 'Recipients',
    recipientColumn: 'RECIPIENT',
    recipientRole: 'COMPANY / ROLE',
    recipientEmail: 'EMAIL',
    versionColumn: 'VERSION',
    versionDate: 'DATE',
    versionState: 'STATUS',
    tlpReminder: 'Traffic Light Protocol reminder',
    tlpReminderSubtitle: 'Traffic Light Protocol (TLP) for information sharing',
    toc: 'Table of contents'
  },
  fr: {
    references: 'Références du document',
    status: 'Statut du document',
    contacts: 'Contacts',
    contactColumn: 'CONTACT',
    contactRole: 'POSTE',
    contactEmail: 'COURRIEL',
    recipients: 'Destinataires',
    recipientColumn: 'DESTINATAIRE',
    recipientRole: 'SOCIÉTÉ / POSTE',
    recipientEmail: 'COURRIEL',
    versionColumn: 'VERSION',
    versionDate: 'DATE',
    versionState: 'ÉTAT',
    tlpReminder: 'Rappel du référentiel Traffic Light',
    tlpReminderSubtitle: "Traffic Light Protocol (TLP) pour le partage d'information",
    toc: 'Table des matières'
  }
};

/** The fixed report wording, in the given language (the interface's by default). */
export function defaultLabels(locale: Locale = getLocale()): PresetLabels {
  return { ...LABELS[locale] };
}

/** Concise summaries of the FIRST TLP 2.0 definitions. */
const TLP_REMINDER: Record<Locale, TlpReminderEntry[]> = {
  en: [
    { key: 'RED', text: 'For the eyes and ears of individual recipients only, no further disclosure. Use when information carries significant risk for the privacy, reputation or operations of the organisations involved.' },
    { key: 'AMBER', text: 'Limited disclosure: recipients may share it within their organisation and its clients on a need-to-know basis. TLP:AMBER+STRICT restricts sharing to the organisation only.' },
    { key: 'GREEN', text: 'Limited disclosure: recipients may share it within their community (peers and partner organisations), but not via publicly accessible channels.' },
    { key: 'CLEAR', text: 'Disclosure is not limited: recipients may spread it to the world, subject to standard copyright rules. Use when information carries minimal or no foreseeable risk of misuse.' }
  ],
  fr: [
    { key: 'RED', text: "Divulgation limitée aux seuls destinataires : aucune rediffusion n'est autorisée. À utiliser lorsque l'information présente un risque significatif pour la vie privée, la réputation ou les opérations si elle est partagée au-delà des personnes concernées." },
    { key: 'AMBER', text: "Diffusion restreinte au sein de l'organisation et de ses clients, sur la base du besoin d'en connaître. La mention TLP:AMBER+STRICT limite le partage à la seule organisation." },
    { key: 'GREEN', text: 'Diffusion possible au sein de la communauté (pairs et partenaires), mais pas via des canaux publics.' },
    { key: 'CLEAR', text: 'Diffusion libre, sans restriction, sous réserve des règles de copyright applicables. À utiliser lorsque le risque de mauvaise utilisation est minimal ou nul.' }
  ]
};

export function defaultTlpReminder(locale: Locale = getLocale()): TlpReminderEntry[] {
  return TLP_REMINDER[locale].map((e) => ({ ...e }));
}

export const DEFAULT_PRESET_ID = 'default';

/**
 * The factory template: a sober blue look drawn entirely by the generator, so
 * it needs no artwork. The TLP reminder page is off; it is one toggle away.
 */
export function defaultPreset(assets?: Partial<PresetAssets>, locale: Locale = getLocale()): Preset {
  const a = assets || {};
  return {
    id: DEFAULT_PRESET_ID,
    name: locale === 'fr' ? 'Rapport' : 'Report',
    colors: {
      brand: '#1F5F8B', // H1 + accents
      banner: '#1F5F8B', // header band
      dark: '#22303C', // footer band
      headerText: '#FFFFFF',
      footerText: '#FFFFFF',
      tableHeaderBg: '#1F5F8B',
      tableHeaderText: '#FFFFFF',
      tableBodyBg: '#EEF3F7',
      tableBorder: '#C5D3DF',
      link: '#1F6FB2',
      tocTitle: '#163F5C',
      text: '#1A1A1A'
    },
    fonts: { bodyFont: 'Liberation', headingFont: 'Archivo', monoFont: 'LiberationMono', bodySize: 11 },
    layout: {
      pageMargins: [64, 100, 64, 82],
      headerY: 15,
      headerRight: 40,
      footerY: 43,
      footerRight: 40,
      pagination: DEFAULT_PAGINATION,
      decor: true,
      cover: {
        x: 100, titleY: 288, titleSize: 36, showRule: true, ruleY: 392, ruleW: 96,
        subtitleY: 405, subtitleSize: 18, acronymY: 430, acronymSize: 28, titleMaxChars: 13,
        // Top-right of the A4 cover.
        logoX: 400, logoY: 72, logoW: 120
      }
    },
    tlp: {
      RED: { bg: '#EE0000', fg: '#FFFFFF' },
      AMBER: { bg: '#FFC000', fg: '#000000' },
      'AMBER+STRICT': { bg: '#FFC000', fg: '#000000' },
      GREEN: { bg: '#2EA62E', fg: '#FFFFFF' },
      CLEAR: { bg: '#D9D9D9', fg: '#000000' }
    },
    tlpReminder: defaultTlpReminder(locale),
    sections: SECTION_KEYS.filter((k) => k !== 'tlp'),
    toc: defaultToc(),
    assets: { coverBg: a.coverBg ?? null, frame: a.frame ?? null, clientLogo: a.clientLogo ?? null },
    labels: defaultLabels(locale),
    // A note that declares `recipients:` prints the table anyway.
    showRecipients: false,
    calloutIcons: true,
    diamondBullets: true,
    justify: true,
    transclusions: 'inline'
  };
}

/* ------------------------------------------------------------------ */
/* TLP                                                                 */
/* ------------------------------------------------------------------ */

/** Accepted spellings, including TLP 1.0's WHITE, mapped to a canonical key. */
const TLP_ALIASES: Record<string, TlpKey> = {
  RED: 'RED',
  AMBER: 'AMBER',
  'AMBER+STRICT': 'AMBER+STRICT',
  AMBERSTRICT: 'AMBER+STRICT',
  GREEN: 'GREEN',
  CLEAR: 'CLEAR',
  WHITE: 'CLEAR' // TLP 1.0 spelling
};

/**
 * Resolve a frontmatter TLP value to a canonical level.
 *
 * A single funnel for both the cover marking and the footer: the previous build
 * defaulted to CLEAR in one place and RED in the other, so a note with no `tlp`
 * key was marked TLP:RED in its footer.
 *
 * `recognised` is false when the value was present but unusable, so the caller
 * can warn instead of silently mislabelling a document's sensitivity.
 */
export function normalizeTlp(raw: unknown): { key: TlpKey; recognised: boolean } {
  const s = asText(raw)
    .trim()
    .toUpperCase()
    .replace(/^TLP\s*[:-]?\s*/, '')
    .replace(/\s+/g, '');
  if (!s) return { key: TLP_DEFAULT, recognised: true };
  const hit = TLP_ALIASES[s];
  return hit ? { key: hit, recognised: true } : { key: TLP_DEFAULT, recognised: false };
}

/**
 * The level to mark the report with, or null for none. A note that does not
 * declare one is only marked when the template prints the TLP reminder — a
 * reader would otherwise look for a marking that is not there.
 */
export function reportTlp(raw: unknown, sections: SectionKey[]): TlpKey | null {
  if (asText(raw).trim()) return normalizeTlp(raw).key;
  return sections.includes('tlp') ? TLP_DEFAULT : null;
}

function tlpColor(preset: Preset, key: TlpKey): TlpColor {
  return preset.tlp?.[key] || { bg: '#D9D9D9', fg: '#000000' };
}

/* ------------------------------------------------------------------ */
/* Inline rendering                                                    */
/* ------------------------------------------------------------------ */

function decodeEntities(s: unknown): string {
  return asText(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘').replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)));
}

function inlineRuns(tokens: MdToken[] | undefined, preset: Preset): PdfNode[] {
  const out: PdfNode[] = [];
  if (!tokens) return out;
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        if (t.tokens && t.tokens.length) out.push(...inlineRuns(t.tokens, preset));
        else out.push({ text: decodeEntities(t.text) });
        break;
      case 'strong': out.push(...inlineRuns(t.tokens, preset).map((r) => ({ ...r, bold: true }))); break;
      case 'em': out.push(...inlineRuns(t.tokens, preset).map((r) => ({ ...r, italics: true }))); break;
      case 'del': out.push(...inlineRuns(t.tokens, preset).map((r) => ({ ...r, decoration: 'lineThrough' }))); break;
      case 'codespan':
        out.push({ text: decodeEntities(t.text), font: preset.fonts.monoFont, fontSize: 9.5, background: '#F0F0F0' });
        break;
      case 'link':
        out.push(...inlineRuns(t.tokens, preset).map((r) => ({
          ...r, color: preset.colors.link, decoration: 'underline',
          ...(/^https?:|^mailto:/i.test(String(t.href || '')) ? { link: String(t.href) } : {})
        })));
        break;
      case 'br': out.push({ text: '\n' }); break;
      case 'escape': out.push({ text: t.text }); break;
      case 'image': break; // images are rendered as blocks in paragraphNode
      default: if (t.text) out.push({ text: decodeEntities(t.text) });
    }
  }
  return out;
}

function runsToPlain(runs: PdfNode[]): string {
  return runs.map((r) => (typeof r.text === 'string' ? r.text : '')).join('');
}

/**
 * 1 -> A, 26 -> Z, 27 -> AA, 28 -> AB — the numbering a spreadsheet gives its
 * columns.
 *
 * It used to wrap instead: the 27th section was labelled `A.` again, so a long
 * report had two sections under the same letter, in the body and in the table
 * of contents, with nothing to tell them apart.
 */
function letterFor(n: number): string {
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    out = String.fromCharCode(65 + digit) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Block rendering                                                     */
/* ------------------------------------------------------------------ */

function blockToPdf(t: MdToken, preset: Preset, ctx: Ctx): PdfNode | PdfNode[] | null {
  switch (t.type) {
    case 'heading': return headingNode(t, preset, ctx);
    case 'paragraph': return paragraphNode(t, preset, ctx);
    case 'list': return listNode(t, preset, ctx, 0);
    case 'table': return tableNode(t, preset, ctx.width);
    case 'code': return codeOrColumnsNode(t, preset, ctx);
    case 'blockquote': return calloutNode(t, preset, ctx);
    case 'hr':
      return {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: ctx.width, y2: 0, lineWidth: 0.7, lineColor: '#CCCCCC' }],
        margin: [0, 6, 0, 10]
      };
    default: return null;
  }
}

/* ------------------------------------------------------------------ */
/* Heading numbering                                                   */
/* ------------------------------------------------------------------ */

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
];

function roman(n: number): string {
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, symbol] of ROMAN) {
    while (rest >= value) { out += symbol; rest -= value; }
  }
  return out;
}

/**
 * How each numbering style renders, separator included.
 *
 * The separators are part of the style rather than a setting of their own:
 * `A.` gets two spaces and `a)` a bracket, which reads well at the head of a
 * title in a proportional font.
 */
interface NumberingDef {
  label: string;
  /** The number alone, as it reads at the head of a title. */
  render: (n: number) => string;
  /** The bare symbol, as it reads inside a chained number like `2.B.1`. */
  bare: (n: number) => string;
}

const NUMBERING: Record<NumberingStyle, NumberingDef> = {
  none: { label: 'None', render: () => '', bare: () => '' },
  decimal: { label: '1.  2.  3.', render: (n) => n + '. ', bare: (n) => String(n) },
  upperAlpha: { label: 'A.  B.  C.', render: (n) => letterFor(n) + '.  ', bare: letterFor },
  lowerAlpha: {
    label: 'a)  b)  c)',
    render: (n) => letterFor(n).toLowerCase() + ') ',
    bare: (n) => letterFor(n).toLowerCase()
  },
  upperRoman: { label: 'I.  II.  III.', render: (n) => roman(n) + '. ', bare: roman },
  lowerRoman: { label: 'i.  ii.  iii.', render: (n) => roman(n).toLowerCase() + '. ', bare: (n) => roman(n).toLowerCase() }
};

/** The number a level would print for its nth heading, separator included. */
export function headingNumber(style: NumberingStyle, n: number): string {
  return (NUMBERING[style] || NUMBERING.none).render(n);
}

/**
 * The number printed in front of a level-`i` heading (0 for `#`), given the
 * running counters, separator included.
 *
 * In hierarchical mode the parents' numbers come first, joined by dots:
 * `2.1`, `1.A`, `2.a`. A parent level set to no numbering contributes nothing,
 * so the default layout (bare `#`, then `A.`, then `1.`) chains as `A.1`; neither
 * does a parent that has not occurred yet — a `###` placed before any `##`
 * reads `1.1`, not `1.0.1`. A level without numbering of its own prints
 * nothing, whatever its parents carry. A number with a single part keeps its
 * style's own separator, so the top level still reads `1.` or `A.`.
 */
export function headingLabel(toc: PresetToc, counters: number[], i: number): string {
  const own = NUMBERING[toc.numbering[i]] || NUMBERING.none;
  if (toc.numbering[i] === 'none' || !toc.hierarchical) return own.render(counters[i]);
  const parts: string[] = [];
  for (let k = 0; k < i; k++) {
    const style = NUMBERING[toc.numbering[k]] || NUMBERING.none;
    if (toc.numbering[k] !== 'none' && counters[k] > 0) parts.push(style.bare(counters[k]));
  }
  if (!parts.length) return own.render(counters[i]);
  parts.push(own.bare(counters[i]));
  return parts.join('.') + ' ';
}

/** Menu entries for the settings tab, in the order they should be offered. */
export function numberingOptions(): { value: NumberingStyle; label: string }[] {
  return (Object.keys(NUMBERING) as NumberingStyle[]).map((value) => ({
    value,
    label: value === 'none' ? tr('numbering.none') : NUMBERING[value].label
  }));
}

/** The default numbering: none, then A., then 1., then a). */
export function defaultToc(): PresetToc {
  return {
    levels: [true, true, true, false, false, false],
    numbering: ['none', 'upperAlpha', 'decimal', 'lowerAlpha', 'none', 'none'],
    hierarchical: false,
    pageBreak: [false, false, false, false, false, false]
  };
}

const HEADING_STYLES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
/** Levels past the third share the third's look, only indented further. */
const TOC_STYLES = ['tocH1', 'tocH2', 'tocH3', 'tocH3', 'tocH3', 'tocH3'];
const TOC_NUMBER_STYLES = ['tocNumH1', 'tocNumSub', 'tocNumSub', 'tocNumSub', 'tocNumSub', 'tocNumSub'];
const TOC_MARGINS = [
  [0, 6, 0, 2], [16, 1, 0, 1], [30, 1, 0, 1], [44, 1, 0, 1], [58, 1, 0, 1], [72, 1, 0, 1]
];

function headingNode(t: MdToken, preset: Preset, ctx: Ctx): PdfNode {
  const plain = runsToPlain(inlineRuns(t.tokens, preset)).trim();
  const depth = Math.min(Math.max(Number(t.depth) || 1, 1), HEADING_LEVELS);
  const i = depth - 1;

  // This level advances, everything under it starts again from one.
  ctx.counters[i] = (ctx.counters[i] || 0) + 1;
  for (let k = depth; k < HEADING_LEVELS; k++) ctx.counters[k] = 0;

  const toc = preset.toc || defaultToc();
  const node: PdfNode = { text: headingLabel(toc, ctx.counters, i) + plain, style: HEADING_STYLES[i] };

  if (toc.levels[i]) {
    node.tocItem = true;
    node.tocStyle = TOC_STYLES[i];
    node.tocNumberStyle = TOC_NUMBER_STYLES[i];
    node.tocMargin = TOC_MARGINS[i];
  }
  return node;
}

/** An image whose href the host rewrote to `report-image:<name>` (see images.ts). */
const IMAGE_REF_RE = /^report-image:(.+)$/;

function imageNode(tk: MdToken, width: number): PdfNode {
  const href = String((tk && tk.href) || '');
  const ref = IMAGE_REF_RE.exec(href);
  if (!ref && !/^data:image\//i.test(href)) {
    const label = (tk && (tk.text || tk.href)) || '';
    return { text: label ? '[' + tr('inline.image', { label }) + ']' : '', style: 'caption' };
  }
  const node: PdfNode = { image: ref ? ref[1] : href, alignment: 'center', margin: [0, 6, 0, 8] };
  const MAX_H = 580;
  const w = parseInt(String(tk && tk.title), 10);
  // The width hint is in CSS pixels; PDF points are 3/4 of a pixel at 96 dpi.
  if (!isNaN(w) && w > 0) node.width = Math.min(Math.round(w * 0.75), width);
  else node.fit = [width, MAX_H];
  return node;
}

/**
 * Paragraphs that are a figure caption, per the convention the README
 * documents: `*Figure 1 : …*`.
 *
 * The previous rule also treated *any* fully-italic paragraph as a caption,
 * which silently centred and greyed out ordinary emphasised prose.
 */
const CAPTION_RE = /^(figure|fig\.|tableau|table|graphique|chart|schéma|diagram|illustration|annexe|appendix|exhibit|listing)\b/i;

function paragraphNode(t: MdToken, preset: Preset, ctx: Ctx): PdfNode {
  const toks: MdToken[] = t.tokens || [];
  if (toks.some((x) => x.type === 'image')) {
    const stack: PdfNode[] = [];
    let buf: MdToken[] = [];
    const flush = () => {
      if (!buf.length) return;
      const runs = inlineRuns(buf, preset);
      if (runsToPlain(runs).trim()) stack.push({ text: runs, style: 'body' });
      buf = [];
    };
    for (const tk of toks) {
      if (tk.type === 'image') { flush(); stack.push(imageNode(tk, ctx.width)); }
      else buf.push(tk);
    }
    flush();
    return stack.length === 1 ? stack[0] : { stack, margin: [0, 0, 0, 4] };
  }
  const runs = inlineRuns(toks, preset);
  const plain = runsToPlain(runs).trim();
  if (CAPTION_RE.test(plain)) return { text: plain, style: 'caption' };
  return { text: runs, style: 'body' };
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

function listNode(t: MdToken, preset: Preset, ctx: Ctx, depth: number): PdfNode {
  // The Obsidian Columns list syntax hijacks the whole list.
  const asColumns = listColumns(t);
  if (asColumns) return colRowNode(asColumns, {}, preset, ctx);

  const items = (t.items || []).map((it) => itemToContent(it, preset, ctx, depth));
  // A task list is rendered with its own check glyphs, so it must not also get
  // a bullet from pdfmake.
  if ((t.items || []).some((it) => it.task)) {
    return { stack: items, margin: [0, 2, 0, 8] };
  }
  if (t.ordered) return { ol: items, markerColor: '#000000', margin: [0, 2, 0, 8] };
  if (depth === 0 && ctx.diamond) return diamondList(items, preset);
  const type = depth === 0 ? 'disc' : ctx.diamond ? 'disc' : depth === 1 ? 'circle' : 'square';
  return { ul: items, type, markerColor: '#000000', margin: [0, 2, 0, 8] };
}

function itemToContent(item: MdToken, preset: Preset, ctx: Ctx, depth: number): PdfNode | string {
  const parts: PdfNode[] = [];
  for (const tk of item.tokens || []) {
    if (tk.type === 'list') parts.push(listNode(tk, preset, ctx, depth + 1));
    else if (tk.type === 'text') {
      parts.push({
        text: inlineRuns(tk.tokens || [{ type: 'text', text: tk.text }], preset),
        style: 'listItem'
      });
    } else {
      const n = blockToPdf(tk, preset, ctx);
      if (n) Array.isArray(n) ? parts.push(...n) : parts.push(n);
    }
  }
  if (parts.length === 0) return '';
  const content: PdfNode = parts.length === 1 ? parts[0] : { stack: parts };

  // Obsidian task list: marked strips the "[ ] " marker and flags the item.
  if (item.task) {
    return {
      columns: [
        checkboxMark(!!item.checked, preset),
        { width: '*', stack: [content] }
      ],
      columnGap: 2,
      margin: [depth * 14, 1, 0, 3]
    };
  }
  return content;
}

/**
 * Checkbox for a task list item, drawn as vectors rather than typed as ☐ / ☑.
 *
 * Liberation Sans has no glyph for U+2610 / U+2611 (nor for ✓), so those
 * characters come out as .notdef boxes in the PDF. Drawing the mark keeps it
 * independent of whatever body font a preset selects.
 */
function checkboxMark(checked: boolean, preset: Preset): PdfNode {
  const canvas: PdfNode[] = [
    { type: 'rect', x: 0.5, y: 0.5, w: 8, h: 8, r: 1, lineWidth: 0.8, lineColor: '#767676' }
  ];
  if (checked) {
    canvas.push({
      type: 'polyline',
      lineWidth: 1.4,
      lineColor: preset.colors.brand,
      points: [{ x: 2, y: 4.6 }, { x: 3.8, y: 6.6 }, { x: 7, y: 2.2 }]
    });
  }
  return { width: 14, canvas, margin: [0, 3.2, 0, 0] };
}

function diamondList(items: (PdfNode | string)[], preset: Preset): PdfNode {
  const rows = items.map((it) => ({
    columns: [
      {
        width: 12,
        canvas: [{
          type: 'polyline', closePath: true, color: preset.colors.brand,
          points: [{ x: 5, y: 0 }, { x: 9, y: 4 }, { x: 5, y: 8 }, { x: 1, y: 4 }]
        }],
        margin: [0, 3.5, 0, 0]
      },
      { width: '*', stack: it && typeof it === 'object' && it.stack ? it.stack : [it] }
    ],
    columnGap: 4,
    margin: [0, 1, 0, 5]
  }));
  return { stack: rows, margin: [0, 2, 0, 8] };
}

/* ------------------------------------------------------------------ */
/* Tables, code, callouts                                              */
/* ------------------------------------------------------------------ */

/** Cell padding of reportTableLayout, left plus right, and its rule width. */
const TABLE_PADDING = 10;
const TABLE_RULE = 0.75;

function reportTableLayout(preset: Preset): PdfNode {
  const C = preset.colors;
  return {
    fillColor: (rowIndex: number) => (rowIndex === 0 ? C.tableHeaderBg : C.tableBodyBg),
    hLineWidth: () => TABLE_RULE, vLineWidth: () => TABLE_RULE,
    hLineColor: () => C.tableBorder, vLineColor: () => C.tableBorder,
    paddingLeft: () => TABLE_PADDING / 2, paddingRight: () => TABLE_PADDING / 2, paddingTop: () => 3, paddingBottom: () => 3
  };
}

function tableNode(t: MdToken, preset: Preset, width: number): PdfNode {
  const align = t.align || [];
  const rows: TableCell[][] = [
    (t.header || []).map((c) => ({ runs: inlineRuns(c.tokens, preset), bold: true })),
    ...(t.rows || []).map((row) => row.map((c) => ({ runs: inlineRuns(c.tokens, preset), bold: false })))
  ];
  // Same size as the tableCell / tableHeader styles.
  const fontSize = bodySize(preset) - 1;
  const fit = fitTable(rows, {
    width, font: preset.fonts.bodyFont, fontSize, padding: TABLE_PADDING, rule: TABLE_RULE
  });

  const scale = fit ? fit.scale : 1;
  const body: PdfNode[][] = (fit ? fit.rows : rows).map((row, i) => row.map((cell, j) => {
    const node: PdfNode = {
      text: scale === 1 ? cell.runs : cell.runs.map((r) => (r.fontSize ? { ...r, fontSize: r.fontSize * scale } : r)),
      style: i === 0 ? 'tableHeader' : 'tableCell',
      alignment: align[j] || 'left'
    };
    if (scale !== 1) node.fontSize = fontSize * scale;
    return node;
  }));
  return {
    table: { headerRows: 1, widths: fit ? fit.widths : (t.header || []).map(() => '*'), body },
    layout: reportTableLayout(preset),
    margin: [0, 4, 0, 10]
  };
}

/**
 * A fenced block. `col` / `col-md` are the Obsidian Columns plugin's containers
 * and carry Markdown, not code; `mermaid` is a diagram. Everything else is
 * printed verbatim.
 */
function codeOrColumnsNode(t: MdToken, preset: Preset, ctx: Ctx): PdfNode | PdfNode[] {
  const kind = columnsLang(t.lang);
  if (kind === 'col') return colGroupNode(String(t.text ?? ''), preset, ctx);
  if (kind === 'col-md') return soloColumnNode(parseColMd(String(t.text ?? '')), preset, ctx);
  if (isMermaidLang(t.lang)) return diagramNode(t, ctx);
  return codeNode(t);
}

function isMermaidLang(lang: unknown): boolean {
  return asText(lang).trim().split(/\s+/)[0].toLowerCase() === 'mermaid';
}

/** The key a diagram is looked up by: its source, line endings and edges normalised. */
export function diagramKey(source: string): string {
  return String(source ?? '').replace(/\r\n?/g, '\n').trim();
}

/**
 * A ```mermaid block. Printed as the drawing the host rendered for it, or as
 * code when there is none — in the tests, or when the diagram did not parse,
 * in which case the source is the most useful thing left to show.
 */
function diagramNode(t: MdToken, ctx: Ctx): PdfNode {
  const key = diagramKey(t.text ?? '');
  if (key && !ctx.diagrams.found.includes(key)) ctx.diagrams.found.push(key);
  const hit = ctx.diagrams.rendered.get(key);
  if (!hit) return codeNode(t);
  // Never wider than drawn on screen (px -> pt), never wider than the column.
  const w = Math.min(Math.round(hit.width * 0.75), ctx.width);
  return { svg: hit.svg, fit: [w, 580], alignment: 'center', margin: [0, 6, 0, 10] };
}

function codeNode(t: MdToken): PdfNode {
  return {
    table: { widths: ['*'], body: [[{ text: t.text, style: 'code', preserveLeadingSpaces: true }]] },
    layout: {
      fillColor: () => '#F5F5F5', hLineWidth: () => 0, vLineWidth: () => 0,
      paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6
    },
    margin: [0, 4, 0, 10]
  };
}

/**
 * Obsidian callout palette: accent colour, tint and Lucide icon per type. An
 * untitled callout is titled with its type, capitalised, as Obsidian does.
 */
interface CalloutStyle { accent: string; tint: string; icon: IconName }

const CALLOUT_STYLES: Record<string, CalloutStyle> = {
  note: { accent: '#448AFF', tint: '#EEF4FF', icon: 'pencil' },
  abstract: { accent: '#00B8D4', tint: '#E8FAFD', icon: 'clipboardList' },
  summary: { accent: '#00B8D4', tint: '#E8FAFD', icon: 'clipboardList' },
  tldr: { accent: '#00B8D4', tint: '#E8FAFD', icon: 'clipboardList' },
  info: { accent: '#00B8D4', tint: '#E8FAFD', icon: 'info' },
  todo: { accent: '#00B8D4', tint: '#E8FAFD', icon: 'listTodo' },
  tip: { accent: '#00BFA5', tint: '#E6F8F5', icon: 'flame' },
  hint: { accent: '#00BFA5', tint: '#E6F8F5', icon: 'flame' },
  important: { accent: '#00BFA5', tint: '#E6F8F5', icon: 'flame' },
  success: { accent: '#00C853', tint: '#E9F9EE', icon: 'check' },
  check: { accent: '#00C853', tint: '#E9F9EE', icon: 'check' },
  done: { accent: '#00C853', tint: '#E9F9EE', icon: 'check' },
  question: { accent: '#F09B00', tint: '#FEF5E6', icon: 'circleHelp' },
  help: { accent: '#F09B00', tint: '#FEF5E6', icon: 'circleHelp' },
  faq: { accent: '#F09B00', tint: '#FEF5E6', icon: 'circleHelp' },
  warning: { accent: '#F09B00', tint: '#FEF5E6', icon: 'triangleAlert' },
  caution: { accent: '#F09B00', tint: '#FEF5E6', icon: 'triangleAlert' },
  attention: { accent: '#F09B00', tint: '#FEF5E6', icon: 'triangleAlert' },
  failure: { accent: '#E93147', tint: '#FDECEE', icon: 'x' },
  fail: { accent: '#E93147', tint: '#FDECEE', icon: 'x' },
  missing: { accent: '#E93147', tint: '#FDECEE', icon: 'x' },
  danger: { accent: '#E93147', tint: '#FDECEE', icon: 'zap' },
  error: { accent: '#E93147', tint: '#FDECEE', icon: 'zap' },
  bug: { accent: '#E93147', tint: '#FDECEE', icon: 'bug' },
  example: { accent: '#7C4DFF', tint: '#F1EDFF', icon: 'list' },
  quote: { accent: '#9E9E9E', tint: '#F4F4F4', icon: 'quote' },
  cite: { accent: '#9E9E9E', tint: '#F4F4F4', icon: 'quote' }
};

/** Border (3) plus the left and right padding (10 each) that `boxed` adds. */
const BOX_INSET = 23;

function calloutNode(t: MdToken, preset: Preset, ctx: Ctx): PdfNode {
  const call = parseCallout(String(t.raw || ''));

  // Obsidian Columns also has a callout syntax, which is not a callout at all.
  if (call && call.type === 'col') return calloutColumns(call.body, preset, ctx);
  if (call && columnsLang(call.type) === 'col-md') {
    return soloColumnNode({ settings: {}, content: call.body }, preset, ctx);
  }

  // Plain blockquote: the original orange-barred box.
  if (!call) {
    const inner = (t.tokens || [])
      .map((x) => blockToPdf(x, preset, ctx))
      .flatMap((n) => (Array.isArray(n) ? n : n ? [n] : []));
    return boxed(inner, preset.colors.brand, tint(preset.colors.brand, 0.93));
  }

  const style = CALLOUT_STYLES[call.type] ||
    { accent: preset.colors.brand, tint: tint(preset.colors.brand, 0.93), icon: 'info' };
  const label = call.type.charAt(0).toUpperCase() + call.type.slice(1);
  // The title is inline Markdown too: `code`, **bold** and links in it must
  // not be printed with their literal syntax.
  const titleRuns = inlineRuns(marked.Lexer.lexInline(call.title || label), preset).map((r) => ({
    color: style.accent,
    ...r
  }));
  const titleNode: PdfNode = { text: titleRuns, style: 'calloutTitle', color: style.accent };
  const titleRow: PdfNode = preset.calloutIcons === false
    ? { ...titleNode, margin: [0, 0, 0, call.body.trim() ? 4 : 0] }
    : {
        columns: [
          // Lucide's 24x24 grid scaled to roughly the cap height of the title.
          { width: 13, svg: iconSvg(style.icon, style.accent), fit: [12, 12], margin: [0, 1, 0, 0] },
          { width: '*', ...titleNode }
        ],
        columnGap: 5,
        margin: [0, 0, 0, call.body.trim() ? 4 : 0]
      };
  const stack: PdfNode[] = [titleRow];
  if (call.body.trim()) {
    // Re-lex the body: marked folded it into the header paragraph, so the
    // token tree cannot be reused here.
    const sub = markdownToPdf(call.body, preset, {
      ...ctx,
      counters: [...ctx.counters],
      width: innerWidth(ctx.width, BOX_INSET),
      top: false
    });
    stack.push(...sub);
  }
  return boxed(stack, style.accent, style.tint);
}

/** `hex` mixed towards white by `amount` (0 = unchanged, 1 = white). */
export function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#F4F4F4';
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  return '#' + mix((n >> 16) & 255) + mix((n >> 8) & 255) + mix(n & 255);
}

function boxed(inner: PdfNode[], accent: string, fill: string): PdfNode {
  return {
    table: { widths: ['*'], body: [[{ stack: inner }]] },
    layout: {
      fillColor: () => fill,
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 3 : 0),
      vLineColor: () => accent,
      paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 6, paddingBottom: () => 6
    },
    margin: [0, 4, 0, 10]
  };
}

/* ------------------------------------------------------------------ */
/* Columns (the Obsidian Columns community plugin)                     */
/* ------------------------------------------------------------------ */

/*
 * https://github.com/tnichols217/obsidian-columns — three syntaxes, one
 * layout: `col` opens a group and every item inside it becomes a column,
 * `col-md` groups several blocks into a single column. Parsing lives in
 * columns.ts; here we only turn the result into pdfmake `columns` nodes.
 *
 * CSS lengths are honoured where they mean something on paper. `height` is
 * not: the plugin uses it to put a scrollbar on an over-long column, and a
 * page has nowhere to scroll to.
 */

/** Gutter between two columns, in points. */
const COL_GAP = 12;
/** Below this a column is too narrow to hold a word, so we stop dividing. */
const COL_MIN_W = 40;

function innerWidth(width: number, inset: number): number {
  return Math.max(COL_MIN_W, width - inset);
}

/**
 * A CSS length as PDF points. A bare number means pixels, as in CSS, and a
 * pixel is 3/4 of a point at 96 dpi — the same conversion the image width hint
 * uses. Percentages have no fixed frame here, so they are declined.
 */
function cssLength(value: string | undefined, em = 11): number | null {
  const m = /^(\d+(?:\.\d+)?)[ \t]*(px|pt|em|rem|%)?$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === '%') return null;
  if (unit === 'pt') return n;
  if (unit === 'em' || unit === 'rem') return n * em;
  return n * 0.75;
}

/** CSS `text-align` as pdfmake's `alignment`. */
const ALIGNMENTS: Record<string, string> = {
  start: 'left', left: 'left',
  end: 'right', right: 'right',
  center: 'center', centre: 'center',
  justify: 'justify'
};

function textAlign(value: string | undefined): string | null {
  return ALIGNMENTS[String(value ?? '').trim().toLowerCase()] || null;
}

/**
 * Push an alignment down onto the text leaves.
 *
 * pdfmake resolves a node's own style before the value it inherits, so an
 * `alignment` set on the column node never reaches a paragraph carrying
 * `style: 'body'` — which already declares one.
 */
function applyAlign(nodes: unknown, align: string): void {
  if (!Array.isArray(nodes)) return;
  for (const n of nodes as unknown[]) {
    if (!n || typeof n !== 'object') continue;
    const node = n as PdfNode;
    if (node.text !== undefined) node.alignment = align;
    applyAlign(node.stack, align);
    applyAlign(node.columns, align);
    applyAlign(node.ul, align);
    applyAlign(node.ol, align);
  }
}

const BORDER_KEYS = ['bordercolor', 'borderstyle', 'borderwidth', 'borderradius', 'borderpadding'];

function hasBorder(s: ColSettings): boolean {
  return BORDER_KEYS.some((k) => k in s);
}

function borderWidth(s: ColSettings): number {
  const style = String(s.borderstyle ?? '').trim().toLowerCase();
  if (style === 'none' || style === 'hidden') return 0;
  return cssLength(s.borderwidth) ?? 0.75;
}

function borderPadding(s: ColSettings): number {
  return cssLength(s.borderpadding) ?? 0;
}

/**
 * Draw the column's border properties as a one-cell table.
 *
 * `borderRadius` is dropped: pdfmake's table layouts draw straight lines only.
 * The plugin's default border colour is white, which is invisible on paper, so
 * the preset's table border colour stands in when none is given.
 */
function borderBox(inner: PdfNode[], s: ColSettings, preset: Preset): PdfNode {
  const w = borderWidth(s);
  const pad = borderPadding(s);
  const color = s.bordercolor || preset.colors.tableBorder;
  const style = String(s.borderstyle ?? '').trim().toLowerCase();
  const dash = style === 'dashed'
    ? { dash: { length: 4, space: 3 } }
    : style === 'dotted'
      ? { dash: { length: 0.8, space: 2 } }
      : null;
  const layout: PdfNode = {
    hLineWidth: () => w, vLineWidth: () => w,
    hLineColor: () => color, vLineColor: () => color,
    paddingLeft: () => pad, paddingRight: () => pad, paddingTop: () => pad, paddingBottom: () => pad
  };
  if (dash) { layout.hLineStyle = () => dash; layout.vLineStyle = () => dash; }
  return { table: { widths: ['*'], body: [[{ stack: inner }]] }, layout };
}

/**
 * One column, at an already-resolved width.
 *
 * The heading counters stay shared with the rest of the document on purpose:
 * a `##` in the second column carries on lettering where the first one left
 * off, as it would if the columns were stacked.
 */
function columnNode(
  spec: ColumnSpec,
  width: number,
  groupAlign: string | null,
  preset: Preset,
  ctx: Ctx
): PdfNode {
  const bordered = hasBorder(spec.settings);
  const inset = bordered ? 2 * (borderWidth(spec.settings) + borderPadding(spec.settings)) : 0;

  const outer = ctx.width;
  const top = ctx.top;
  ctx.width = innerWidth(width, inset);
  ctx.top = false;
  let stack = markdownToPdf(spec.content, preset, ctx);
  ctx.width = outer;
  ctx.top = top;

  const align = textAlign(spec.settings.textalign) || groupAlign;
  if (align) applyAlign(stack, align);
  if (bordered) stack = [borderBox(stack, spec.settings, preset)];
  return { width, stack };
}

/** One row of columns, sized by their `flexGrow` values. */
function colRowNode(cols: ColumnSpec[], group: ColSettings, preset: Preset, ctx: Ctx): PdfNode {
  const grows = cols.map((c) => {
    const g = parseFloat(String(c.settings.flexgrow ?? ''));
    return isFinite(g) && g > 0 ? g : 1;
  });
  const total = grows.reduce((a, b) => a + b, 0);
  const avail = Math.max(COL_MIN_W * cols.length, ctx.width - COL_GAP * (cols.length - 1));
  const groupAlign = textAlign(group.textalign);
  return {
    columns: cols.map((c, i) =>
      columnNode(c, Math.max(COL_MIN_W, (avail * grows[i]) / total), groupAlign, preset, ctx)),
    columnGap: COL_GAP,
    margin: [0, 4, 0, 6]
  };
}

/** A ```col block: one pdfmake `columns` node per `===`-separated row. */
function colGroupNode(body: string, preset: Preset, ctx: Ctx): PdfNode[] {
  const block = parseColBlock(body);
  const rows = block.rows.filter((r) => r.length);
  if (!rows.length) return [];
  return rows.map((r) => colRowNode(r, block.settings, preset, ctx));
}

/**
 * A `col-md` used on its own, outside any group. The plugin renders it at full
 * width, so the width is dropped and only the column's own settings are kept.
 */
function soloColumnNode(spec: ColumnSpec, preset: Preset, ctx: Ctx): PdfNode {
  const node = columnNode(spec, ctx.width, null, preset, ctx);
  delete node.width;
  return node;
}

/**
 * The callout syntax: `> [!col]` makes a column of every item it holds, and a
 * nested `> [!col-md-2.5]` groups items into one column 2.5 units wide.
 */
function calloutColumns(body: string, preset: Preset, ctx: Ctx): PdfNode {
  const cols: ColumnSpec[] = [];
  for (const tk of lex(body)) {
    if (tk.type === 'space') continue;
    const inner = tk.type === 'blockquote' ? parseCallout(String(tk.raw || '')) : null;
    if (inner && columnsLang(inner.type) === 'col-md') {
      const span = calloutSpan(inner.type);
      cols.push({ settings: span ? { flexgrow: String(span) } : {}, content: inner.body });
      continue;
    }
    cols.push({ settings: {}, content: String(tk.raw || '') });
  }
  if (!cols.length) return { text: '' };
  return colRowNode(cols, {}, preset, ctx);
}

/**
 * The list syntax, which live preview does not render either:
 *
 *   - !!!col
 *     - 2          <- flexGrow
 *       content of the column
 */
function listColumns(t: MdToken): ColumnSpec[] | null {
  const items: MdToken[] = t.items || [];
  if (items.length !== 1) return null;
  const toks: MdToken[] = items[0].tokens || [];
  if (!toks.length || !/^!!!col$/i.test(String(toks[0].text ?? '').trim())) return null;
  const inner = toks.find((x) => x.type === 'list');
  if (!inner) return null;

  const cols: ColumnSpec[] = [];
  for (const it of inner.items || []) {
    const sub: MdToken[] = it.tokens || [];
    const grow = parseFloat(String(sub[0]?.text ?? '').trim());
    const sized = isFinite(grow) && grow > 0;
    const rest = sized ? sub.slice(1) : sub;
    cols.push({
      settings: sized ? { flexgrow: String(grow) } : {},
      content: rest.map((x) => String(x.raw ?? '')).join('\n').trim()
    });
  }
  return cols.length ? cols : null;
}

/* ------------------------------------------------------------------ */
/* Manual page breaks                                                  */
/* ------------------------------------------------------------------ */

/* A line that is only \pagebreak / \newpage / [pagebreak], or an HTML block
   containing a page-break (e.g. <div style="page-break-after:always"></div> or
   <!-- pagebreak -->). The marker becomes pageBreak:'before' on the next block. */
const PAGE_BREAK_RE = /^(?:\\?(?:pagebreak|newpage|page-break|saut\s*-?\s*de\s*-?\s*page)|\[(?:pagebreak|page-break|saut de page)\]|\{(?:pagebreak|page-break)\})$/i;

function isPageBreakToken(t: MdToken): boolean {
  if (!t) return false;
  if (t.type === 'html') return /page-?break/i.test(String(t.raw || t.text || ''));
  if (t.type === 'paragraph') return PAGE_BREAK_RE.test(String(t.raw || t.text || '').trim());
  return false;
}

function applyPageBreaks(arr: PdfNode[]): PdfNode[] {
  const res: PdfNode[] = [];
  let pending = false;
  for (let el of arr) {
    if (el && el.__pb) { pending = true; continue; }
    if (pending && el != null) {
      if (typeof el === 'object') { if (!el.pageBreak) el.pageBreak = 'before'; }
      else el = { text: String(el), pageBreak: 'before' };
      pending = false;
    }
    res.push(el);
  }
  // A trailing marker with nothing after it used to emit a blank final page.
  return res;
}

const HEADING_STYLE_SET = new Set(HEADING_STYLES);

/**
 * Whether a heading set to open a new page should actually do so.
 *
 * Not at the very start of the flow: the section before already ended its
 * page, and breaking again would leave a blank one. Nor right under another
 * heading: with `#` and `##` both breaking, `# Partie` followed directly by
 * `## Section` would otherwise strand the part title alone on its page — the
 * chain of titles moves to the new page together.
 */
function wantsAutoBreak(out: PdfNode[]): boolean {
  for (let k = out.length - 1; k >= 0; k--) {
    const el = out[k];
    if (el && el.__pb) continue;
    return !(el && typeof el === 'object' && typeof el.style === 'string' && HEADING_STYLE_SET.has(el.style));
  }
  return false;
}

export function markdownToPdf(md: string, preset: Preset, ctx?: Ctx): PdfNode[] {
  const tokens = lex(md);
  const c: Ctx = ctx || newCtx(preset);
  const breaks = (preset.toc || defaultToc()).pageBreak;
  const out: PdfNode[] = [];
  for (const t of tokens) {
    if (isPageBreakToken(t)) { out.push({ __pb: true }); continue; }
    if (t.type === 'heading' && t.depth === 1) {
      const plain = runsToPlain(inlineRuns(t.tokens, preset)).trim();
      c.diamond = preset.diamondBullets !== false && /recommand|recommend/i.test(plain);
    }
    const autoBreak = c.top && t.type === 'heading' && breaks[(t.depth ?? 1) - 1] === true && wantsAutoBreak(out);
    const n = blockToPdf(t, preset, c);
    if (autoBreak && n && !Array.isArray(n)) n.pageBreak = 'before';
    if (Array.isArray(n)) out.push(...n);
    else if (n) out.push(n);
  }
  return applyPageBreaks(out);
}

/**
 * The Mermaid sources a note's body holds, as the generator will look them up.
 *
 * Found by the same walk that renders the body rather than by scanning the
 * text, so a diagram inside a callout, a list or a column is found, and one
 * quoted inside a ````md fence is not.
 */
export function collectDiagrams(md: string, preset: Preset): string[] {
  const ctx = newCtx(preset);
  markdownToPdf(md, preset, ctx);
  return ctx.diagrams.found;
}

/* ------------------------------------------------------------------ */
/* Fixed / auto sections                                               */
/* ------------------------------------------------------------------ */

function wrapTitle(s: string, maxChars: number): string[] {
  const words = String(s).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Fit the cover title into at most `maxLines` by shrinking the type until it
 * fits. At a fixed 36pt a long title ran off the bottom of the cover artwork
 * and over the orange rule.
 */
export function fitCoverTitle(
  title: string,
  baseSize: number,
  baseMaxChars: number,
  maxLines = 3
): { text: string; fontSize: number } {
  let size = baseSize;
  for (;;) {
    // Narrower type fits proportionally more characters per line.
    const chars = Math.round(baseMaxChars * (baseSize / size));
    const lines = wrapTitle(title, chars);
    if (lines.length <= maxLines || size <= 18) return { text: lines.join('\n'), fontSize: size };
    size -= 2;
  }
}

/** Height of a cover title line, per point of type (Archivo Black at lineHeight 1.02). */
const COVER_LINE = 1.1;

/**
 * How far the rule, subtitle and acronym must move down to clear the title.
 *
 * The positions are set for a title of up to two lines; a long one wraps to a
 * third and would otherwise run into the rule. Moving what lies below keeps
 * every line readable while a short title stays exactly where it was placed.
 */
export function coverShift(vars: Partial<ReportVars>, preset: Preset): number {
  const cv = preset.layout.cover;
  const raw = (vars.coverTitle || vars.docTitle || 'REPORT').toUpperCase();
  const fitted = fitCoverTitle(raw, cv.titleSize, cv.titleMaxChars);
  const lines = fitted.text.split('\n').length;
  const bottom = cv.titleY + lines * fitted.fontSize * COVER_LINE;
  const next = cv.showRule !== false ? cv.ruleY : Math.min(cv.subtitleY, cv.acronymY);
  return Math.max(0, Math.ceil(bottom + 4 - next));
}

function buildCover(vars: ReportVars, preset: Preset, hasLogo: boolean): PdfNode[] {
  const cv = preset.layout.cover;
  const shift = coverShift(vars, preset);
  const out: PdfNode[] = [];
  // Before the title, so a logo that overlaps it is covered rather than
  // covering — the title is the one thing that must stay readable.
  if (hasLogo) {
    out.push({
      image: COVER_LOGO_KEY,
      width: cv.logoW,
      absolutePosition: { x: cv.logoX, y: cv.logoY }
    });
  }
  const raw = (vars.coverTitle || vars.docTitle || 'REPORT').toUpperCase();
  const fitted = fitCoverTitle(raw, cv.titleSize, cv.titleMaxChars);
  const common = { font: preset.fonts.headingFont, fontSize: fitted.fontSize, lineHeight: 1.02 };
  // Faux drop shadow, then the main title on top of it.
  out.push({ text: fitted.text, absolutePosition: { x: cv.x + 1, y: cv.titleY + 1 }, ...common, color: '#D6D6D6' });
  out.push({ text: fitted.text, absolutePosition: { x: cv.x, y: cv.titleY }, ...common, color: '#141414' });
  if (cv.showRule !== false) {
    out.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: cv.ruleW, y2: 0, lineWidth: 3, lineColor: '#141414' }],
      absolutePosition: { x: cv.x, y: cv.ruleY + shift }
    });
  }
  if (vars.coverSubtitle) {
    out.push({ text: vars.coverSubtitle, absolutePosition: { x: cv.x, y: cv.subtitleY + shift }, font: preset.fonts.bodyFont, fontSize: cv.subtitleSize, color: '#222222' });
  }
  if (vars.coverSubtitle2) {
    out.push({ text: vars.coverSubtitle2, absolutePosition: { x: cv.x, y: cv.acronymY + shift }, font: preset.fonts.headingFont, fontSize: cv.acronymSize, color: '#141414' });
  }
  return out;
}

const cell = (text: string, extra?: PdfNode): PdfNode => ({ text: text || '', style: 'tableCell', ...(extra || {}) });

/** Pad a table body to the template's fixed four rows of blanks. */
function padRows(body: PdfNode[][], columns: number): PdfNode[][] {
  while (body.length < 4) body.push(Array.from({ length: columns }, () => cell(' ')));
  return body;
}

/**
 * A "people" table: name, role and email. Shared by Contacts and Destinataires
 * so the two blocks cannot drift apart visually.
 */
function peopleTable(
  people: DocContact[],
  headers: [string, string, string],
  preset: Preset
): PdfNode {
  const body: PdfNode[][] = [headers.map((h) => ({ text: h, style: 'tableHeader' }))];
  for (const p of people) {
    body.push([
      cell(p.nom ?? ''),
      // `societe` fills the middle column when no role is given, which is the
      // common shape for a recipient.
      cell(p.poste || p.societe || ''),
      cell(p.courriel ?? '', { color: preset.colors.link })
    ]);
  }
  return {
    table: { headerRows: 1, widths: ['*', '*', '*'], body: padRows(body, 3) },
    layout: reportTableLayout(preset),
    margin: [0, 4, 0, 10]
  };
}

function buildReferences(vars: ReportVars, preset: Preset): PdfNode[] {
  const L = preset.labels || defaultLabels();
  const out: PdfNode[] = [];

  out.push({ text: L.references, style: 'h1' });

  out.push({ text: L.status, style: 'h2heavy' });
  const vbody: PdfNode[][] = [[
    { text: L.versionColumn, style: 'tableHeader' },
    { text: L.versionDate, style: 'tableHeader' },
    { text: L.versionState, style: 'tableHeader' }
  ]];
  for (const v of vars.versions || []) vbody.push([cell(v.version ?? ''), cell(v.date ?? ''), cell(v.etat ?? '')]);
  out.push({ table: { headerRows: 1, widths: [70, 90, '*'], body: padRows(vbody, 3) }, layout: reportTableLayout(preset), margin: [0, 4, 0, 18] });

  out.push({ text: L.contacts, style: 'h2heavy' });
  out.push(peopleTable(vars.contacts || [], [L.contactColumn, L.contactRole, L.contactEmail], preset));

  // Optional recipients block: shown when the preset asks for it, or as soon as
  // the note actually names someone.
  const recipients = vars.recipients || [];
  if (preset.showRecipients || recipients.length) {
    out.push({ text: L.recipients, style: 'h2heavy', margin: [0, 14, 0, 6] });
    out.push(peopleTable(recipients, [L.recipientColumn, L.recipientRole, L.recipientEmail], preset));
  }
  return out;
}

function buildTlpReminder(preset: Preset): PdfNode[] {
  const L = preset.labels || defaultLabels();
  const out: PdfNode[] = [];
  out.push({ text: L.tlpReminder, style: 'h1' });
  out.push({ text: L.tlpReminderSubtitle, style: 'subBold', margin: [0, 2, 0, 10] });
  for (const lv of preset.tlpReminder || []) {
    const col = tlpColor(preset, lv.key);
    out.push({
      columns: [
        {
          width: 80,
          stack: [{
            table: { body: [[{ text: 'TLP:' + lv.key, color: col.fg, bold: true, fontSize: bodySize(preset) - 2, fillColor: col.bg, alignment: 'center', margin: [3, 2, 3, 2] }]] },
            layout: 'noBorders'
          }]
        },
        { width: '*', text: lv.text, style: 'bodyTight' }
      ],
      columnGap: 10,
      margin: [0, 0, 0, 12]
    });
  }
  return out;
}

function buildToc(vars: ReportVars, preset: Preset): PdfNode {
  const L = preset.labels || defaultLabels();
  // pdfmake links each entry to its heading on its own (docMeasure sets
  // linkToDestination on both columns), so the TOC is already clickable.
  return { toc: { title: { text: vars.tocTitle || L.toc, style: 'tocTitle' } } };
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

/** Body size a preset asks for, kept inside what a report can actually use. */
export function bodySize(preset: Preset): number {
  const n = Number(preset.fonts && preset.fonts.bodySize);
  return isFinite(n) && n >= MIN_BODY_SIZE && n <= MAX_BODY_SIZE ? n : DEFAULT_BODY_SIZE;
}

export const MIN_BODY_SIZE = 7;
export const MAX_BODY_SIZE = 18;
export const DEFAULT_BODY_SIZE = 11;

/*
 * Every size below is an offset from the body size rather than a literal, so
 * that raising the body text carries its headings, tables and captions with it.
 * At the default of 11pt each expression yields exactly the value this function
 * used to hard-code, so an existing preset renders unchanged.
 */
function buildStyles(preset: Preset): Record<string, PdfNode> {
  const C = preset.colors;
  const F = preset.fonts;
  const B = bodySize(preset);
  const align = preset.justify === false ? 'left' : 'justify';
  return {
    h1: { font: F.headingFont, fontSize: B * 2, color: C.brand, margin: [0, 16, 0, 8], alignment: 'left' },
    h2: { font: F.bodyFont, bold: true, fontSize: B + 3, color: '#000000', margin: [0, 12, 0, 5], alignment: 'left' },
    h2heavy: { font: F.headingFont, fontSize: B + 5, color: '#000000', margin: [0, 12, 0, 6], alignment: 'left' },
    h3: { font: F.bodyFont, bold: true, fontSize: B, color: '#000000', margin: [0, 8, 0, 4], alignment: 'left' },
    h4: { font: F.bodyFont, bold: true, italics: true, fontSize: B, color: '#000000', margin: [0, 6, 0, 3], alignment: 'left' },
    h5: { font: F.bodyFont, bold: true, fontSize: B - 1, color: '#333333', margin: [0, 6, 0, 3], alignment: 'left' },
    h6: { font: F.bodyFont, italics: true, fontSize: B - 1, color: '#555555', margin: [0, 5, 0, 3], alignment: 'left' },
    subBold: { font: F.bodyFont, bold: true, fontSize: B, color: '#000000', alignment: 'left' },
    body: { font: F.bodyFont, fontSize: B, color: C.text, alignment: align, lineHeight: 1.22, margin: [0, 0, 0, 8] },
    bodyTight: { font: F.bodyFont, fontSize: B - 1, color: C.text, alignment: align, lineHeight: 1.18 },
    listItem: { font: F.bodyFont, fontSize: B, color: C.text, alignment: 'left', lineHeight: 1.2 },
    caption: { font: F.bodyFont, italics: true, fontSize: B - 2, color: '#555555', alignment: 'center', margin: [0, 4, 0, 12] },
    calloutTitle: { font: F.bodyFont, bold: true, fontSize: B, alignment: 'left' },
    tableHeader: { font: F.bodyFont, bold: true, fontSize: B - 1, color: C.tableHeaderText || '#1A1A1A' },
    tableCell: { font: F.bodyFont, fontSize: B - 1, color: '#333333' },
    tocTitle: { font: F.bodyFont, bold: true, fontSize: B + 5, color: C.tocTitle, margin: [0, 0, 0, 12] },
    tocH1: { font: F.bodyFont, bold: true, fontSize: B + 1, color: C.brand },
    tocH2: { font: F.bodyFont, fontSize: B, color: '#000000' },
    tocH3: { font: F.bodyFont, fontSize: B, color: '#000000' },
    tocNumH1: { font: F.bodyFont, bold: true, fontSize: B + 1, color: C.brand },
    tocNumSub: { font: F.bodyFont, fontSize: B, color: '#000000' },
    code: { font: F.monoFont, fontSize: B - 1.5, color: '#2A2A2A' }
  };
}

/* ------------------------------------------------------------------ */
/* Assemble document                                                   */
/* ------------------------------------------------------------------ */

export interface BuildOptions {
  /** Extra pdfmake image dictionary entries, keyed by the name used in `report-image:<name>`. */
  images?: Record<string, string>;
  /**
   * Data URL of the client logo resolved from the note's frontmatter. It takes
   * precedence over the one the preset carries.
   */
  clientLogo?: string | null;
  /** Rendered diagrams, keyed by `diagramKey(source)` — see `collectDiagrams`. */
  diagrams?: Record<string, DiagramSvg>;
}

/** pdfmake image dictionary key for the cover logo. */
const COVER_LOGO_KEY = 'coverLogo';

/** Sections to emit: a per-note override wins, then the preset's own list. */
function resolveSections(vars: ReportVars, preset: Preset): SectionKey[] {
  const raw = vars.sections && vars.sections.length ? vars.sections : preset.sections;
  const list = (raw || []).filter(isSectionKey);
  // The cover carries a full-page background and suppresses the header/footer,
  // which only makes sense on page 1 — pin it there whatever the stored order.
  const rest = list.filter((s) => s !== 'cover');
  return list.includes('cover') ? (['cover', ...rest] as SectionKey[]) : rest;
}

export function buildDocDefinition(
  md: string,
  vars: Partial<ReportVars>,
  preset?: Preset,
  options?: BuildOptions
): PdfNode {
  const p: Preset = preset || defaultPreset({});
  const v = vars as ReportVars;
  const C = p.colors;
  const L = p.layout;
  const sections = resolveSections(v, p);
  const hasCover = sections[0] === 'cover';
  // The note's own logo wins over the template's default.
  const coverLogo = options?.clientLogo || p.assets.clientLogo || null;

  const images: Record<string, string> = { ...(options?.images || {}) };
  const rendered = new Map<string, DiagramSvg>();
  for (const [source, d] of Object.entries(options?.diagrams || {})) {
    if (d && d.svg && d.width > 0 && d.height > 0) rendered.set(diagramKey(source), d);
  }

  const content: PdfNode[] = [];
  let started = false;
  for (const sec of sections) {
    let nodes: PdfNode[] = [];
    if (sec === 'cover') nodes = buildCover(v, p, Boolean(coverLogo));
    else if (sec === 'references') nodes = buildReferences(v, p);
    else if (sec === 'tlp') nodes = buildTlpReminder(p);
    else if (sec === 'toc') nodes = [buildToc(v, p)];
    else if (sec === 'body') nodes = markdownToPdf(md, p, newCtx(p, rendered));
    if (!nodes.length) continue;
    if (started) content.push({ text: '', pageBreak: 'before' });
    content.push(...nodes);
    started = true;
  }

  if (p.assets.coverBg) images.coverBg = p.assets.coverBg;
  if (p.assets.frame) images.frame = p.assets.frame;
  if (coverLogo) images[COVER_LOGO_KEY] = coverLogo;

  const tlp = reportTlp(v.tlp, sections);
  const decor = p.layout.decor !== false;

  return {
    pageSize: 'A4',
    pageMargins: L.pageMargins,
    info: {
      title: v.docTitle || '',
      author: v.author || '',
      subject: v.coverSubtitle || '',
      keywords: [tlp ? 'TLP:' + tlp : '', v.client || ''].filter(Boolean).join(', '),
      creator: 'PDF Report Exporter'
    },
    background: (currentPage: number, pageSize: { width: number; height: number }) => {
      // Keyed on whether a cover was actually emitted, not on the page number:
      // with the cover section off, page 1 is ordinary content and must get the
      // frame, not the full-page cover artwork.
      const key = hasCover && currentPage === 1 ? 'coverBg' : 'frame';
      if (images[key]) {
        return { image: key, width: pageSize.width, height: pageSize.height, absolutePosition: { x: 0, y: 0 } };
      }
      if (!decor) return null;
      return key === 'coverBg' ? coverDecor(p, pageSize, coverShift(v, p)) : frameDecor(p, pageSize);
    },
    header: (currentPage: number) => {
      if (hasCover && currentPage === 1) return null;
      return {
        columns: [
          { text: '', width: '*' },
          {
            width: 'auto', alignment: 'right', stack: [
              { text: v.docTitle || '', color: C.headerText, fontSize: 12, font: p.fonts.bodyFont },
              { text: v.client || '', color: C.headerText, fontSize: 12, font: p.fonts.bodyFont, margin: [0, 4, 0, 0] }
            ]
          }
        ],
        margin: [0, L.headerY, L.headerRight, 0]
      };
    },
    // The header and footer sit on top of the frame artwork, so their sizes
    // stay fixed: unlike the body, they have a band of a given height to fit
    // into and nothing to gain from following the text size.
    footer: (currentPage: number, pageCount: number) => {
      if (hasCover && currentPage === 1) return null;
      const stack: PdfNode[] = [];
      if (tlp) {
        stack.push({ text: 'TLP:' + tlp, color: tlpColor(p, tlp).bg, bold: true, fontSize: 11, font: p.fonts.bodyFont, alignment: 'right' });
      }
      const paging = renderPagination(L.pagination, currentPage, pageCount);
      if (paging) {
        stack.push({ text: paging, color: C.footerText, fontSize: 10, font: p.fonts.bodyFont, alignment: 'right', margin: [0, tlp ? 2 : 7, 0, 0] });
      }
      if (!stack.length) return null;
      return {
        columns: [{ text: '', width: '*' }, { width: 'auto', alignment: 'right', stack }],
        margin: [0, L.footerY, L.footerRight, 0]
      };
    },
    content,
    images,
    styles: buildStyles(p),
    defaultStyle: {
      font: p.fonts.bodyFont, fontSize: 11, color: C.text, lineHeight: 1.22,
      alignment: p.justify === false ? 'left' : 'justify'
    }
  };
}

/* ------------------------------------------------------------------ */
/* Built-in decoration                                                 */
/* ------------------------------------------------------------------ */

/*
 * What a template draws when no image replaces it: vectors in the template's
 * own colours, so the factory look needs no artwork and follows any palette.
 * The bands match the default margins — the header text sits in the top band,
 * the TLP marking and page number in the bottom one.
 */

/** Height of the header band, then of the accent rule under it, in points. */
const HEADER_BAND = 64;
const ACCENT_RULE = 3;
/** Height of the footer band. */
const FOOTER_BAND = 48;

function frameDecor(preset: Preset, page: { width: number; height: number }): PdfNode {
  const C = preset.colors;
  const w = page.width || PAGE_W;
  const h = page.height || PAGE_H;
  return {
    canvas: [
      { type: 'rect', x: 0, y: 0, w, h: HEADER_BAND, color: C.banner },
      { type: 'rect', x: 0, y: HEADER_BAND, w, h: ACCENT_RULE, color: tint(C.banner, 0.55) },
      { type: 'rect', x: 0, y: h - FOOTER_BAND, w, h: FOOTER_BAND, color: C.dark },
      { type: 'rect', x: 0, y: h - FOOTER_BAND - ACCENT_RULE, w: w * 0.45, h: ACCENT_RULE, color: C.brand }
    ]
  };
}

/**
 * The cover: a full-height bar down the left edge, a bracket framing the title
 * block, and a dark band at the foot of the page — all keyed off the title's
 * position, so moving the title in the settings moves its frame with it.
 */
function coverDecor(preset: Preset, page: { width: number; height: number }, shift: number): PdfNode {
  const C = preset.colors;
  const cv = preset.layout.cover;
  const w = page.width || PAGE_W;
  const h = page.height || PAGE_H;
  const bx = Math.max(0, cv.x - 28);
  const top = Math.max(0, cv.titleY - 40);
  const bottom = Math.min(h - 160, Math.max(cv.acronymY, cv.subtitleY) + shift + 90);
  const accent = tint(C.brand, 0.35);
  return {
    canvas: [
      { type: 'rect', x: 0, y: 0, w: 14, h, color: C.brand },
      { type: 'line', x1: bx, y1: top, x2: bx, y2: bottom, lineWidth: 2.5, lineColor: C.brand },
      { type: 'line', x1: bx, y1: top, x2: bx + 90, y2: top, lineWidth: 2.5, lineColor: C.brand },
      { type: 'line', x1: bx, y1: bottom, x2: bx + 90, y2: bottom, lineWidth: 2.5, lineColor: accent },
      { type: 'rect', x: 0, y: h - 96, w, h: 96, color: C.dark },
      { type: 'rect', x: 0, y: h - 96 - 5, w: w * 0.45, h: 5, color: C.brand }
    ]
  };
}
