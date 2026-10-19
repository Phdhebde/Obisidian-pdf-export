/*
 * Markdown text scanning helpers — pure functions, no Obsidian API.
 *
 * The point of this module is `replaceOutsideCode`: every rewrite we do on the
 * raw Markdown before handing it to the lexer (image inlining, wikilinks,
 * transclusions) must leave code blocks and inline code spans untouched. The
 * previous implementation used String.split().join(), which happily rewrote a
 * `![[capture.png]]` that a note was *quoting* inside a fenced block.
 */

import { columnsLang } from './columns.ts';

export interface Region {
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * Ranges of `md` that are code and must never be rewritten: fenced blocks
 * (``` / ~~~), indented blocks (4 spaces or a tab), and inline spans (`x`).
 *
 * Returned sorted by `start` and non-overlapping.
 */
export function codeRegions(md: string): Region[] {
  const regions: Region[] = [];
  const lines = md.split('\n');

  // Offset of the start of each line, so we can map line indices back to the
  // absolute offsets the caller works in.
  const lineStart: number[] = [];
  let off = 0;
  for (const line of lines) {
    lineStart.push(off);
    off += line.length + 1; // +1 for the '\n' we split on
  }

  const inFence = new Array<boolean>(lines.length).fill(false);

  // A `col` / `col-md` fence is a container, not code: the Obsidian Columns
  // plugin renders the Markdown inside it, so image embeds and wikilinks in
  // there must still be rewritten. Such a fence stays transparent and we keep
  // scanning inside it for the real code blocks it holds.
  const stack: { char: string; len: number; from: number; code: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = stack[stack.length - 1];
    // Only a bare run of >= the opening length of the same char closes a fence.
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (top && close && close[1][0] === top.char && close[1].length >= top.len) {
      if (top.code) for (let k = top.from; k <= i; k++) inFence[k] = true;
      // A transparent fence only hides its own delimiter lines, so that the
      // run of backticks opening it is not read as an inline code span below.
      else { inFence[top.from] = true; inFence[i] = true; }
      stack.pop();
      continue;
    }
    // Inside a real code fence nothing counts until that fence closes.
    if (top && top.code) continue;
    // A fence may be indented by up to 3 spaces; 4+ makes it an indented block.
    // `\s*$` rather than `$`: we split on \n, so a CRLF note leaves a \r that
    // `.` refuses to match and that would sink the whole line.
    const m = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*?)\s*$/.exec(line);
    if (m) {
      stack.push({ char: m[1][0], len: m[1].length, from: i, code: columnsLang(m[2]) === null });
    }
  }
  // An unterminated fence runs to the end of the document, as CommonMark says.
  for (const f of stack) {
    if (f.code) for (let k = f.from; k < lines.length; k++) inFence[k] = true;
    else inFence[f.from] = true;
  }

  // Indented code blocks: 4+ spaces (or a tab), outside a fence, and not a
  // continuation of a list item. We only treat a run as code when the line
  // before it is blank, which is the CommonMark rule and avoids swallowing
  // wrapped list content.
  const isBlank = (s: string) => /^\s*$/.test(s);
  const indented = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    if (!/^(?: {4}|\t)/.test(lines[i])) continue;
    let j = i - 1;
    while (j >= 0 && isBlank(lines[j])) j--;
    // Only after a blank line (or at the very top) does indentation mean code.
    if (j >= 0 && j === i - 1) continue;
    indented[i] = true;
  }

  // Collapse the per-line flags into contiguous regions.
  let runFrom = -1;
  for (let i = 0; i <= lines.length; i++) {
    const isCode = i < lines.length && (inFence[i] || indented[i]);
    if (isCode && runFrom < 0) runFrom = i;
    if (!isCode && runFrom >= 0) {
      regions.push({ start: lineStart[runFrom], end: lineStart[i - 1] + lines[i - 1].length });
      runFrom = -1;
    }
  }

  // Inline code spans, on the lines that are not already covered.
  const covered = (pos: number) => regions.some((r) => pos >= r.start && pos < r.end);
  const spanRe = /(`+)(?:[^`]|(?!\1)`)*\1/g;
  let sm: RegExpExecArray | null;
  while ((sm = spanRe.exec(md))) {
    if (covered(sm.index)) {
      // Resume just after the rejected opener rather than after the whole
      // match: a span that starts on a fence line must not hide the real ones
      // further down.
      spanRe.lastIndex = sm.index + 1;
      continue;
    }
    regions.push({ start: sm.index, end: sm.index + sm[0].length });
  }

  regions.sort((a, b) => a.start - b.start);
  return regions;
}

/** True when [start, end) overlaps any region. */
export function overlaps(regions: Region[], start: number, end: number): boolean {
  for (const r of regions) {
    if (r.start >= end) break; // sorted, so nothing further can overlap
    if (start < r.end && end > r.start) return true;
  }
  return false;
}

/**
 * Like String.replace with a global regex, but matches that fall inside a code
 * block or an inline code span are left alone.
 *
 * Rebuilds the string in one pass over the matches, so a replacement never gets
 * re-scanned — unlike split/join, inserting a data URL here cannot corrupt a
 * later match.
 */
export function replaceOutsideCode(
  md: string,
  re: RegExp,
  replacer: (m: RegExpExecArray) => string
): string {
  const regions = codeRegions(md);
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(md))) {
    if (m[0] === '') { rx.lastIndex++; continue; } // guard against zero-width loops
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(regions, start, end)) continue;
    out += md.slice(last, start) + replacer(m);
    last = end;
  }
  return out + md.slice(last);
}

/**
 * Async variant: the replacer may await (reading an image off disk, resolving a
 * transclusion). Matches are collected first, then resolved in order.
 */
export async function replaceOutsideCodeAsync(
  md: string,
  re: RegExp,
  replacer: (m: RegExpExecArray) => Promise<string>
): Promise<string> {
  const regions = codeRegions(md);
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const hits: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(md))) {
    if (m[0] === '') { rx.lastIndex++; continue; }
    if (overlaps(regions, m.index, m.index + m[0].length)) continue;
    hits.push(m);
  }
  let out = '';
  let last = 0;
  for (const hit of hits) {
    out += md.slice(last, hit.index) + (await replacer(hit));
    last = hit.index + hit[0].length;
  }
  return out + md.slice(last);
}

/* ------------------------------------------------------------------ */
/* Frontmatter                                                         */
/* ------------------------------------------------------------------ */

/**
 * Strip a leading YAML frontmatter block. Tolerates a UTF-8 BOM and CRLF, both
 * of which defeated the previous inline regex.
 */
export function stripFrontmatter(text: string): string {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/* ------------------------------------------------------------------ */
/* Obsidian-specific syntax                                            */
/* ------------------------------------------------------------------ */

/** `[[Page]]`, `[[Page|alias]]`, `[[Page#Heading|alias]]` — not `![[...]]`. */
const WIKILINK_RE = /(^|[^!])\[\[([^\][\n|]+)(?:\|([^\][\n]*))?\]\]/g;

/**
 * Flatten wikilinks to their display text. There is nothing to link to inside a
 * standalone PDF, so `[[Rapport 2025|le rapport]]` becomes `le rapport` and a
 * bare `[[Rapport 2025]]` becomes `Rapport 2025` — instead of the raw brackets
 * the previous build printed.
 */
export function flattenWikilinks(md: string): string {
  return replaceOutsideCode(md, WIKILINK_RE, (m) => {
    const target = m[2].trim();
    const alias = (m[3] || '').trim();
    // Drop a leading "#Heading" / "^block" fragment when there is no alias.
    const shown = alias || target.replace(/[#^].*$/, '').trim() || target;
    return m[1] + shown;
  });
}

/**
 * Split an Obsidian callout header off a blockquote's raw text.
 *
 * marked folds `> [!warning] Titre` and the lines under it into a single
 * paragraph token, so the header cannot be picked out of the token tree — we
 * work from the raw text and re-lex the remainder.
 *
 * Returns null for a plain blockquote.
 */
export function parseCallout(raw: string): { type: string; fold: string; title: string; body: string } | null {
  const inner = String(raw || '')
    .split('\n')
    .map((l) => l.replace(/^[ \t]*>[ \t]?/, ''))
    .join('\n');
  const nl = inner.indexOf('\n');
  const first = nl < 0 ? inner : inner.slice(0, nl);
  const m = /^\[!([A-Za-z][\w.-]*)\]([+-]?)[ \t]*(.*)$/.exec(first.trim());
  if (!m) return null;
  return {
    type: m[1].toLowerCase(),
    fold: m[2],
    title: m[3].trim(),
    body: nl < 0 ? '' : inner.slice(nl + 1)
  };
}
