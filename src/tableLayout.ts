/*
 * Column widths for a Markdown table that would not fit the page.
 *
 * pdfmake never breaks a word: a column is at least as wide as its longest
 * word, and when those minimums add up to more than the page, the table runs
 * off its right edge. A SHA-256 or a long URL — common in a CERT report — is
 * one 60-character word, enough on its own to push a table 600pt out.
 *
 * A table that fits as equal columns is left alone, so existing reports keep
 * their look. One that does not gets, in this order, until it fits:
 *   1. columns sized to their content, so a short column gives its room to
 *      the long one;
 *   2. a smaller font, down to 7pt;
 *   3. the words still wider than their column broken between characters
 *      (pdfmake's `wordBreak: 'break-all'`, on those words only). No
 *      character is inserted: a hash copied out of the PDF stays the hash.
 */
import { textWidth } from './textWidth.ts';

/** An inline run as pdfmake takes it — the fields this module reads or sets. */
export interface Run {
  text?: unknown;
  font?: string;
  fontSize?: number;
  bold?: boolean;
  wordBreak?: string;
  [key: string]: unknown;
}

export interface TableCell {
  runs: Run[];
  bold: boolean;
}

export interface FitOptions {
  /** Room the table has, borders and padding included, in points. */
  width: number;
  font: string;
  /** Font size of the cell text before any reduction. */
  fontSize: number;
  /** Horizontal padding inside each cell, left plus right. */
  padding: number;
  /** Width of a vertical rule. */
  rule: number;
}

export interface TableFit {
  /** Text widths of the columns, padding excluded, as pdfmake's `widths`. */
  widths: number[];
  /** Factor applied to every font size in the table; 1 when unchanged. */
  scale: number;
  /** The rows again, with over-wide words marked breakable. */
  rows: TableCell[][];
}

/** Smallest font size a table is reduced to, in points. */
export const MIN_TABLE_FONT_SIZE = 7;
/** Steps tried between the original size and the floor. */
const SCALE_STEP = 0.05;
/**
 * The estimate ignores kerning and pdfmake rounds nothing in our favour, so a
 * word counts as too wide a little before it strictly is.
 */
const SAFETY = 0.98;
/**
 * A word longer than this is an identifier — a hash, a URL, a path — rather
 * than language (the longest common French word has 25 letters). It is broken
 * whatever the font size, so it has no say in how far the table shrinks.
 */
const LONG_WORD = 24;

const SPACE_RE = /([ \t\r\n]+)/;

interface Segment {
  run: number;
  text: string;
  space: boolean;
  width: number;
  breakable: boolean;
}

/** A cell cut into words and spaces, each measured in its own run's font. */
function segments(cell: TableCell, o: FitOptions): Segment[] {
  const out: Segment[] = [];
  cell.runs.forEach((r, run) => {
    const text = typeof r.text === 'string' ? r.text : '';
    for (const part of text.split(SPACE_RE)) {
      if (!part) continue;
      const space = SPACE_RE.test(part);
      const width = space ? 0 : textWidth(part, r.font || o.font, r.fontSize || o.fontSize, Boolean(r.bold) || cell.bold);
      out.push({ run, text: part, space, width, breakable: false });
    }
  });
  return out;
}

/**
 * Words, as the line breaker sees them: a word may span runs (`**12**34` is
 * one word), so the pieces between two spaces are measured together.
 */
function words(segs: Segment[]): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  for (const s of segs) {
    if (s.space) { if (cur.length) out.push(cur); cur = []; } else cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const wordWidth = (w: Segment[]) => sum(w.map((s) => s.width));
const wordLength = (w: Segment[]) => sum(w.map((s) => [...s.text].length));

interface CellSize {
  /** Longest word. */
  min: number;
  /** Longest word that is language rather than an identifier. */
  minProse: number;
  /** Longest line, as written. */
  natural: number;
}

/** A cell's longest word and longest line, at full size. */
function measure(segs: Segment[], cell: TableCell, o: FitOptions): CellSize {
  const ws = words(segs);
  const min = Math.max(0, ...ws.map(wordWidth));
  const minProse = Math.max(0, ...ws.filter((w) => wordLength(w) <= LONG_WORD).map(wordWidth));
  // A line is everything between two hard breaks, spaces included.
  let natural = 0;
  let line = 0;
  for (const s of segs) {
    if (s.space && /[\r\n]/.test(s.text)) { natural = Math.max(natural, line); line = 0; continue; }
    line += s.space ? textWidth(' ', o.font, o.fontSize, cell.bold) : s.width;
  }
  return { min, minProse, natural: Math.max(natural, line) };
}

/** Rebuild a cell's runs, cutting the breakable words out into runs of their own. */
function rebuild(cell: TableCell, segs: Segment[]): TableCell {
  const runs: Run[] = [];
  for (const s of segs) {
    const src = cell.runs[s.run];
    const last = runs[runs.length - 1];
    if (!s.breakable && last && last.__src === s.run && !last.wordBreak) { last.text = String(last.text) + s.text; continue; }
    runs.push({ ...src, text: s.text, __src: s.run, ...(s.breakable ? { wordBreak: 'break-all' } : {}) });
  }
  for (const r of runs) delete r.__src;
  return { ...cell, runs };
}

/**
 * Even the longest words do not fit: whatever ends up wider than its column
 * will be broken.
 *
 * A column whose longest word fits within an even share keeps exactly that
 * width, and only the over-wide ones split what is left, in proportion to
 * their words. Sharing everything in proportion would let one hash squeeze a
 * one-letter column down to less than its letter.
 */
function shareScarceRoom(mins: number[], inner: number): number[] {
  const widths = new Array<number>(mins.length).fill(0);
  let open = mins.map((_, j) => j);
  let room = inner;
  for (;;) {
    const share = room / open.length;
    const fitting = open.filter((j) => mins[j] <= share);
    if (!fitting.length) break;
    for (const j of fitting) { widths[j] = mins[j]; room -= mins[j]; }
    open = open.filter((j) => mins[j] > share);
    if (!open.length) return widths;
  }
  const wide = sum(open.map((j) => mins[j]));
  for (const j of open) widths[j] = (mins[j] / wide) * room;
  return widths;
}

/**
 * How to lay out a table, or null when equal columns already fit — the layout
 * the generator has always used, kept for every table that never overflowed.
 */
export function fitTable(rows: TableCell[][], o: FitOptions): TableFit | null {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (!cols) return null;
  const inner = o.width - cols * o.padding - (cols + 1) * o.rule;

  const segs = rows.map((r) => r.map((c) => segments(c, o)));
  const min = new Array<number>(cols).fill(0);
  const minProse = new Array<number>(cols).fill(0);
  const natural = new Array<number>(cols).fill(0);
  rows.forEach((r, i) => r.forEach((c, j) => {
    const m = measure(segs[i][j], c, o);
    min[j] = Math.max(min[j], m.min);
    minProse[j] = Math.max(minProse[j], m.minProse);
    natural[j] = Math.max(natural[j], m.natural);
  }));

  // Every width below carries the safety headroom, so that a column given
  // exactly its longest word still holds it once pdfmake measures for real.
  const need = (w: number, scale: number) => (w * scale) / SAFETY;
  if (need(Math.max(...min), 1) <= inner / cols) return null;

  // A smaller font, as far as it takes for the words to fit — the real words:
  // a hash is broken at any size, and shrinking a four-column table to 7pt
  // to spare it one line would only make the rest harder to read. Many
  // columns of ordinary words is what a smaller font is for; past the floor,
  // the longest of them are broken too.
  const floor = Math.min(1, MIN_TABLE_FONT_SIZE / o.fontSize);
  const fitting = inner / sum(minProse.map((w) => need(w, 1)));
  const scale = fitting >= 1
    ? 1
    : Math.max(floor, Math.round(Math.floor(fitting / SCALE_STEP) * SCALE_STEP * 100) / 100);

  const mins = min.map((w) => need(w, scale));
  const nats = natural.map((w, j) => Math.max(need(w, scale), mins[j]));
  let widths: number[];
  if (sum(mins) >= inner) {
    widths = shareScarceRoom(mins, inner);
  } else if (sum(nats) <= inner) {
    // Everything fits on one line: spread the spare room like `*` would.
    widths = nats.map((w) => (w / sum(nats)) * inner);
  } else {
    // Every column gets its longest word; the rest goes to the columns with
    // the most text left to wrap.
    const flex = nats.map((w, j) => w - mins[j]);
    const spare = inner - sum(mins);
    widths = mins.map((w, j) => w + (sum(flex) > 0 ? (flex[j] / sum(flex)) * spare : spare / cols));
  }
  widths = widths.map((w) => Math.floor(w * 100) / 100);

  const out = rows.map((r, i) => r.map((c, j) => {
    const s = segs[i][j];
    for (const w of words(s)) {
      if (need(wordWidth(w), scale) > widths[j] + 0.01) for (const piece of w) piece.breakable = true;
    }
    return rebuild(c, s);
  }));
  return { widths, scale, rows: out };
}
