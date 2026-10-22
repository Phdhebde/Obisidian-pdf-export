import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripFrontmatter } from '../src/textScan.ts';
import {
  AudienceError,
  MARK_END,
  emptyCounts,
  kept,
  normalizeLevels,
  noteMark,
  parseTlp,
  redact,
  stripComments,
  type AudienceFilter
} from '../src/redact.ts';
import { defaultPreset } from '../src/generator.ts';
import { buildDocDefinition } from './loose.ts';
import { buildDocx } from '../src/docx.ts';
import { allXml } from './docxRead.ts';
import type { ReportVars } from '../src/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = ['internal', 'management'];
const client: AudienceFilter = { levels, keep: [], tlp: 'CLEAR', placeholder: '', mark: false };
const managers: AudienceFilter = { levels, keep: ['management'], tlp: 'CLEAR', placeholder: '', mark: false };
const full: AudienceFilter = { levels, keep: null, tlp: 'CLEAR', placeholder: '', mark: false };

/* ------------------------------------------------------------------ */
/* Sentinels                                                           */
/* ------------------------------------------------------------------ */

/**
 * One secret per place text can travel. Each carries its own number, so a
 * failure names the place that leaked.
 */
const SENTINEL_NOTE = [
  '# Introduction',
  '',
  'Public text before. %%LEAK-01 inline comment%% Public text after.',
  '',
  '%%',
  'LEAK-02 a comment block',
  '%%',
  '',
  '## Pricing LEAK-03 %%internal%%',
  '',
  'The margin is LEAK-04.',
  '',
  '### Detail',
  '',
  '| Item | Cost |',
  '| --- | --- |',
  '| Hosting | LEAK-05 |',
  '',
  '```mermaid',
  'graph TD; A[LEAK-06] --> B',
  '```',
  '',
  '![LEAK-07 alt text](missing.png)',
  '',
  '## Delivery',
  '',
  '> [!internal] LEAK-08 callout title',
  '> LEAK-09 callout body, see [the deal](https://example.com/LEAK-10)',
  '> > LEAK-11 nested quote',
  'LEAK-12 lazy continuation line',
  '',
  'The plan ships in May<span data-audience="internal">, LEAK-13 unless the budget slips</span>.',
  '',
  '- First item',
  '- Second item <span data-audience="internal">LEAK-14 in a list</span>',
  '',
  '| Phase | Owner |',
  '| --- | --- |',
  '| Build | Team <span data-audience="internal">LEAK-15 in a cell</span> |',
  '',
  '## Next steps <span data-audience="internal">LEAK-16 in a heading</span>',
  '',
  'Closing words.'
].join('\n');

const SECRETS = Array.from({ length: 16 }, (_, i) => `LEAK-${String(i + 1).padStart(2, '0')}`);
/** Comments are cut from every export, whatever the profile. */
const COMMENT_SECRETS = ['LEAK-01', 'LEAK-02'];

function leaked(text: string, secrets = SECRETS): string[] {
  return secrets.filter((s) => text.includes(s));
}

const vars: ReportVars = {
  docTitle: 'Sentinel',
  client: '',
  tlp: null,
  coverTitle: 'Sentinel',
  coverSubtitle: '',
  coverSubtitle2: '',
  tocTitle: '',
  versions: [],
  contacts: [],
  recipients: [],
  author: ''
};

test('a client export leaks none of the sentinels, in the Markdown, the PDF definition or the Word file', () => {
  const counts = emptyCounts();
  const md = redact(SENTINEL_NOTE, client, counts);
  assert.deepEqual(leaked(md), []);

  const dd = buildDocDefinition(md, vars, defaultPreset({}, 'en'));
  assert.deepEqual(leaked(JSON.stringify(dd)), []);
  assert.deepEqual(leaked(allXml(buildDocx(md, vars, defaultPreset({}, 'en')).bytes)), []);

  assert.deepEqual(counts, { notes: 0, sections: 1, blocks: 1, phrases: 4 });
  // What is not marked stays.
  for (const kept of ['Public text before.', 'Public text after.', 'The plan ships in May.', 'Closing words.', 'Second item']) {
    assert.ok(md.includes(kept), kept);
  }
});

test('a full export keeps every marked passage, and only comments go', () => {
  // The other half of the sentinel test: without it, a broken fixture would
  // pass the leak test above by containing no secrets at all.
  const md = redact(SENTINEL_NOTE, full);
  assert.deepEqual(leaked(md), SECRETS.filter((s) => !COMMENT_SECRETS.includes(s)));
  assert.deepEqual(leaked(md, COMMENT_SECRETS), []);
  // Markers and tags do not show either.
  assert.ok(!md.includes('%%'));
  assert.ok(!md.includes('data-audience'));

  const dd = JSON.stringify(buildDocDefinition(md, vars, defaultPreset({}, 'en')));
  // The mermaid source and the image alt text are consumed by the renderer.
  const docx = allXml(buildDocx(md, vars, defaultPreset({}, 'en')).bytes);
  for (const s of ['LEAK-03', 'LEAK-04', 'LEAK-05', 'LEAK-08', 'LEAK-09', 'LEAK-13', 'LEAK-14', 'LEAK-15', 'LEAK-16']) {
    assert.ok(dd.includes(s), s);
    assert.ok(docx.includes(s), `${s} in the Word file`);
  }
});

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

test('a marked section runs to the next heading of the same or a higher level', () => {
  const md = ['# A', '## B %%internal%%', 'secret', '### C', 'secret too', '## D', 'public', '# E', 'public'].join('\n');
  const out = redact(md, client);
  assert.equal(out, ['# A', '## D', 'public', '# E', 'public'].join('\n'));
});

test('a heading inside a code block is not a marker, nor a section end', () => {
  const md = ['## B %%internal%%', '```', '## not a heading %%internal%%', '```', 'secret', '## C', 'public'].join('\n');
  assert.equal(redact(md, client), ['## C', 'public'].join('\n'));

  const quoted = ['```md', '## Example %%internal%%', '```', 'public'].join('\n');
  assert.equal(redact(quoted, client), quoted);
});

test('a comment that is not a declared level is only a comment', () => {
  const md = ['## Plan %%TODO check dates%%', 'public'].join('\n');
  assert.equal(redact(md, client), ['## Plan ', 'public'].join('\n'));
});

test('a profile keeps the levels it lists, and a passage needs all of its levels', () => {
  const md = [
    '## For managers %%management%%',
    'm',
    '## For staff %%internal%%',
    'i',
    '## For both %%internal%% %%management%%',
    'b',
    '## Public',
    'p'
  ].join('\n');
  assert.equal(redact(md, managers), ['## For managers ', 'm', '## Public', 'p'].join('\n'));
});

test('a placeholder marks the cut when asked', () => {
  const md = ['## Kept', 'a', '## Cut %%internal%%', 'b', '## After', 'c'].join('\n');
  const out = redact(md, { ...client, placeholder: 'passage removed' });
  assert.equal(out, ['## Kept', 'a', '*[passage removed]*', '## After', 'c'].join('\n'));
});

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

test('an internal callout goes with its nested quotes, and stops at a blank line', () => {
  const md = ['> [!internal]', '> secret', '> > deeper', '', '> [!note]', '> public'].join('\n');
  assert.equal(redact(md, client), ['', '> [!note]', '> public'].join('\n'));
});

test('a nested internal callout leaves its parent quote in place', () => {
  const md = ['> [!note] Parent', '> public', '> > [!internal]', '> > secret', '> after'].join('\n');
  const out = redact(md, { ...client, placeholder: 'removed' });
  assert.equal(out, ['> [!note] Parent', '> public', '> *[removed]*', '> after'].join('\n'));
});

test('a callout is not cut through the next block when there is no blank line', () => {
  const md = ['> [!internal]', '> secret', '## Next', 'public'].join('\n');
  assert.equal(redact(md, client), ['## Next', 'public'].join('\n'));
});

test('an undeclared callout type is an ordinary callout', () => {
  const md = ['> [!warning] Careful', '> public'].join('\n');
  assert.equal(redact(md, client), md);
});

/* ------------------------------------------------------------------ */
/* Phrases                                                             */
/* ------------------------------------------------------------------ */

test('a kept phrase is unwrapped, so its tags are not printed', () => {
  const md = 'A <span data-audience="management">b</span> c';
  assert.equal(redact(md, managers), 'A b c');
});

test('spans nest, and an inner plain span does not close the marked one', () => {
  const md = 'x <span data-audience="internal">a <span class="hl">b</span> c</span> y';
  assert.equal(redact(md, client), 'x  y');
  assert.equal(redact(md, full), 'x a <span class="hl">b</span> c y');
});

test('a span quoted in code is left alone', () => {
  const md = 'Write `<span data-audience="internal">x</span>` to mark a phrase.';
  assert.equal(redact(md, client), md);
});

test('an unclosed span stops the export', () => {
  assert.throws(() => redact('a <span data-audience="internal">secret', client), AudienceError);
  // Even in a full export: the same note must not export one way and fail the other.
  assert.throws(() => redact('a <span data-audience="internal">secret', full), AudienceError);
});

test('an unknown level on a span stops the export', () => {
  assert.throws(() => redact('a <span data-audience="internl">secret</span>', client), /internl/);
});

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

test('comments are removed inline and across lines, but not in code', () => {
  assert.equal(stripComments('a %%b%% c'), 'a  c');
  assert.equal(stripComments(['a', '%%', 'b', '%%', 'c'].join('\n')), ['a', '', 'c'].join('\n'));
  assert.equal(stripComments('`%%kept%%` and %%gone%%'), '`%%kept%%` and ');
  const mermaid = ['```mermaid', '%%{init: {}}%%', 'graph TD', '```'].join('\n');
  assert.equal(stripComments(mermaid), mermaid);
});

test('an unclosed comment hides the rest of the note, as in Obsidian', () => {
  assert.equal(stripComments('public %% secret\nmore secret'), 'public ');
});

/* ------------------------------------------------------------------ */
/* Notes and levels                                                    */
/* ------------------------------------------------------------------ */

test('a note marked for an audience is kept only by profiles that keep it', () => {
  const fm = { audience: 'internal' };
  assert.equal(kept(client, noteMark(fm, client, 'n', false)), false);
  assert.equal(kept(full, noteMark(fm, full, 'n', false)), true);
  assert.equal(kept(managers, noteMark({ audience: ['management'] }, managers, 'n', false)), true);
  assert.equal(kept(client, noteMark({}, client, 'n', false)), true);
});

test('an unknown audience in the frontmatter stops the export', () => {
  assert.throws(() => noteMark({ audience: 'interne' }, client, 'Plan', false), /interne.*Plan|Plan.*interne/s);
});

test('levels are normalised from text or lists', () => {
  assert.deepEqual(normalizeLevels('Internal, management internal'), ['internal', 'management']);
  assert.deepEqual(normalizeLevels([' Board ', '', 'board']), ['board']);
});

/* ------------------------------------------------------------------ */
/* TLP                                                                 */
/* ------------------------------------------------------------------ */

const amber: AudienceFilter = { ...client, tlp: 'AMBER' };

test('TLP levels are read as written in notes', () => {
  assert.equal(parseTlp('red'), 'RED');
  assert.equal(parseTlp('TLP:Amber+Strict'), 'AMBER+STRICT');
  assert.equal(parseTlp('white'), 'CLEAR');
  assert.equal(parseTlp('rouge'), null);
});

test('a TLP section leaves the versions marked less strictly', () => {
  const md = ['## Sources %%tlp:red%%', 'r', '## Partners %%tlp:amber%%', 'a', '## Public %%tlp:clear%%', 'c'].join('\n');
  assert.equal(redact(md, amber), ['## Partners ', 'a', '## Public ', 'c'].join('\n'));
  assert.equal(redact(md, { ...client, tlp: 'RED' }).match(/^## /gm)?.length, 3);
  // A client version with no marking at all keeps only what is CLEAR.
  assert.equal(redact(md, client), ['## Public ', 'c'].join('\n'));
});

test('a TLP phrase and a TLP embedded note follow the same rule', () => {
  assert.equal(redact('a <span data-tlp="red">b</span> c', amber), 'a  c');
  assert.equal(redact('a <span data-tlp="green">b</span> c', amber), 'a b c');
  assert.equal(kept(amber, noteMark({ tlp: 'red' }, amber, 'n', true)), false);
  assert.equal(kept(amber, noteMark({ tlp: 'green' }, amber, 'n', true)), true);
  // The exported note's own TLP is the document's marking, not a filter.
  assert.equal(kept(amber, noteMark({ tlp: 'red' }, amber, 'n', false)), true);
});

test('an unknown TLP level stops the export', () => {
  assert.throws(() => redact('## Sources %%tlp:rouge%%\nx', amber), /rouge/);
  assert.throws(() => redact('<span data-tlp="rouge">x</span>', full), /rouge/);
  assert.throws(() => noteMark({ tlp: 'rouge' }, amber, 'Annex', true), /rouge/);
});

test('the full version keeps TLP passages too', () => {
  assert.equal(redact('## Sources %%tlp:red%%\nr', full), '## Sources \nr');
});

/* ------------------------------------------------------------------ */
/* Showing kept passages                                               */
/* ------------------------------------------------------------------ */

const fullMarked: AudienceFilter = { ...full, mark: true };

test('a kept section is framed by markers the generator turns into a label', () => {
  const md = ['## Pricing %%internal%%', 'm', '### Detail %%tlp:red%%', 'd', '## Public', 'p'].join('\n');
  const out = redact(md, fullMarked);
  assert.equal(
    out,
    [
      '## Pricing ', '', '<!-- report-mark-start INTERNAL -->', '', 'm',
      '### Detail ', '', '<!-- report-mark-start TLP:RED -->', '', 'd',
      '', MARK_END, '', '', MARK_END, '',
      '## Public', 'p'
    ].join('\n')
  );

  const dd = JSON.stringify(buildDocDefinition(out, vars, defaultPreset({}, 'en')));
  assert.ok(dd.includes(' INTERNAL '));
  assert.ok(dd.includes(' TLP:RED '));
  assert.ok(dd.includes('Restricted passage'));
  assert.ok(!dd.includes('report-mark'));
});

test('a kept phrase is highlighted, and its tags are not printed', () => {
  const out = redact('Ships in May <span data-audience="internal">unless delayed</span>.', fullMarked);
  assert.equal(out, 'Ships in May <span data-report-mark="INTERNAL">unless delayed</span>.');
  const dd = buildDocDefinition(out, vars, defaultPreset({}, 'en'));
  const json = JSON.stringify(dd);
  assert.ok(!json.includes('<span'));
  assert.match(json, /"text":"unless delayed","background":"#[0-9A-Fa-f]{6}"/);
});

test('without marking, nothing is framed', () => {
  assert.equal(redact('## Pricing %%internal%%\nm', full), '## Pricing \nm');
});

test('a kept restricted callout is framed at the top level, left alone when nested', () => {
  const md = ['> [!internal] Deal', '> walk away below 10', '', '- item', '  > [!internal]', '  > nested'].join('\n');
  assert.equal(
    redact(md, fullMarked),
    ['', '<!-- report-mark-start INTERNAL -->', '', '> [!internal] Deal', '> walk away below 10', '', MARK_END, '', '',
      '- item', '  > [!internal]', '  > nested'].join('\n')
  );
});

test('the example note exports as its closing paragraph says', () => {
  const note = stripFrontmatter(readFileSync(join(root, 'example-confidential.md'), 'utf8'));
  const counts = emptyCounts();
  const md = redact(note, { levels: ['internal'], keep: [], tlp: 'AMBER', placeholder: '', mark: false }, counts);
  for (const gone of ['ops team', 'network team', '104 k€', 'at cost', 'Paul', 'breached']) assert.ok(!md.includes(gone), gone);
  for (const stays of ['three years', 'Scope', 'Delivery', 'Failover test', 'Next steps']) assert.ok(md.includes(stays), stays);
  assert.deepEqual(counts, { notes: 0, sections: 2, blocks: 1, phrases: 2 });
});

test('marking does not weaken a restricted version', () => {
  const md = redact(SENTINEL_NOTE, { ...client, mark: true });
  assert.deepEqual(leaked(md), []);
});
