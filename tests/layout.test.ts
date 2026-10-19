/*
 * Preset-driven layout: body text size, cover geometry and the client logo.
 *
 * The point of the first block is that the scaling is a *refactor* at the
 * default size: 11pt must still produce the exact numbers the generator used
 * to hard-code, or every existing report shifts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAGINATION, paginationPresets, defaultToc, headingLabel, headingNumber, defaultPreset, renderPagination } from '../src/generator.ts';
import { buildDocDefinition, markdownToPdf, type PdfNode } from './loose.ts';
import { migratePreset } from '../src/storage.ts';
import type { Preset, ReportVars } from '../src/types.ts';

const preset = (over: Partial<Preset> = {}): Preset =>
  Object.assign(defaultPreset({ coverBg: 'COVER', frame: 'FRAME' }), over);

const vars = (over: Partial<ReportVars> = {}): Partial<ReportVars> =>
  Object.assign({ docTitle: 'Rapport', client: 'ACME', versions: [], contacts: [] }, over);

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

/* ------------------------------------------------------------------ */
/* Body text size                                                      */
/* ------------------------------------------------------------------ */

/** The sizes the generator hard-coded before they became expressions. */
const SIZES_AT_11: Record<string, number> = {
  h1: 22, h2: 14, h2heavy: 16, h3: 11, h4: 11, h5: 10, h6: 10,
  subBold: 11, body: 11, bodyTight: 10, listItem: 11, caption: 9,
  calloutTitle: 11, tableHeader: 10, tableCell: 10,
  tocTitle: 16, tocH1: 12, tocH2: 11, tocH3: 11, tocNumH1: 12, tocNumSub: 11,
  code: 9.5
};

test('at the default 11pt every style keeps the size it always had', () => {
  const dd = buildDocDefinition('# T', vars(), preset());
  for (const [name, size] of Object.entries(SIZES_AT_11)) {
    assert.equal(dd.styles[name].fontSize, size, `style ${name}`);
  }
});

test('raising the body size carries the headings and tables with it', () => {
  const p = preset();
  p.fonts.bodySize = 14;
  const dd = buildDocDefinition('# T', vars(), p);
  assert.equal(dd.styles.body.fontSize, 14);
  assert.equal(dd.styles.listItem.fontSize, 14);
  assert.equal(dd.styles.h2.fontSize, 17); // B + 3
  assert.equal(dd.styles.tableCell.fontSize, 13); // B - 1
  assert.equal(dd.styles.caption.fontSize, 12); // B - 2
  assert.equal(dd.styles.h1.fontSize, 28); // B * 2
});

test('an out-of-range or missing body size falls back to 11pt', () => {
  for (const bad of [0, -3, 400, NaN, undefined, 'grand']) {
    const p = preset();
    (p.fonts as any).bodySize = bad;
    const dd = buildDocDefinition('# T', vars(), p);
    assert.equal(dd.styles.body.fontSize, 11, `bodySize = ${String(bad)}`);
  }
});

/* ------------------------------------------------------------------ */
/* Cover geometry                                                      */
/* ------------------------------------------------------------------ */

/** Absolutely-positioned cover nodes carrying text. */
function coverText(dd: PdfNode): PdfNode[] {
  const out: PdfNode[] = [];
  walk(dd.content, (n) => { if (n.absolutePosition && n.text !== undefined) out.push(n); });
  return out;
}

test('the cover title sits where the preset puts it', () => {
  const p = preset();
  p.layout.cover.x = 60;
  p.layout.cover.titleY = 200;
  const dd = buildDocDefinition('', vars({ coverTitle: 'Titre' }), p);

  const titles = coverText(dd).filter((n) => n.text === 'TITRE');
  // The drop shadow and the title itself, the shadow offset by one point.
  assert.equal(titles.length, 2);
  assert.deepEqual(titles[0].absolutePosition, { x: 61, y: 201 });
  assert.deepEqual(titles[1].absolutePosition, { x: 60, y: 200 });
});

test('the subtitle and acronym follow their own coordinates', () => {
  const p = preset();
  p.layout.cover.subtitleY = 500;
  p.layout.cover.acronymY = 540;
  const dd = buildDocDefinition('', vars({ coverSubtitle: 'CERT', coverSubtitle2: 'ACME' }), p);

  const at = (t: string) => coverText(dd).find((n) => n.text === t)?.absolutePosition;
  assert.equal((at('CERT') as any).y, 500);
  assert.equal((at('ACME') as any).y, 540);
});

/** The cover's horizontal rule, if it was drawn. */
function ruleNode(dd: PdfNode): PdfNode | undefined {
  let found: PdfNode | undefined;
  walk(dd.content, (n) => {
    if (Array.isArray(n.canvas) && n.canvas[0]?.type === 'line' && n.absolutePosition) found = n;
  });
  return found;
}

test('the cover rule is drawn by default, at its own coordinates', () => {
  const p = preset();
  p.layout.cover.x = 60;
  p.layout.cover.ruleY = 400;
  p.layout.cover.ruleW = 120;

  const node = ruleNode(buildDocDefinition('', vars(), p));
  assert.ok(node, 'attendu un filet sur la couverture');
  assert.deepEqual(node.absolutePosition, { x: 60, y: 400 });
  assert.equal(node.canvas[0].x2, 120);
});

test('switching the rule off removes it and leaves the title alone', () => {
  const p = preset();
  p.layout.cover.showRule = false;
  const dd = buildDocDefinition('', vars({ coverTitle: 'Titre' }), p);

  assert.equal(ruleNode(dd), undefined);
  // The title and its drop shadow are still there.
  assert.equal(coverText(dd).filter((n) => n.text === 'TITRE').length, 2);
});

test('the rule follows the cover section: no cover, no rule', () => {
  const dd = buildDocDefinition('Du texte.', vars(), preset({ sections: ['body'] }));
  assert.equal(ruleNode(dd), undefined);
});

/* ------------------------------------------------------------------ */
/* Client logo                                                         */
/* ------------------------------------------------------------------ */

const LOGO_A = 'data:image/png;base64,AAAA';
const LOGO_B = 'data:image/png;base64,BBBB';

/** The cover logo node, if one was emitted. */
function logoNode(dd: PdfNode): PdfNode | undefined {
  let found: PdfNode | undefined;
  walk(dd.content, (n) => { if (n.image === 'coverLogo') found = n; });
  return found;
}

test('no logo anywhere means no logo node at all', () => {
  const dd = buildDocDefinition('', vars(), preset());
  assert.equal(logoNode(dd), undefined);
  assert.equal(dd.images.coverLogo, undefined);
});

test('the preset logo is drawn at the cover coordinates', () => {
  const p = preset();
  p.assets.clientLogo = LOGO_A;
  p.layout.cover.logoX = 400;
  p.layout.cover.logoY = 80;
  p.layout.cover.logoW = 140;

  const dd = buildDocDefinition('', vars(), p);
  const node = logoNode(dd);
  assert.ok(node, 'expected a logo on the cover');
  assert.equal(node.width, 140);
  assert.deepEqual(node.absolutePosition, { x: 400, y: 80 });
  assert.equal(dd.images.coverLogo, LOGO_A);
});

test("the note's own logo wins over the template's", () => {
  const p = preset();
  p.assets.clientLogo = LOGO_A;
  const dd = buildDocDefinition('', vars(), p, { clientLogo: LOGO_B });
  assert.equal(dd.images.coverLogo, LOGO_B);
});

test('the logo is drawn before the title, so the title stays readable', () => {
  const p = preset();
  p.assets.clientLogo = LOGO_A;
  const dd = buildDocDefinition('', vars({ coverTitle: 'Titre' }), p);

  const order: string[] = [];
  walk(dd.content, (n) => {
    if (n.image === 'coverLogo') order.push('logo');
    if (n.text === 'TITRE') order.push('titre');
  });
  assert.equal(order[0], 'logo');
});

test('a cover that is switched off carries no logo either', () => {
  const p = preset({ sections: ['body'] });
  p.assets.clientLogo = LOGO_A;
  const dd = buildDocDefinition('Du texte.', vars(), p);
  assert.equal(logoNode(dd), undefined);
});

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

test('a preset saved before 1.2 gains the new fields without changing', () => {
  const old = defaultPreset({}) as any;
  delete old.fonts.bodySize;
  delete old.assets.clientLogo;
  delete old.layout.cover.logoX;
  delete old.layout.cover.logoY;
  delete old.layout.cover.logoW;
  old.layout.cover.titleY = 300; // something the user had customised

  const p = migratePreset(old);
  assert.equal(p.fonts.bodySize, 11);
  assert.equal(p.assets.clientLogo, null);
  assert.equal(typeof p.layout.cover.logoW, 'number');
  assert.equal(p.layout.cover.titleY, 300, 'the customised value survives');

  // And nothing new shows up on the cover of a report built from it.
  assert.equal(logoNode(buildDocDefinition('', vars(), p)), undefined);
});

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

/** Every string the footer prints on page 3 of a 12-page report. */
function footerText(dd: PdfNode): string[] {
  const out: string[] = [];
  walk(dd.footer(3, 12), (n) => { if (typeof n.text === 'string') out.push(n.text); });
  return out;
}

test('renderPagination fills the tokens and tolerates spacing and case', () => {
  assert.equal(renderPagination('page {{page}}/{{total}}', 3, 12), 'page 3/12');
  assert.equal(renderPagination('{{ page }} sur {{ total }}', 3, 12), '3 sur 12');
  assert.equal(renderPagination('{{PAGE}}/{{Pages}}', 3, 12), '3/12');
  assert.equal(renderPagination('{{page}}', 3, 12), '3');
});

test('an empty or blank template prints nothing at all', () => {
  assert.equal(renderPagination('', 3, 12), '');
  assert.equal(renderPagination('   ', 3, 12), '');
  assert.equal(renderPagination(null, 3, 12), '');
  assert.equal(renderPagination(undefined, 3, 12), '');
});

test('a template with no token is printed as written', () => {
  // Not something to encourage, but it must not crash or drop the footer.
  assert.equal(renderPagination('interne', 3, 12), 'interne');
});

test('the default preset still prints "page 3/12" under the TLP marking', () => {
  const dd = buildDocDefinition('Du texte.', vars({ tlp: 'GREEN' }), preset());
  assert.deepEqual(footerText(dd), ['', 'TLP:GREEN', 'page 3/12']);
});

test('each ready-made format reaches the footer', () => {
  for (const { template, sample } of paginationPresets()) {
    const p = preset();
    p.layout.pagination = template;
    const printed = footerText(buildDocDefinition('Du texte.', vars(), p));
    if (template === '') {
      // No TLP marking either here, so the footer has nothing left to print.
      assert.equal(printed.length, 0, 'no page number line at all');
      continue;
    }
    assert.equal(printed[printed.length - 1], sample, `format ${JSON.stringify(template)}`);
  }
});

test('the TLP marking survives a pagination that prints nothing', () => {
  const p = preset();
  p.layout.pagination = '';
  const printed = footerText(buildDocDefinition('Du texte.', vars({ tlp: 'RED' }), p));
  assert.ok(printed.includes('TLP:RED'));
});

test('the footer position comes from the preset', () => {
  const p = preset();
  p.layout.footerY = 44;
  p.layout.footerRight = 30;
  const dd = buildDocDefinition('Du texte.', vars(), p);
  assert.deepEqual(dd.footer(3, 12).margin, [0, 44, 30, 0]);
  p.layout.headerY = 90;
  p.layout.headerRight = 24;
  assert.deepEqual(buildDocDefinition('Du texte.', vars(), p).header(3).margin, [0, 90, 24, 0]);
});

test('a preset saved before 1.3 gains the default pagination', () => {
  const old = defaultPreset({}) as any;
  delete old.layout.pagination;
  assert.equal(migratePreset(old).layout.pagination, DEFAULT_PAGINATION);
});

test('a pagination that is not text falls back to the default', () => {
  const old = defaultPreset({}) as any;
  old.layout.pagination = 42;
  assert.equal(migratePreset(old).layout.pagination, DEFAULT_PAGINATION);
});

/* ------------------------------------------------------------------ */
/* Heading numbering and the table of contents                         */
/* ------------------------------------------------------------------ */

/** Every heading node the body produced, in order. */
function headings(md: string, p: Preset): PdfNode[] {
  const styles = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  return markdownToPdf(md, p).filter((n) => styles.has(n.style));
}

const SIX_LEVELS = [
  '# Un',
  '## Deux',
  '### Trois',
  '#### Quatre',
  '##### Cinq',
  '###### Six'
].join('\n\n');

test('the default numbering is the one the generator used to hard-code', () => {
  const texts = headings(SIX_LEVELS, preset()).map((n) => n.text);
  assert.deepEqual(texts, ['Un', 'A.  Deux', '1. Trois', 'a) Quatre', 'Cinq', 'Six']);
});

test('by default the first three levels reach the table of contents', () => {
  const inToc = headings(SIX_LEVELS, preset()).map((n) => n.tocItem === true);
  assert.deepEqual(inToc, [true, true, true, false, false, false]);
});

test('counters restart under each higher heading', () => {
  const md = [
    '# Titre',
    '## Un', '### a', '### b',
    '## Deux', '### c'
  ].join('\n\n');
  const texts = headings(md, preset()).map((n) => n.text);
  assert.deepEqual(texts, ['Titre', 'A.  Un', '1. a', '2. b', 'B.  Deux', '1. c']);
});

test('roman numbering counts past the easy cases', () => {
  assert.equal(headingNumber('upperRoman', 1), 'I. ');
  assert.equal(headingNumber('upperRoman', 4), 'IV. ');
  assert.equal(headingNumber('lowerRoman', 9), 'ix. ');
  assert.equal(headingNumber('upperRoman', 14), 'XIV. ');
  assert.equal(headingNumber('lowerRoman', 1987), 'mcmlxxxvii. ');
});

test('each numbering style reaches the heading text', () => {
  const p = preset();
  p.toc.numbering = ['decimal', 'upperRoman', 'lowerRoman', 'upperAlpha', 'lowerAlpha', 'none'];
  const texts = headings(SIX_LEVELS, p).map((n) => n.text);
  assert.deepEqual(texts, ['1. Un', 'I. Deux', 'i. Trois', 'A.  Quatre', 'a) Cinq', 'Six']);
});

test('the levels listed in the table of contents are the ones asked for', () => {
  const p = preset();
  p.toc.levels = [false, true, false, true, false, false];
  const inToc = headings(SIX_LEVELS, p).map((n) => n.tocItem === true);
  assert.deepEqual(inToc, [false, true, false, true, false, false]);
});

test('a deep level listed in the summary is indented further than its parent', () => {
  const p = preset();
  p.toc.levels = [true, true, true, true, true, true];
  const margins = headings(SIX_LEVELS, p).map((n) => n.tocMargin[0]);
  for (let i = 1; i < margins.length; i++) {
    assert.ok(margins[i] > margins[i - 1], `niveau ${i + 1} plus indenté que ${i}`);
  }
});

test('a heading inside a callout does not disturb the document numbering', () => {
  const md = ['## Avant', '', '> [!info] Note', '> ## Dedans', '', '## Apres'].join('\n');
  const texts = headings(md, preset()).map((n) => n.text);
  // The callout renders its own tree, so only the two body headings are here.
  assert.deepEqual(texts, ['A.  Avant', 'B.  Apres']);
});

test('past Z the letters carry over instead of repeating', () => {
  const md = Array.from({ length: 28 }, (_, i) => `## T${i}`).join('\n\n');
  const texts = headings(md, preset()).map((n) => n.text);
  assert.equal(texts[25], 'Z.  T25');
  // Not `A.` again: two sections under one letter is unreadable, in the body
  // and in the table of contents alike.
  assert.equal(texts[26], 'AA.  T26');
  assert.equal(texts[27], 'AB.  T27');
});

test('the letter sequence is the one a spreadsheet uses for its columns', () => {
  const at = (n: number) => headingNumber('upperAlpha', n).trim();
  assert.equal(at(1), 'A.');
  assert.equal(at(26), 'Z.');
  assert.equal(at(27), 'AA.');
  assert.equal(at(52), 'AZ.');
  assert.equal(at(53), 'BA.');
  assert.equal(at(702), 'ZZ.');
  assert.equal(at(703), 'AAA.');
  // Lowercase follows the same run, brackets included.
  assert.equal(headingNumber('lowerAlpha', 27), 'aa) ');
});

test('a preset saved before 1.4.2 keeps its rule', () => {
  const old = defaultPreset({}) as any;
  delete old.layout.cover.showRule;
  assert.equal(migratePreset(old).layout.cover.showRule, true);
});

test('only a real false hides the rule — a stray string does not', () => {
  const old = defaultPreset({}) as any;
  old.layout.cover.showRule = 'non';
  assert.equal(migratePreset(old).layout.cover.showRule, true);
  old.layout.cover.showRule = false;
  assert.equal(migratePreset(old).layout.cover.showRule, false);
});

test('a preset without heading settings gets the default numbering', () => {
  const old = defaultPreset({}) as any;
  delete old.toc;
  assert.deepEqual(migratePreset(old).toc, defaultToc());
});

test('a truncated or garbled toc block is filled in level by level', () => {
  const old = defaultPreset({}) as any;
  old.toc = { levels: [false], numbering: ['decimal', 'pouet'] };
  const p = migratePreset(old);
  // Level 1 keeps what was stored, the rest falls back to the defaults.
  assert.deepEqual(p.toc.levels, [false, true, true, false, false, false]);
  assert.deepEqual(p.toc.numbering, ['decimal', 'upperAlpha', 'decimal', 'lowerAlpha', 'none', 'none']);
});

/* ------------------------------------------------------------------ */
/* Hierarchical numbering                                              */
/* ------------------------------------------------------------------ */

const hier = (numbering: Preset['toc']['numbering']): Preset => {
  const p = preset();
  p.toc.numbering = numbering;
  p.toc.hierarchical = true;
  return p;
};

test('hierarchical decimal numbering chains 1. 1.1 2. 2.1 2.2', () => {
  const p = hier(['decimal', 'decimal', 'decimal', 'none', 'none', 'none']);
  const md = ['# Un', '## a', '# Deux', '## b', '## c', '### d'].join('\n\n');
  const texts = headings(md, p).map((n) => n.text);
  assert.deepEqual(texts, ['1. Un', '1.1 a', '2. Deux', '2.1 b', '2.2 c', '2.2.1 d']);
});

test('each level keeps its own style inside the chain', () => {
  const p = hier(['decimal', 'upperAlpha', 'lowerAlpha', 'upperRoman', 'none', 'none']);
  const texts = headings(SIX_LEVELS, p).map((n) => n.text);
  assert.deepEqual(texts, ['1. Un', '1.A Deux', '1.A.a Trois', '1.A.a.I Quatre', 'Cinq', 'Six']);
});

test('an unnumbered parent drops out of the chain', () => {
  // The default layout: bare #, then A., then 1. — chained as A.1, not .A.1.
  const p = hier(['none', 'upperAlpha', 'decimal', 'none', 'none', 'none']);
  const texts = headings(SIX_LEVELS, p).map((n) => n.text);
  assert.deepEqual(texts.slice(0, 3), ['Un', 'A.  Deux', 'A.1 Trois']);
});

test('a skipped level does not print a zero', () => {
  const p = hier(['decimal', 'decimal', 'decimal', 'none', 'none', 'none']);
  const texts = headings(['# Un', '### Saut'].join('\n\n'), p).map((n) => n.text);
  assert.deepEqual(texts, ['1. Un', '1.1 Saut']);
});

test('the chained number is what the table of contents lists', () => {
  const p = hier(['decimal', 'decimal', 'none', 'none', 'none', 'none']);
  const [, sub] = headings(['# Un', '## Deux'].join('\n\n'), p);
  // pdfmake builds the TOC entry from the heading's own text.
  assert.equal(sub.tocItem, true);
  assert.equal(sub.text, '1.1 Deux');
});

test('headingLabel off keeps each level to its own number', () => {
  const toc = { ...defaultToc(), numbering: ['decimal', 'decimal', 'none', 'none', 'none', 'none'] } as Preset['toc'];
  assert.equal(headingLabel(toc, [2, 3, 0, 0, 0, 0], 1), '3. ');
  assert.equal(headingLabel({ ...toc, hierarchical: true }, [2, 3, 0, 0, 0, 0], 1), '2.3 ');
});

/* ------------------------------------------------------------------ */
/* Automatic page breaks                                               */
/* ------------------------------------------------------------------ */

const breaking = (levels: boolean[]): Preset => {
  const p = preset();
  p.toc.pageBreak = levels;
  return p;
};

test('no automatic page break by default', () => {
  const md = ['# Un', 'Texte.', '# Deux', 'Texte.'].join('\n\n');
  assert.ok(markdownToPdf(md, preset()).every((n) => !n.pageBreak));
});

test('a breaking level opens a new page before each of its headings but the first', () => {
  const p = breaking([true, false, false, false, false, false]);
  const md = ['# Un', 'Texte.', '## Sous', 'Texte.', '# Deux', 'Texte.'].join('\n\n');
  const breaks = headings(md, p).map((n) => n.pageBreak || null);
  // The first # follows the previous section's page break: no blank page.
  assert.deepEqual(breaks, [null, null, 'before']);
});

test('a heading right under another one stays on its page', () => {
  const p = breaking([true, true, false, false, false, false]);
  const md = ['# Un', '## A', 'Texte.', '## B', 'Texte.', '# Deux', '## C', 'Texte.'].join('\n\n');
  const breaks = headings(md, p).map((n) => n.pageBreak || null);
  // `# Deux` breaks and carries `## C` along; `## A` stays under `# Un`.
  assert.deepEqual(breaks, [null, null, 'before', 'before', null]);
});

test('a manual break and an automatic one do not add up to a blank page', () => {
  const p = breaking([true, false, false, false, false, false]);
  const md = ['# Un', 'Texte.', '\\pagebreak', '# Deux', 'Texte.'].join('\n\n');
  const out = markdownToPdf(md, p);
  assert.equal(out.filter((n) => n.pageBreak).length, 1);
});

test('a heading inside a callout or a column never breaks the page', () => {
  const p = breaking([false, true, false, false, false, false]);
  const md = ['Texte.', '', '> [!info] Note', '> ## Dedans', '> Texte.'].join('\n');
  const flat: PdfNode[] = [];
  const visit = (n: any): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    flat.push(n);
    for (const k of ['stack', 'columns', 'body']) if (Array.isArray(n[k])) visit(n[k]);
    if (n.table) visit(n.table.body);
  };
  visit(markdownToPdf(md, p));
  assert.ok(flat.every((n) => !n.pageBreak));
});

test('a preset saved before chained numbering keeps the old behaviour', () => {
  const old = defaultPreset({}) as any;
  delete old.toc.hierarchical;
  delete old.toc.pageBreak;
  const p = migratePreset(old);
  assert.equal(p.toc.hierarchical, false);
  assert.deepEqual(p.toc.pageBreak, [false, false, false, false, false, false]);
});

test('a garbled page-break list is filled in level by level', () => {
  const old = defaultPreset({}) as any;
  old.toc.pageBreak = [true, 'oui'];
  old.toc.hierarchical = 'oui';
  const p = migratePreset(old);
  assert.deepEqual(p.toc.pageBreak, [true, false, false, false, false, false]);
  assert.equal(p.toc.hierarchical, false);
});
