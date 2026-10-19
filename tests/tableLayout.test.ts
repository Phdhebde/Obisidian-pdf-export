import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defaultPreset } from '../src/generator.ts';
import { buildDocDefinition, markdownToPdf, type PdfNode } from './loose.ts';
import { fitTable, MIN_TABLE_FONT_SIZE, type TableCell } from '../src/tableLayout.ts';
import { textWidth } from '../src/textWidth.ts';

const require_ = createRequire(import.meta.url);
const PdfPrinter = require_('pdfmake/src/printer.js');
const LayoutBuilder = require_('pdfmake/src/layoutBuilder.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = (name: string) => join(root, 'fonts', name);
const FONTS = {
  Liberation: {
    normal: font('LiberationSans-Regular.ttf'), bold: font('LiberationSans-Bold.ttf'),
    italics: font('LiberationSans-Italic.ttf'), bolditalics: font('LiberationSans-BoldItalic.ttf')
  },
  Archivo: {
    normal: font('ArchivoBlack-Regular.ttf'), bold: font('ArchivoBlack-Regular.ttf'),
    italics: font('ArchivoBlack-Regular.ttf'), bolditalics: font('ArchivoBlack-Regular.ttf')
  },
  LiberationMono: {
    normal: font('LiberationMono-Regular.ttf'), bold: font('LiberationMono-Bold.ttf'),
    italics: font('LiberationMono-Regular.ttf'), bolditalics: font('LiberationMono-Bold.ttf')
  }
};

const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const URL_ = 'https://exemple.acme-corp.fr/chemin/tres/long/vers/une/ressource/compromise.php?id=123456';

const row = (...cells: string[]) => '| ' + cells.join(' | ') + ' |';
const table = (header: string[], ...rows: string[][]) =>
  [row(...header), row(...header.map(() => '---')), ...rows.map((r) => row(...r))].join('\n');
const wide = (n: number, word: string) =>
  table(Array.from({ length: n }, (_, i) => 'Col' + i), Array.from({ length: n }, () => word));

const IOC = table(['Fichier', 'SHA256', 'URL', 'Note'], ['a.exe', HASH, URL_, "Détecté par l'EDR"]);

function tableOf(md: string): PdfNode {
  const t = markdownToPdf(md, defaultPreset({})).find((n) => n.table);
  assert.ok(t, 'un tableau attendu');
  return t;
}

const brokenWords = (t: PdfNode): string[] =>
  t.table.body.flat().flatMap((c: PdfNode) => c.text.filter((r: PdfNode) => r.wordBreak).map((r: PdfNode) => r.text));

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

test('widths come from the bundled fonts, Arial-compatible', () => {
  // Liberation Sans is metric-compatible with Arial: a 556, W 944, i 222.
  assert.equal(textWidth('a', 'Liberation', 1000), 556);
  assert.equal(textWidth('W', 'Liberation', 1000), 944);
  assert.equal(textWidth('i', 'Liberation', 1000), 222);
  assert.equal(textWidth('é', 'Liberation', 1000), 556);
  assert.equal(textWidth('m', 'Liberation', 1000, true), 889);
  // Liberation Mono is fixed-pitch at 0.6em.
  assert.equal(textWidth(HASH, 'LiberationMono', 10), 64 * 6);
  // Archivo Black is wider than Liberation, which is why it has its own table.
  assert.ok(textWidth('Rapport', 'Archivo', 10) > textWidth('Rapport', 'Liberation', 10, true));
});

/* ------------------------------------------------------------------ */
/* Column widths                                                       */
/* ------------------------------------------------------------------ */

test('a table that fits as equal columns is left as it was', () => {
  const t = tableOf(table(['Nom', 'Rôle', 'Courriel'], ['Jean Dupont', 'Analyste', 'jean.dupont@example.com']));
  assert.deepEqual(t.table.widths, ['*', '*', '*']);
  assert.deepEqual(brokenWords(t), []);
});

test('a hash gets the room the short columns do not need, unbroken if it fits', () => {
  const t = tableOf(table(['Fichier', 'SHA256'], ['a.exe', HASH]));
  const [name, hash] = t.table.widths;
  assert.ok(hash > 3 * name, `colonne du hash ${hash} contre ${name}`);
  assert.deepEqual(brokenWords(t), []);
});

test('only the identifiers are broken, and the font keeps its size', () => {
  const t = tableOf(IOC);
  assert.deepEqual(brokenWords(t).sort(), [HASH, URL_].sort());
  // Shrinking would not have saved the hash: no reason to make the rest smaller.
  assert.equal(t.table.body[1][0].fontSize, undefined);
});

test('the widths never add up to more than the page', () => {
  const p = defaultPreset({});
  const room = 595.28 - p.layout.pageMargins[0] - p.layout.pageMargins[2];
  for (const md of [IOC, wide(9, 'Administrateur'), wide(15, 'Vulnérabilité')]) {
    const t = tableOf(md);
    const n = t.table.widths.length;
    const total = t.table.widths.reduce((a: number, b: number) => a + b, 0) + n * 10 + (n + 1) * 0.75;
    assert.ok(total <= room + 0.01, `${total} > ${room}`);
  }
});

test('many columns of ordinary words get a smaller font first', () => {
  const t = tableOf(wide(7, 'Administrateur'));
  const size = t.table.body[1][0].fontSize;
  assert.ok(size < 10 && size >= MIN_TABLE_FONT_SIZE, `taille ${size}`);
  assert.deepEqual(brokenWords(t), [], 'la police réduite suffit, aucun mot coupé');
});

test('the font never goes below the floor', () => {
  const t = tableOf(wide(15, 'Vulnérabilité'));
  assert.equal(t.table.body[1][0].fontSize, MIN_TABLE_FONT_SIZE);
});

test('breaking a word inserts no character', () => {
  const t = tableOf(IOC);
  const cell = t.table.body[1][1];
  assert.equal(cell.text.map((r: PdfNode) => r.text).join(''), HASH);
});

test('a broken link stays a link', () => {
  const t = tableOf(table(['F', 'URL'], ['a', `[${URL_}](${URL_})`]));
  const runs = t.table.body[1][1].text;
  assert.ok(runs.length > 0 && runs.every((r: PdfNode) => r.link === URL_));
});

test('a table inside a callout is fitted to the callout, not the page', () => {
  const md = ['> [!info] Note', ...table(['Fichier', 'SHA256'], ['a.exe', HASH]).split('\n').map((l) => '> ' + l)].join('\n');
  const flat: PdfNode[] = [];
  const visit = (n: any): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    flat.push(n);
    for (const k of ['stack', 'columns']) if (Array.isArray(n[k])) visit(n[k]);
    if (n.table) visit(n.table.body);
  };
  visit(markdownToPdf(md, defaultPreset({})));
  const inner = flat.find((n) => n.table && n.table.headerRows === 1);
  assert.ok(inner, 'le tableau du callout');
  const page = tableOf(table(['Fichier', 'SHA256'], ['a.exe', HASH]));
  const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);
  assert.ok(sum(inner.table.widths) < sum(page.table.widths));
});

test('fitTable keeps a one-letter column wide enough for its letter', () => {
  const cell = (text: string, bold = false): TableCell => ({ runs: [{ text }], bold });
  const fit = fitTable(
    [[cell('F', true), cell('H', true), cell('U', true)], [cell('b'), cell(HASH), cell(URL_)]],
    { width: 300, font: 'Liberation', fontSize: 10, padding: 10, rule: 0.75 }
  );
  assert.ok(fit);
  assert.ok(fit.widths[0] >= textWidth('F', 'Liberation', 10, true));
});

/* ------------------------------------------------------------------ */
/* What pdfmake actually lays out                                      */
/* ------------------------------------------------------------------ */

/** How far any body text runs past the right margin, and past its own cell. */
function overflow(md: string): { page: number; cell: number } {
  let pages: any[] = [];
  const orig = LayoutBuilder.prototype.layoutDocument;
  LayoutBuilder.prototype.layoutDocument = function (...a: unknown[]) {
    pages = orig.apply(this, a);
    return pages;
  };
  try {
    const p = defaultPreset({});
    p.sections = ['body'];
    const dd = buildDocDefinition(md, { docTitle: 'Tableaux', tlp: 'GREEN' }, p);
    new PdfPrinter(FONTS).createPdfKitDocument(dd);
    const [, top, right, bottom] = dd.pageMargins;
    let page = 0;
    let cell = 0;
    for (const pg of pages) for (const it of pg.items) {
      if (it.type !== 'line') continue;
      // Header and footer are laid out in their own bands; only the body counts.
      if (it.item.y < top || it.item.y > 841.89 - bottom) continue;
      for (const inl of it.item.inlines) {
        // The space a line ends on is not drawn: pdfmake cuts it off.
        const end = inl.x + inl.width - (inl.trailingCut || 0);
        page = Math.max(page, it.item.x + end - (595.28 - right));
        cell = Math.max(cell, end - it.item.maxWidth);
      }
    }
    return { page, cell };
  } finally {
    LayoutBuilder.prototype.layoutDocument = orig;
  }
}

test('pdfmake keeps every table inside the page and every word inside its cell', () => {
  const cases: Record<string, string> = {
    ioc: IOC,
    'code et lien': table(['F', 'H', 'U'], ['b', '`' + HASH + '`', `[lien ${URL_}](${URL_})`]),
    'neuf colonnes': wide(9, 'Administrateur'),
    'quinze colonnes': wide(15, 'Vulnérabilité'),
    callout: ['> [!info] Note', ...IOC.split('\n').map((l) => '> ' + l)].join('\n')
  };
  for (const [name, md] of Object.entries(cases)) {
    const o = overflow(md);
    assert.ok(o.page <= 0.01, `${name} : ${o.page.toFixed(1)} pt hors de la page`);
    assert.ok(o.cell <= 0.01, `${name} : ${o.cell.toFixed(1)} pt hors de la cellule`);
  }
});
