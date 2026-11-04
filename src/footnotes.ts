/*
 * Footnotes, as Obsidian writes them:
 *
 *   A claim.[^source]           a reference
 *   [^source]: Where it is from  its definition, anywhere in the note
 *       indented lines continue it
 *   Another claim.^[An inline note.]
 *
 * marked does not read them, so they are taken out of the Markdown before it
 * is lexed: each reference becomes an inline `<report-fn n="1">` tag, numbered
 * in reading order, and the definitions are returned on their own. The PDF
 * prints them as notes at the end of the report; Word gets real footnotes.
 *
 * The confidentiality filter ends with `pruneFootnotes`: a definition whose
 * references were all removed goes with them, so its text reaches no version.
 */
import { codeRegions, overlaps } from './textScan.ts';

export interface Footnote {
  /** 1, 2, 3… in the order the references are met. */
  n: number;
  /** The note's text, as inline Markdown. */
  md: string;
}

/** The inline tag a reference becomes. */
export const FOOTNOTE_TAG_RE = /^<report-fn n="(\d+)">$/;

const DEF_RE = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const CONT_RE = /^(?: {2,}|\t)\S/;
const REF_RE = /\[\^([^\]\s]+)\](?!:)|\^\[((?:[^\][]|\[[^\][]*\])+)\]/g;

interface Definition {
  id: string;
  text: string;
}

/**
 * Split the definitions (whole lines, outside code) from the rest of the note.
 * `keep` decides which definitions stay in the returned text; by default none do.
 */
function scan(md: string, keep: (id: string) => boolean = () => false): { text: string; defs: Definition[] } {
  const regions = codeRegions(md);
  const defs: Definition[] = [];
  const out: string[] = [];
  const lines = md.split('\n');
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = off;
    off += line.length + 1;
    const m = DEF_RE.exec(line);
    // Only the first character: the text may hold an inline code span.
    if (!m || overlaps(regions, start, start + 1)) {
      out.push(line);
      continue;
    }
    const own = [line];
    const text = [m[2]];
    while (i + 1 < lines.length && CONT_RE.test(lines[i + 1])) {
      i++;
      off += lines[i].length + 1;
      own.push(lines[i]);
      text.push(lines[i].trim());
    }
    defs.push({ id: m[1], text: text.join('\n').trim() });
    if (keep(m[1])) out.push(...own);
  }
  return { text: out.join('\n'), defs };
}

/** Rewrite each reference, outside code. Only where it starts matters: an inline note may hold code. */
function eachRef(text: string, fn: (m: RegExpExecArray) => string): string {
  const code = codeRegions(text);
  const rx = new RegExp(REF_RE.source, 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    if (overlaps(code, m.index, m.index + 1)) continue;
    out += text.slice(last, m.index) + fn(m);
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

/** Drop the definitions nothing refers to any more. */
export function pruneFootnotes(md: string): string {
  const { text, defs } = scan(md);
  if (!defs.length) return md;
  const used = new Set<string>();
  eachRef(text, (m) => {
    if (m[1] !== undefined) used.add(m[1]);
    return m[0];
  });
  if (defs.every((d) => used.has(d.id))) return md;
  return scan(md, (id) => used.has(id)).text;
}

export function extractFootnotes(md: string): { md: string; notes: Footnote[] } {
  const { text, defs: found } = scan(md);
  const defs = new Map<string, string>();
  // The first definition of an id wins, as in Obsidian.
  for (const d of found) if (!defs.has(d.id)) defs.set(d.id, d.text);

  const notes: Footnote[] = [];
  const numbers = new Map<string, number>();
  const body = eachRef(text, (m) => {
    if (m[2] !== undefined) {
      notes.push({ n: notes.length + 1, md: m[2].trim() });
      return `<report-fn n="${notes.length}">`;
    }
    const def = defs.get(m[1]);
    if (def === undefined) return m[0];
    let n = numbers.get(m[1]);
    if (n === undefined) {
      n = notes.length + 1;
      numbers.set(m[1], n);
      notes.push({ n, md: def });
    }
    return `<report-fn n="${n}">`;
  });
  return { md: body, notes };
}
