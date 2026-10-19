import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeRegions,
  flattenWikilinks,
  parseCallout,
  replaceOutsideCode,
  stripFrontmatter
} from '../src/textScan.ts';

/* ------------------------------------------------------------------ */
/* codeRegions / replaceOutsideCode — the B5 fix                       */
/* ------------------------------------------------------------------ */

test('replaceOutsideCode rewrites prose but not fenced code', () => {
  const md = [
    'Voir ![[capture.png]] ci-dessous.',
    '',
    '```markdown',
    'Pour insérer une image : ![[capture.png]]',
    '```',
    '',
    'Fin ![[autre.png]].'
  ].join('\n');

  const out = replaceOutsideCode(md, /!\[\[([^\]]+)\]\]/g, (m) => `<IMG:${m[1]}>`);

  assert.match(out, /Voir <IMG:capture\.png> ci-dessous/);
  assert.match(out, /Fin <IMG:autre\.png>/);
  // The quoted example inside the fence must survive verbatim.
  assert.match(out, /Pour insérer une image : !\[\[capture\.png\]\]/);
  assert.equal((out.match(/<IMG:/g) || []).length, 2);
});

test('replaceOutsideCode leaves inline code spans alone', () => {
  const md = 'Écrivez `![[capture.png]]` pour intégrer ![[capture.png]].';
  const out = replaceOutsideCode(md, /!\[\[([^\]]+)\]\]/g, () => '<IMG>');
  assert.equal(out, 'Écrivez `![[capture.png]]` pour intégrer <IMG>.');
});

test('replaceOutsideCode handles an unterminated fence as code to EOF', () => {
  const md = 'avant ![[a.png]]\n\n```\n![[b.png]]\n![[c.png]]\n';
  const out = replaceOutsideCode(md, /!\[\[([^\]]+)\]\]/g, () => '<IMG>');
  assert.equal((out.match(/<IMG>/g) || []).length, 1);
});

test('replaceOutsideCode does not rescan its own replacements', () => {
  // A replacement that itself looks like a match must not be re-processed:
  // this is exactly what split().join() got wrong.
  const md = 'x ![[a.png]] y';
  const out = replaceOutsideCode(md, /!\[\[([^\]]+)\]\]/g, () => '![[a.png]]');
  assert.equal(out, 'x ![[a.png]] y');
});

test('codeRegions marks tilde fences and indented blocks', () => {
  const md = 'para\n\n~~~\ncode\n~~~\n\ntexte\n\n    bloc indenté\n\nfin';
  const regions = codeRegions(md);
  const covers = (needle: string) => {
    const i = md.indexOf(needle);
    return regions.some((r) => i >= r.start && i < r.end);
  };
  assert.ok(covers('code'), 'tilde fence content should be code');
  assert.ok(covers('bloc indenté'), 'indented block should be code');
  assert.ok(!covers('texte'), 'prose should not be code');
});

/* ------------------------------------------------------------------ */
/* Frontmatter                                                         */
/* ------------------------------------------------------------------ */

test('stripFrontmatter removes the YAML block, including with BOM and CRLF', () => {
  assert.equal(stripFrontmatter('---\ntitre: X\n---\ncorps'), 'corps');
  assert.equal(stripFrontmatter('﻿---\r\ntitre: X\r\n---\r\ncorps'), 'corps');
  assert.equal(stripFrontmatter('pas de frontmatter'), 'pas de frontmatter');
});

test('stripFrontmatter keeps a horizontal rule that is not frontmatter', () => {
  const md = 'texte\n\n---\n\nsuite';
  assert.equal(stripFrontmatter(md), md);
});

/* ------------------------------------------------------------------ */
/* Wikilinks                                                           */
/* ------------------------------------------------------------------ */

test('flattenWikilinks resolves aliases, headings and leaves embeds alone', () => {
  assert.equal(flattenWikilinks('voir [[Rapport 2025]]'), 'voir Rapport 2025');
  assert.equal(flattenWikilinks('voir [[Rapport 2025|le rapport]]'), 'voir le rapport');
  assert.equal(flattenWikilinks('voir [[Rapport#Analyse]]'), 'voir Rapport');
  // ![[...]] is a transclusion, handled elsewhere — must not be flattened here.
  assert.equal(flattenWikilinks('![[capture.png]]'), '![[capture.png]]');
});

test('flattenWikilinks spares code', () => {
  assert.equal(flattenWikilinks('`[[Page]]`'), '`[[Page]]`');
});

/* ------------------------------------------------------------------ */
/* Callouts                                                            */
/* ------------------------------------------------------------------ */

test('parseCallout splits type, title and body', () => {
  const c = parseCallout('> [!warning] Attention\n> corps du callout\n> suite');
  assert.ok(c);
  assert.equal(c.type, 'warning');
  assert.equal(c.title, 'Attention');
  assert.equal(c.body, 'corps du callout\nsuite');
});

test('parseCallout accepts a fold marker and an absent title', () => {
  const c = parseCallout('> [!note]-\n> replié');
  assert.ok(c);
  assert.equal(c.type, 'note');
  assert.equal(c.fold, '-');
  assert.equal(c.title, '');
});

test('parseCallout returns null for a plain blockquote', () => {
  assert.equal(parseCallout('> simple citation'), null);
});
