/*
 * Obsidian Columns (tnichols217/obsidian-columns) — parsing, no rendering.
 *
 * Pure functions, no pdfmake and no Obsidian API. They turn the body of a
 * `col` / `col-md` code block into the rows and columns that generator.ts
 * lays out. The callout form (`> [!col]` / `> [!col-md-2.5]`) and the list
 * form (`- !!!col`) are shaped into the same `ColumnSpec` by the generator,
 * which already holds the token tree for those.
 *
 * Syntax reference: https://github.com/tnichols217/obsidian-columns
 */

/**
 * The settings block declared above the `===` delimiter of a col / col-md.
 *
 * Keys are lowercased, so `flexGrow` is read as `flexgrow` — the plugin is
 * case-sensitive, we are not, which only ever accepts more notes.
 */
export type ColSettings = Record<string, string>;

export interface ColumnSpec {
  settings: ColSettings;
  /** Markdown to render inside the column. */
  content: string;
}

export interface ColBlock {
  /** Settings of the group itself (`textAlign`, `height`, borders). */
  settings: ColSettings;
  /** A further `===` inside a col body starts a new row of columns. */
  rows: ColumnSpec[][];
}

/**
 * Classify a code fence info string, or a callout type.
 *
 * `col-md-2.5` is the callout spelling of a column with flexGrow 2.5, so it
 * classifies as `col-md` too.
 */
export function columnsLang(lang: string | undefined): 'col' | 'col-md' | null {
  const word = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();
  if (word === 'col') return 'col';
  if (/^col-md(?:-\d+(?:\.\d+)?)?$/.test(word)) return 'col-md';
  return null;
}

/** The `2.5` of a `[!col-md-2.5]` callout, or null when no width is given. */
export function calloutSpan(type: string | undefined): number | null {
  const m = /^col-md-(\d+(?:\.\d+)?)$/i.exec((type ?? '').trim());
  const n = m ? parseFloat(m[1]) : NaN;
  return isFinite(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------ */
/* Fence-aware scanning of a col body                                  */
/* ------------------------------------------------------------------ */

/*
 * These all end on `\s*$` rather than `$`: bodies are split on \n, so a note
 * saved with CRLF leaves a trailing \r on every line — and `.` does not match
 * \r, which would make each of these patterns fail outright.
 */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*?)\s*$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
/** A row delimiter — also the settings delimiter, the first time it appears. */
const ROW_SEP = /^ {0,3}={3,}\s*$/;

type ColNode =
  | { kind: 'text'; raw: string }
  | { kind: 'sep'; raw: string }
  | { kind: 'fence'; raw: string; lang: string; body: string };

/**
 * Split a col / col-md body into its top-level pieces.
 *
 * The plugin requires a parent fence to carry more backticks than its
 * children, which is also the CommonMark rule: a bare run of at least as many
 * fence characters closes the innermost fence, anything shorter opens a new
 * one. That is enough to walk the nesting without a Markdown parser, and it is
 * what keeps the ```js block of the README example out of the column split.
 */
function colNodes(body: string): ColNode[] {
  const lines = String(body ?? '').split('\n');
  const out: ColNode[] = [];

  let text: string[] = [];
  const flushText = () => {
    if (text.length) out.push({ kind: 'text', raw: text.join('\n') });
    text = [];
  };

  // Index 0 is the top-level fence; the rest are fences nested inside it.
  const stack: { char: string; len: number }[] = [];
  let lang = '';
  let buf: string[] = [];

  for (const line of lines) {
    if (stack.length) {
      buf.push(line);
      const top = stack[stack.length - 1];
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === top.char && close[1].length >= top.len) {
        stack.pop();
        if (!stack.length) {
          out.push({ kind: 'fence', raw: buf.join('\n'), lang, body: buf.slice(1, -1).join('\n') });
          buf = [];
        }
        continue;
      }
      const nested = FENCE_OPEN.exec(line);
      if (nested) stack.push({ char: nested[1][0], len: nested[1].length });
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open) {
      flushText();
      stack.push({ char: open[1][0], len: open[1].length });
      lang = open[2].trim();
      buf = [line];
      continue;
    }
    if (ROW_SEP.test(line)) { flushText(); out.push({ kind: 'sep', raw: line }); continue; }
    text.push(line);
  }

  // An unterminated fence runs to the end of the block, as CommonMark says.
  if (stack.length) out.push({ kind: 'fence', raw: buf.join('\n'), lang, body: buf.slice(1).join('\n') });
  flushText();
  return out;
}

const SETTING_RE = /^[ \t]*([A-Za-z][\w-]*)[ \t]*=[ \t]*(.*?)\s*$/;

/** A settings block, or null as soon as a line is not `key=value`. */
function parseSettings(text: string): ColSettings | null {
  const out: ColSettings = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = SETTING_RE.exec(line);
    if (!m) return null;
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/**
 * Take the settings block off the front of a body.
 *
 * Everything above the first top-level `===` is settings — but only when every
 * line of it really is `key=value`. That guard is what stops a setext heading
 * (`Titre` on one line, `===` on the next) inside a column from swallowing the
 * text above it.
 */
function takeSettings(nodes: ColNode[]): { settings: ColSettings; rest: ColNode[] } {
  const at = nodes.findIndex((n) => n.kind === 'sep');
  if (at < 0) return { settings: {}, rest: nodes };
  const head = nodes.slice(0, at);
  if (!head.every((n) => n.kind === 'text')) return { settings: {}, rest: nodes };
  const settings = parseSettings(head.map((n) => n.raw).join('\n'));
  if (!settings) return { settings: {}, rest: nodes };
  return { settings, rest: nodes.slice(at + 1) };
}

/** Re-join nodes into the Markdown they came from (minus the `===` lines). */
function nodesToMarkdown(nodes: ColNode[]): string {
  return nodes.map((n) => n.raw).join('\n').replace(/^[\r\n]+/, '').replace(/\s+$/, '');
}

/** Blank-line separated blocks — the plugin gives each one its own column. */
function splitBlocks(text: string): string[] {
  return text
    .split(/\n[ \t\r]*\n/)
    .map((s) => s.replace(/^[\r\n]+/, '').replace(/\s+$/, ''))
    .filter((s) => s.length > 0);
}

/* ------------------------------------------------------------------ */
/* Public parsers                                                      */
/* ------------------------------------------------------------------ */

/** The body of a ```col-md block: its settings and the Markdown below `===`. */
export function parseColMd(body: string): ColumnSpec {
  const { settings, rest } = takeSettings(colNodes(body));
  return { settings, content: nodesToMarkdown(rest) };
}

/**
 * The body of a ```col block.
 *
 * Every top-level item becomes its own column, as the plugin does: a `col-md`
 * fence groups several blocks into one column, any other fence is a column of
 * its own (that is how a nested `col` group is placed), and loose Markdown is
 * split on blank lines.
 */
export function parseColBlock(body: string): ColBlock {
  const { settings, rest } = takeSettings(colNodes(body));
  const rows: ColumnSpec[][] = [];
  let row: ColumnSpec[] = [];

  for (const n of rest) {
    if (n.kind === 'sep') {
      if (row.length) rows.push(row);
      row = [];
      continue;
    }
    if (n.kind === 'fence') {
      if (columnsLang(n.lang) === 'col-md') row.push(parseColMd(n.body));
      else row.push({ settings: {}, content: n.raw });
      continue;
    }
    for (const block of splitBlocks(n.raw)) row.push({ settings: {}, content: block });
  }
  if (row.length) rows.push(row);
  return { settings, rows };
}
