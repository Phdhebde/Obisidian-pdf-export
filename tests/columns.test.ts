/*
 * Obsidian Columns support: parsing (columns.ts) and layout (generator.ts).
 *
 * The reference document is the README of tnichols217/obsidian-columns — the
 * nested example below is copied from it, backticks and all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calloutSpan, columnsLang, parseColBlock, parseColMd } from '../src/columns.ts';
import { defaultPreset } from '../src/generator.ts';
import { markdownToPdf, type PdfNode } from './loose.ts';
import { codeRegions, overlaps, replaceOutsideCode } from '../src/textScan.ts';
import type { Preset } from '../src/types.ts';

const preset = (over: Partial<Preset> = {}): Preset => Object.assign(defaultPreset(), over);

/** Build a fence of `n` backticks — writing them inline gets unreadable fast. */
const tick = (n: number) => '`'.repeat(n);

/** Depth-first walk over a pdfmake content tree. */
function walk(node: unknown, visit: (n: PdfNode) => void): void {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  if (!node || typeof node !== 'object') return;
  const n = node as PdfNode;
  visit(n);
  for (const key of ['stack', 'columns', 'ul', 'ol', 'content', 'body', 'text']) {
    if (Array.isArray(n[key])) walk(n[key], visit);
  }
  if (n.table) walk(n.table.body, visit);
}

function collectText(node: unknown): string {
  const parts: string[] = [];
  walk(node, (n) => { if (typeof n.text === 'string') parts.push(n.text); });
  return parts.join('\n');
}

/**
 * Every column *row* in the tree, outermost first.
 *
 * pdfmake `columns` nodes are also how a callout lays out its icon and a task
 * list its checkbox; the 12pt gutter is what tells ours apart.
 */
function allColumns(node: unknown): PdfNode[][] {
  const out: PdfNode[][] = [];
  walk(node, (n) => { if (Array.isArray(n.columns) && n.columnGap === 12) out.push(n.columns); });
  return out;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

test('columnsLang recognises the fence and callout spellings', () => {
  assert.equal(columnsLang('col'), 'col');
  assert.equal(columnsLang('COL'), 'col');
  assert.equal(columnsLang('col-md'), 'col-md');
  assert.equal(columnsLang('col-md-2.5'), 'col-md');
  assert.equal(columnsLang('col-md-10'), 'col-md');
  assert.equal(columnsLang('js'), null);
  assert.equal(columnsLang('column'), null);
  assert.equal(columnsLang(''), null);
  assert.equal(columnsLang(undefined), null);
});

test('calloutSpan reads the width multiplier of a col-md callout', () => {
  assert.equal(calloutSpan('col-md-2.5'), 2.5);
  assert.equal(calloutSpan('col-md'), null);
  assert.equal(calloutSpan('col-md-0'), null);
});

test('parseColMd splits the settings block off the content', () => {
  const spec = parseColMd('flexGrow=2.5\ntextAlign=center\n===\n# Titre\n\nDu texte.');
  assert.deepEqual(spec.settings, { flexgrow: '2.5', textalign: 'center' });
  assert.equal(spec.content, '# Titre\n\nDu texte.');
});

test('parseColMd keeps everything when there is no settings block', () => {
  const spec = parseColMd('# Titre\n\nDu texte.');
  assert.deepEqual(spec.settings, {});
  assert.equal(spec.content, '# Titre\n\nDu texte.');
});

test('a setext heading inside a column is not mistaken for a settings block', () => {
  // `Titre` over `===` is an H1, and the lines above `===` are not key=value.
  const spec = parseColMd('Titre\n===\n\nDu texte.');
  assert.deepEqual(spec.settings, {});
  assert.equal(spec.content, 'Titre\n===\n\nDu texte.');
});

test('parseColBlock gives every top-level item its own column', () => {
  const body = [
    tick(3) + 'col-md',
    'flexGrow=1',
    '===',
    'A',
    tick(3),
    '',
    tick(3) + 'col-md',
    'flexGrow=2',
    '===',
    'B',
    tick(3)
  ].join('\n');
  const block = parseColBlock(body);
  assert.equal(block.rows.length, 1);
  assert.deepEqual(block.rows[0].map((c) => c.settings.flexgrow), ['1', '2']);
  assert.deepEqual(block.rows[0].map((c) => c.content), ['A', 'B']);
});

test('loose Markdown in a col body is split into one column per block', () => {
  const block = parseColBlock('Colonne A\n\nColonne B\n\n- une liste\n- sur deux lignes');
  assert.equal(block.rows.length, 1);
  assert.deepEqual(block.rows[0].map((c) => c.content), [
    'Colonne A',
    'Colonne B',
    '- une liste\n- sur deux lignes'
  ]);
});

test('a second === starts a new row, the first one carries the settings', () => {
  const body = ['textAlign=center', '===', 'A', '', 'B', '===', 'C'].join('\n');
  const block = parseColBlock(body);
  assert.deepEqual(block.settings, { textalign: 'center' });
  assert.deepEqual(block.rows.map((r) => r.map((c) => c.content)), [['A', 'B'], ['C']]);
});

test('an empty settings block is how you get rows without settings', () => {
  const block = parseColBlock(['===', 'A', '===', 'B'].join('\n'));
  assert.deepEqual(block.settings, {});
  assert.deepEqual(block.rows.map((r) => r.map((c) => c.content)), [['A'], ['B']]);
});

test('a non-col fence inside a col body becomes a column of its own', () => {
  const body = [tick(3) + 'js', 'let a = 1;', tick(3)].join('\n');
  const block = parseColBlock(body);
  assert.equal(block.rows[0].length, 1);
  // The fence is handed back whole, so the code block is still lexed as code.
  assert.equal(block.rows[0][0].content, body);
});

/* ------------------------------------------------------------------ */
/* The README's nested example                                         */
/* ------------------------------------------------------------------ */

/** The example from the plugin's README, verbatim. */
const NESTED = [
  tick(7) + 'col',
  tick(6) + 'col-md',
  'flexGrow=1',
  '===',
  '> [!info] Callouts',
  '>  Stuff inside the callout',
  '>  More stuff inside.',
  '>> [!ERROR] Error description',
  '>>  Nested callout',
  '>>  ' + tick(5) + 'col-md',
  '>>  - example MD code',
  '>>  - more stuff',
  '>>  ' + tick(5),
  tick(6),
  '',
  tick(6) + 'col-md',
  'flexGrow=2.5',
  '===',
  '# Text annotation example:',
  '',
  tick(5) + 'col',
  tick(4) + 'col-md',
  'flexGrow=1',
  '===',
  '1. Function name **a** should be more descriptive',
  '',
  '2. Remove **if/else** by using **||**',
  tick(4),
  '',
  tick(4) + 'col-md',
  'flexGrow=2',
  '===',
  tick(3) + 'js',
  'function a(word) {',
  '    if (word != null) {',
  '        console.log(word);',
  '    }',
  '}',
  tick(3),
  tick(4),
  tick(5),
  tick(6),
  tick(7)
].join('\n');

test('the nested README example splits into two columns at 1 / 2.5', () => {
  const inner = NESTED.split('\n').slice(1, -1).join('\n');
  const block = parseColBlock(inner);
  assert.equal(block.rows.length, 1);
  assert.deepEqual(block.rows[0].map((c) => c.settings.flexgrow), ['1', '2.5']);
});

test('the nested README example renders as columns inside columns', () => {
  const nodes = markdownToPdf(NESTED, preset());
  const groups = allColumns(nodes);

  // The outer group, then the one nested in the right-hand column.
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
  assert.equal(groups[1].length, 2);

  // A4 less the preset's 64pt margins, one 12pt gutter, split 1 : 2.5.
  const text = 595.28 - 64 - 64;
  const [left, right] = groups[0];
  assert.ok(Math.abs(right.width / left.width - 2.5) < 1e-6);
  assert.ok(Math.abs(left.width + right.width - (text - 12)) < 1e-6);
  // The nested group only has the right-hand column to divide.
  assert.ok(groups[1][0].width + groups[1][1].width < right.width);

  const printed = collectText(nodes);
  assert.match(printed, /Callouts/);
  assert.match(printed, /Error description/);
  assert.match(printed, /Text annotation example/);
  assert.match(printed, /console\.log\(word\)/);
  // The col-md nested inside the ERROR callout, five backticks deep.
  assert.match(printed, /example MD code/);
});

test('the js block inside a column is still printed as code', () => {
  const nodes = markdownToPdf(NESTED, preset());
  let mono = 0;
  walk(nodes, (n) => { if (n.style === 'code') mono++; });
  assert.equal(mono, 1);
});

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const colBlock = (...parts: string[]) => [tick(4) + 'col', ...parts, tick(4)].join('\n');
const colMd = (...parts: string[]) => [tick(3) + 'col-md', ...parts, tick(3)].join('\n');

test('flexGrow drives the column widths, and defaults to 1', () => {
  const md = colBlock(colMd('Un'), colMd('flexGrow=3', '===', 'Deux'));
  const [cols] = allColumns(markdownToPdf(md, preset()));
  assert.equal(cols.length, 2);
  assert.ok(Math.abs(cols[1].width / cols[0].width - 3) < 1e-6);
});

test('textAlign applies to the column, and the group value is the default', () => {
  const md = colBlock('textAlign=center', '===', colMd('Un'), colMd('textAlign=right', '===', 'Deux'));
  const [cols] = allColumns(markdownToPdf(md, preset()));
  const alignOf = (n: PdfNode) => {
    const found: string[] = [];
    walk(n, (x) => { if (x.text !== undefined && x.alignment) found.push(x.alignment); });
    return found;
  };
  assert.deepEqual(alignOf(cols[0]), ['center']);
  assert.deepEqual(alignOf(cols[1]), ['right']);
});

test('border settings draw a frame and eat into the column width', () => {
  const md = colBlock(colMd('borderColor=red', 'borderWidth=4px', 'borderPadding=10', '===', 'Un'));
  const [cols] = allColumns(markdownToPdf(md, preset()));
  const box = cols[0].stack[0];
  assert.ok(box.table, 'the column is wrapped in a one-cell table');
  assert.equal(box.layout.vLineWidth(), 3); // 4px -> 3pt
  assert.equal(box.layout.hLineColor(), 'red');
  assert.equal(box.layout.paddingLeft(), 7.5); // 10px -> 7.5pt
});

test('a column with no border settings is not wrapped in a table', () => {
  const [cols] = allColumns(markdownToPdf(colBlock(colMd('Un')), preset()));
  assert.equal(cols[0].stack[0].table, undefined);
});

test('height is accepted and ignored — a page cannot scroll', () => {
  const md = colBlock('height=shortest', '===', colMd('height=200px', '===', 'Un'));
  const nodes = markdownToPdf(md, preset());
  assert.equal(allColumns(nodes).length, 1);
  assert.match(collectText(nodes), /Un/);
});

test('a col-md on its own is rendered full width, without a column node', () => {
  const nodes = markdownToPdf(colMd('flexGrow=2', '===', 'Seul'), preset());
  assert.equal(allColumns(nodes).length, 0);
  assert.equal(nodes[0].width, undefined);
  assert.match(collectText(nodes), /Seul/);
});

test('an empty col block renders nothing rather than an empty row', () => {
  assert.deepEqual(markdownToPdf(colBlock(), preset()), []);
});

/* ------------------------------------------------------------------ */
/* Callout and list syntaxes                                           */
/* ------------------------------------------------------------------ */

test('the callout syntax makes a column of every item', () => {
  const md = ['> [!col]', '> Colonne A', '>', '> Colonne B'].join('\n');
  const [cols] = allColumns(markdownToPdf(md, preset()));
  assert.equal(cols.length, 2);
  assert.match(collectText(cols[0]), /Colonne A/);
  assert.match(collectText(cols[1]), /Colonne B/);
});

test('a nested col-md callout groups items, and its suffix is its flexGrow', () => {
  const md = [
    '> [!col]',
    '> Colonne A',
    '>',
    '>> [!col-md-3]',
    '>> Colonne B',
    '>>',
    '>> Toujours la colonne B'
  ].join('\n');
  const [cols] = allColumns(markdownToPdf(md, preset()));
  assert.equal(cols.length, 2);
  assert.ok(Math.abs(cols[1].width / cols[0].width - 3) < 1e-6);
  assert.match(collectText(cols[1]), /Toujours la colonne B/);
});

test('an ordinary callout is still an ordinary callout', () => {
  const nodes = markdownToPdf('> [!warning] Attention\n> Le texte.', preset());
  assert.equal(allColumns(nodes).length, 0);
  assert.match(collectText(nodes), /Attention/);
});

test('the list syntax builds columns from the flexGrow sub-items', () => {
  const md = [
    '- !!!col',
    '\t- 1',
    '\t\t# Colonne 1',
    '\t- 2',
    '\t\t# Colonne 2'
  ].join('\n');
  const [cols] = allColumns(markdownToPdf(md, preset()));
  assert.equal(cols.length, 2);
  assert.ok(Math.abs(cols[1].width / cols[0].width - 2) < 1e-6);
  assert.match(collectText(cols[0]), /Colonne 1/);
  assert.match(collectText(cols[1]), /Colonne 2/);
});

test('an ordinary list is left alone', () => {
  const nodes = markdownToPdf('- un\n- deux', preset());
  assert.equal(allColumns(nodes).length, 0);
  assert.equal((nodes[0].ul || []).length, 2);
});

/* ------------------------------------------------------------------ */
/* CRLF                                                                */
/* ------------------------------------------------------------------ */

/*
 * A note saved on Windows has \r\n line endings. marked normalises them before
 * lexing, but codeRegions runs on the raw file and columns.ts is called with
 * whatever it is given, so both have to survive the trailing \r.
 */

test('a col block parses the same with CRLF line endings', () => {
  const body = [
    'textAlign=center',
    '===',
    tick(3) + 'col-md',
    'flexGrow=2',
    '===',
    'A',
    tick(3)
  ].join('\r\n');
  const block = parseColBlock(body);
  assert.deepEqual(block.settings, { textalign: 'center' });
  assert.equal(block.rows.length, 1);
  assert.equal(block.rows[0].length, 1);
  assert.equal(block.rows[0][0].settings.flexgrow, '2');
  assert.equal(block.rows[0][0].content.trim(), 'A');
});

test('codeRegions still finds fences in a CRLF note', () => {
  const md = [
    tick(3) + 'js',
    '// ![[piege.png]]',
    tick(3),
    '',
    tick(4) + 'col',
    tick(3) + 'col-md',
    '![[capture.png]]',
    tick(3),
    tick(4)
  ].join('\r\n');
  const regions = codeRegions(md);

  const trap = md.indexOf('![[piege.png]]');
  assert.equal(overlaps(regions, trap, trap + 14), true, 'the js block stays code');
  const real = md.indexOf('![[capture.png]]');
  assert.equal(overlaps(regions, real, real + 16), false, 'the column stays prose');
});

/* ------------------------------------------------------------------ */
/* Pre-processing: a col fence is a container, not code                */
/* ------------------------------------------------------------------ */

test('codeRegions leaves a col fence open so embeds inside it are rewritten', () => {
  const md = [
    tick(4) + 'col',
    colMd('![[capture.png]]'),
    tick(4)
  ].join('\n');
  const regions = codeRegions(md);
  const at = md.indexOf('![[capture.png]]');
  assert.equal(overlaps(regions, at, at + 16), false);
  assert.equal(
    replaceOutsideCode(md, /!\[\[([^\]]+)\]\]/g, (m) => `![](report-image:${m[1]})`).includes('report-image:capture.png'),
    true
  );
});

test('a real code fence inside a col block is still protected', () => {
  const md = [
    tick(4) + 'col',
    tick(3) + 'js',
    '// ![[capture.png]]',
    tick(3),
    tick(4)
  ].join('\n');
  const at = md.indexOf('![[capture.png]]');
  assert.equal(overlaps(codeRegions(md), at, at + 16), true);
});
