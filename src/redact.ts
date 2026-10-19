/*
 * Confidential passages — pure functions, no Obsidian API.
 *
 * A note marks what must not leave the team; an export profile says which
 * audience levels it keeps, and up to which TLP level. Marked passages the
 * profile does not keep are cut out of the Markdown here, before anything is
 * rendered: the text never reaches pdfmake, so it cannot survive in the file
 * under a black box, in a hidden layer or in the metadata.
 *
 * Obsidian comments (`%%…%%`) are cut from every export, profile or not: they
 * are hidden in reading view, and an export should not show more than that.
 *
 * The rule throughout is to fail closed. A marker whose intent is plain but
 * whose level is unknown, or a span that never closes, stops the export rather
 * than letting the passage through.
 */
import { t } from './i18n.ts';
import { codeRegions, overlaps, type Region } from './textScan.ts';
import { TLP_KEYS, asText, type TlpKey } from './types.ts';

export interface AudienceFilter {
  /** Declared levels, lower case. */
  levels: string[];
  /** Levels this export keeps; null keeps every passage (a full export). */
  keep: string[] | null;
  /**
   * The most sensitive TLP level this version may hold: a passage marked
   * above it is cut. Ignored by a full export.
   */
  tlp: TlpKey;
  /** Shown in place of a cut passage; empty leaves no trace. */
  placeholder: string;
  /** Show where the restricted passages a version keeps start and end. */
  mark: boolean;
}

/** What a passage is marked with. */
export interface Mark {
  levels: string[];
  tlp: TlpKey | null;
}

export interface RedactionCounts {
  notes: number;
  sections: number;
  blocks: number;
  phrases: number;
}

export function emptyCounts(): RedactionCounts {
  return { notes: 0, sections: 0, blocks: 0, phrases: 0 };
}

export function totalRemoved(c: RedactionCounts): number {
  return c.notes + c.sections + c.blocks + c.phrases;
}

/** Raised when a note cannot be exported safely; the message says why. */
export class AudienceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudienceError';
  }
}

/** Lower-cased, trimmed, de-duplicated level names, in their given order. */
export function normalizeLevels(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : asText(raw).split(/[,\s]+/);
  const out: string[] = [];
  for (const item of list) {
    const level = asText(item).trim().toLowerCase();
    if (/^[a-z0-9][\w-]*$/.test(level) && !out.includes(level)) out.push(level);
  }
  return out;
}

/** A TLP level as written in a note (`red`, `amber+strict`, `white`…), or null. */
export function parseTlp(raw: string): TlpKey | null {
  const v = raw.trim().toUpperCase().replace(/^TLP\s*:\s*/, '');
  if (v === 'WHITE') return 'CLEAR';
  return TLP_KEYS.find((k) => k === v) ?? null;
}

/** Lower is more sensitive: RED is 0, CLEAR is 4. */
function tlpRank(key: TlpKey): number {
  return TLP_KEYS.indexOf(key);
}

/**
 * Whether a passage survives the filter. Every level must be kept: a passage
 * for "internal" and "management" is for both groups, so it leaves only when
 * both may see it. A TLP mark must be no more sensitive than the version's.
 */
export function kept(filter: AudienceFilter, mark: Mark): boolean {
  if (filter.keep === null) return true;
  const keep = filter.keep;
  if (!mark.levels.every((l) => keep.includes(l))) return false;
  return mark.tlp === null || tlpRank(mark.tlp) >= tlpRank(filter.tlp);
}

function isMarked(mark: Mark): boolean {
  return mark.levels.length > 0 || mark.tlp !== null;
}

/** "INTERNAL · TLP:RED" — how a kept passage is labelled in the PDF. */
export function markLabel(mark: Mark): string {
  return [...mark.levels.map((l) => l.toUpperCase()), ...(mark.tlp ? [`TLP:${mark.tlp}`] : [])].join(' · ');
}

/**
 * What a note's frontmatter marks it with: `audience:` levels, and its own
 * `tlp:` when it is embedded in another note.
 */
export function noteMark(
  fm: Record<string, unknown> | undefined,
  filter: AudienceFilter,
  note: string,
  withTlp: boolean
): Mark {
  const where = () => t('audience.inFrontmatter', { note });
  const raw = fm?.audience;
  const named = raw == null ? [] : Array.isArray(raw) ? raw.map(asText) : asText(raw).split(/[,\s]+/);
  const unknown = named.map((s) => s.trim()).filter(Boolean).find((s) => !filter.levels.includes(s.toLowerCase()));
  if (unknown !== undefined) throw new AudienceError(t('audience.unknownLevel', { level: unknown, where: where() }));

  let tlp: TlpKey | null = null;
  const tlpRaw = withTlp ? asText(fm?.tlp ?? fm?.TLP).trim() : '';
  if (tlpRaw) {
    tlp = parseTlp(tlpRaw);
    if (!tlp) throw new AudienceError(t('audience.unknownLevel', { level: tlpRaw, where: where() }));
  }
  return { levels: normalizeLevels(raw ?? []), tlp };
}

/* ------------------------------------------------------------------ */
/* Markers left for the renderer                                       */
/* ------------------------------------------------------------------ */

/*
 * In a version that keeps a restricted section or embedded note, the passage
 * is framed by two HTML comments the generator turns into a label and a closing
 * rule. HTML comments, because nothing else in a note produces them with this
 * exact shape, and a renderer that ignores them prints nothing.
 */
export const MARK_START_RE = /^<!--\s*report-mark-start\s+(.+?)\s*-->$/;
export const MARK_END_RE = /^<!--\s*report-mark-end\s*-->$/;

export function markStart(mark: Mark): string {
  return `<!-- report-mark-start ${markLabel(mark).replace(/-->/g, '')} -->`;
}

export const MARK_END = '<!-- report-mark-end -->';

/** A kept phrase, in a version that shows them: highlighted by the generator. */
export const PHRASE_MARK_ATTR = 'data-report-mark';

/** Wrap Markdown in start and end markers, as blocks of their own. */
export function framed(md: string, mark: Mark): string {
  return `\n\n${markStart(mark)}\n\n${md}\n\n${MARK_END}\n\n`;
}

/* ------------------------------------------------------------------ */
/* Line model                                                          */
/* ------------------------------------------------------------------ */

interface Line {
  text: string;
  start: number;
  /** Inside a code block, or opening inside an Obsidian comment. */
  inert: boolean;
}

/** Ranges of `md` that are Obsidian comments, outside code. An unclosed `%%` runs to the end, as in Obsidian. */
export function commentRanges(md: string, code: Region[] = codeRegions(md)): Region[] {
  const marks: number[] = [];
  const re = /%%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    if (!overlaps(code, m.index, m.index + 2)) marks.push(m.index);
  }
  const out: Region[] = [];
  for (let i = 0; i < marks.length; i += 2) {
    out.push({ start: marks[i], end: i + 1 < marks.length ? marks[i + 1] + 2 : md.length });
  }
  return out;
}

function within(regions: Region[], pos: number): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

function splitLines(md: string): Line[] {
  const code = codeRegions(md);
  const comments = commentRanges(md, code);
  const lines: Line[] = [];
  let start = 0;
  for (const text of md.split('\n')) {
    // A comment that opens on this very line does not hide the line itself —
    // that is where a heading's marker lives.
    lines.push({ text, start, inert: within(code, start) || within(comments, start) });
    start += text.length + 1;
  }
  return lines;
}

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const QUOTE_PREFIX_RE = /^[ \t]*(?:>[ \t]?)+/;

function quoteDepth(text: string): number {
  const m = QUOTE_PREFIX_RE.exec(text);
  return m ? (m[0].match(/>/g) || []).length : 0;
}

/** A line that starts a new block, and so cannot be a lazy continuation of a quote. */
function startsBlock(text: string): boolean {
  return /^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|[-*+][ \t]|\d+[.)][ \t]|\||%%|<)/.test(text);
}

function placeholderLine(filter: AudienceFilter, depth = 0): string[] {
  if (!filter.placeholder) return [];
  const prefix = depth > 0 ? '>'.repeat(depth) + ' ' : '';
  return [prefix + `*[${filter.placeholder}]*`];
}

/* ------------------------------------------------------------------ */
/* Sections and blocks                                                 */
/* ------------------------------------------------------------------ */

/**
 * What a heading is marked with: `## Pricing %%internal%%`, `## Sources
 * %%tlp:red%%`. A comment that names no declared level is just a comment; a
 * `tlp:` comment with an unknown level is an error, since its intent is plain.
 */
function headingMark(text: string, filter: AudienceFilter): Mark {
  const mark: Mark = { levels: [], tlp: null };
  const re = /%%\s*([^%\n]+?)\s*%%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[1];
    const tlp = /^tlp\s*:\s*(.+)$/i.exec(body);
    if (tlp) {
      const key = parseTlp(tlp[1]);
      if (!key) throw new AudienceError(t('audience.unknownLevel', { level: body, where: t('audience.inHeading', { heading: text.trim() }) }));
      if (mark.tlp === null || tlpRank(key) < tlpRank(mark.tlp)) mark.tlp = key;
      continue;
    }
    const level = body.toLowerCase();
    if (filter.levels.includes(level) && !mark.levels.includes(level)) mark.levels.push(level);
  }
  return mark;
}

function sectionEnd(lines: Line[], from: number, depth: number): number {
  let j = from + 1;
  while (j < lines.length) {
    const next = lines[j].inert ? null : HEADING_RE.exec(lines[j].text);
    if (next && next[1].length <= depth) break;
    j++;
  }
  return j;
}

function cutSections(lines: Line[], filter: AudienceFilter, counts: RedactionCounts): string[] {
  const out: string[] = [];
  // Where the kept sections being framed end, innermost last.
  const open: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    while (open.length && open[open.length - 1] === i) {
      open.pop();
      out.push('', MARK_END, '');
    }
    const line = lines[i];
    const h = line.inert ? null : HEADING_RE.exec(line.text);
    const mark = h ? headingMark(line.text, filter) : null;
    if (!h || !mark || !isMarked(mark)) {
      out.push(line.text);
      continue;
    }
    // Everything down to the next heading of the same or a higher level.
    const end = sectionEnd(lines, i, h[1].length);
    if (kept(filter, mark)) {
      out.push(line.text);
      if (filter.mark) {
        out.push('', markStart(mark), '');
        open.push(end);
      }
      continue;
    }
    counts.sections++;
    out.push(...placeholderLine(filter));
    i = end - 1;
  }
  while (open.pop() !== undefined) out.push('', MARK_END, '');
  return out;
}

function cutCallouts(lines: Line[], filter: AudienceFilter, counts: RedactionCounts): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.inert ? null : /^[ \t]*(?:>[ \t]?)+\[!([\w-]+)\]/.exec(line.text);
    const level = m ? m[1].toLowerCase() : '';
    if (!m || !filter.levels.includes(level)) {
      out.push(line.text);
      continue;
    }
    // The callout, its nested quotes, and any lazy continuation lines — which
    // CommonMark folds into the quote even without a `>`.
    const depth = quoteDepth(line.text);
    let j = i + 1;
    while (j < lines.length) {
      const text = lines[j].text;
      if (!text.trim()) break;
      const d = quoteDepth(text);
      if (d >= depth || (d === 0 && !startsBlock(text))) j++;
      else break;
    }
    const mark: Mark = { levels: [level], tlp: null };
    if (kept(filter, mark)) {
      // Framed like a section when it stands at the top level; nested in a
      // quote or a list, the markers would break the block they sit in.
      const top = filter.mark && line.text.startsWith('>') && depth === 1;
      if (top) out.push('', markStart(mark), '');
      for (let k = i; k < j; k++) out.push(lines[k].text);
      if (top) out.push('', MARK_END, '');
      i = j - 1;
      continue;
    }
    counts.blocks++;
    out.push(...placeholderLine(filter, depth - 1));
    i = j - 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Comments and phrases                                                */
/* ------------------------------------------------------------------ */

/** Remove Obsidian comments, leaving code alone. */
export function stripComments(md: string): string {
  const ranges = commentRanges(md);
  let out = '';
  let last = 0;
  for (const r of ranges) {
    out += md.slice(last, r.start);
    last = r.end;
  }
  return out + md.slice(last);
}

const SPAN_OPEN_RE = /<span\b[^>]*?\bdata-(audience|tlp)\s*=\s*(["'])([^"']*)\2[^>]*>/gi;
const SPAN_ANY_RE = /<span\b[^>]*>|<\/span\s*>/gi;

function snippet(md: string, at: number): string {
  return md.slice(at, at + 60).replace(/\s+/g, ' ').trim();
}

/** What a phrase's opening tag marks it with; throws on an unknown level. */
function phraseMark(kind: string, value: string, filter: AudienceFilter, where: string): Mark {
  if (kind.toLowerCase() === 'tlp') {
    const tlp = parseTlp(value);
    if (!tlp) throw new AudienceError(t('audience.unknownLevel', { level: value, where }));
    return { levels: [], tlp };
  }
  const named = value.split(/[,\s]+/).filter(Boolean);
  const unknown = named.find((l) => !filter.levels.includes(l.toLowerCase()));
  if (unknown !== undefined || !named.length) {
    throw new AudienceError(t('audience.unknownLevel', { level: unknown ?? '', where }));
  }
  return { levels: named.map((l) => l.toLowerCase()), tlp: null };
}

/**
 * `<span data-audience="internal">…</span>` and `<span data-tlp="red">…</span>`:
 * cut when the filter drops them. Otherwise unwrapped to their text — the
 * renderer does not interpret inline HTML, so the tags would be printed — or,
 * in a version that shows kept passages, re-tagged for the generator to
 * highlight.
 */
function cutPhrases(md: string, filter: AudienceFilter, counts: RedactionCounts): string {
  let text = md;
  let from = 0;
  for (;;) {
    const code = codeRegions(text);
    SPAN_OPEN_RE.lastIndex = from;
    let open: RegExpExecArray | null;
    do open = SPAN_OPEN_RE.exec(text);
    while (open && overlaps(code, open.index, open.index + open[0].length));
    if (!open) return text;

    const where = t('audience.inSpan', { snippet: snippet(text, open.index) });
    const mark = phraseMark(open[1], open[3], filter, where);

    // The matching close, counting any spans nested inside.
    const bodyStart = open.index + open[0].length;
    SPAN_ANY_RE.lastIndex = bodyStart;
    let depth = 1;
    let close: RegExpExecArray | null = null;
    let tag: RegExpExecArray | null;
    while ((tag = SPAN_ANY_RE.exec(text))) {
      if (overlaps(code, tag.index, tag.index + tag[0].length)) continue;
      depth += tag[0][1] === '/' ? -1 : 1;
      if (depth === 0) { close = tag; break; }
    }
    if (!close) {
      throw new AudienceError(t('audience.unclosedSpan', { snippet: snippet(text, open.index) }));
    }

    const body = text.slice(bodyStart, close.index);
    const after = text.slice(close.index + close[0].length);
    if (kept(filter, mark)) {
      const opening = filter.mark ? `<span ${PHRASE_MARK_ATTR}="${markLabel(mark)}">` : '';
      const closing = filter.mark ? '</span>' : '';
      text = text.slice(0, open.index) + opening + body + closing + after;
      from = open.index + opening.length; // nested spans inside are handled on the next turn
    } else {
      const placeholder = filter.placeholder ? `*[${filter.placeholder}]*` : '';
      text = text.slice(0, open.index) + placeholder + after;
      from = open.index + placeholder.length;
      counts.phrases++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Apply a filter to a note's Markdown (embedded notes already inlined).
 *
 * Order matters: heading markers are comments, so sections go first; comments
 * go before phrases, so that a span quoted inside a comment cannot raise an
 * error for a passage nobody will see.
 */
export function redact(md: string, filter: AudienceFilter, counts: RedactionCounts = emptyCounts()): string {
  let text = cutSections(splitLines(md), filter, counts).join('\n');
  text = cutCallouts(splitLines(text), filter, counts).join('\n');
  text = stripComments(text);
  return cutPhrases(text, filter, counts);
}
