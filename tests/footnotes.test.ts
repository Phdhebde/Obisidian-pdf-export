import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFootnotes, pruneFootnotes } from '../src/footnotes.ts';

test('references are numbered in reading order, and a note cited twice keeps its number', () => {
  const md = ['Second[^b] then first[^a], then second again[^b].', '', '[^a]: Note A', '[^b]: Note B'].join('\n');
  const { md: body, notes } = extractFootnotes(md);
  assert.equal(body, 'Second<report-fn n="1"> then first<report-fn n="2">, then second again<report-fn n="1">.\n');
  assert.deepEqual(notes, [{ n: 1, md: 'Note B' }, { n: 2, md: 'Note A' }]);
});

test('inline notes, continuation lines and inline code are read as Obsidian does', () => {
  const md = [
    'A claim.^[An inline note with `code` and [a link](https://example.com).] Another.[^long]',
    '',
    '[^long]: First line with `[^not-a-ref]`',
    '    and a continuation.',
    '',
    'After.'
  ].join('\n');
  const { md: body, notes } = extractFootnotes(md);
  // The definition's lines go; the blank lines around them stay, which Markdown ignores.
  assert.equal(body, 'A claim.<report-fn n="1"> Another.<report-fn n="2">\n\n\nAfter.');
  assert.deepEqual(notes, [
    { n: 1, md: 'An inline note with `code` and [a link](https://example.com).' },
    { n: 2, md: 'First line with `[^not-a-ref]`\nand a continuation.' }
  ]);
});

test('code is left alone, and a reference without a definition stays as written', () => {
  const md = ['Use `[^x]` here[^missing].', '', '```', '[^x]: not a definition', 'nor this[^x]', '```', '', '[^x]: The real one'].join('\n');
  const { md: body, notes } = extractFootnotes(md);
  assert.ok(body.includes('`[^x]`'));
  assert.ok(body.includes('here[^missing].'));
  assert.ok(body.includes('[^x]: not a definition\nnor this[^x]'));
  // Defined but only cited inside code: never numbered.
  assert.deepEqual(notes, []);
});

test('the first definition of an id wins', () => {
  const { notes } = extractFootnotes('X[^a]\n\n[^a]: first\n[^a]: second');
  assert.deepEqual(notes, [{ n: 1, md: 'first' }]);
});

test('pruning drops the definitions nothing cites any more, continuation lines included', () => {
  const md = ['Kept[^a].', '', '[^a]: cited', '[^b]: orphan', '    still the orphan', 'Next paragraph.'].join('\n');
  assert.equal(pruneFootnotes(md), ['Kept[^a].', '', '[^a]: cited', 'Next paragraph.'].join('\n'));
  const untouched = 'Kept[^a].\n\n[^a]: cited';
  assert.equal(pruneFootnotes(untouched), untouched);
});
