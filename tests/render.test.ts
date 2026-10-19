/*
 * End-to-end: render a real report through pdfmake's Node printer.
 *
 * The unit tests check the document definition; this one checks that pdfmake
 * actually accepts it — font references, layout callbacks, the TOC, page
 * breaks and image nodes all fail here rather than in Obsidian.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { paginationPresets, defaultPreset } from '../src/generator.ts';
import { buildDocDefinition } from './loose.ts';
import { stripFrontmatter } from '../src/textScan.ts';
import { redact } from '../src/redact.ts';
import { cssValue } from '../src/svgPaint.ts';
import { loadCmap, missingChars } from './fontCoverage.ts';
import type { Preset } from '../src/types.ts';

const require_ = createRequire(import.meta.url);
const PdfPrinter = require_('pdfmake/src/printer.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = (name: string) => join(root, 'fonts', name);

const FONTS = {
  Liberation: {
    normal: font('LiberationSans-Regular.ttf'),
    bold: font('LiberationSans-Bold.ttf'),
    italics: font('LiberationSans-Italic.ttf'),
    bolditalics: font('LiberationSans-BoldItalic.ttf')
  },
  Archivo: {
    normal: font('ArchivoBlack-Regular.ttf'),
    bold: font('ArchivoBlack-Regular.ttf'),
    italics: font('ArchivoBlack-Regular.ttf'),
    bolditalics: font('ArchivoBlack-Regular.ttf')
  },
  LiberationMono: {
    normal: font('LiberationMono-Regular.ttf'),
    bold: font('LiberationMono-Bold.ttf'),
    italics: font('LiberationMono-Regular.ttf'),
    bolditalics: font('LiberationMono-Bold.ttf')
  }
};

/** Render to a buffer, resolving only once pdfmake has finished the document. */
function render(dd: unknown): Promise<Buffer> {
  const printer = new PdfPrinter(FONTS);
  const doc = printer.createPdfKitDocument(dd);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function countPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
}

/** A 1x1 PNG, to exercise the image path without shipping a fixture. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const preset = (over: Partial<Preset> = {}): Preset => Object.assign(defaultPreset({}), over);

test('the bundled example note renders to a multi-page PDF', async () => {
  const md = stripFrontmatter(readFileSync(join(root, 'example-report.md'), 'utf8'));
  const dd = buildDocDefinition(
    md,
    {
      docTitle: 'Website Migration Review',
      client: 'ACME Corp',
      tlp: null,
      coverTitle: 'Website Migration Review',
      coverSubtitle: 'Infrastructure team',
      coverSubtitle2: 'INFRA',
      tocTitle: '',
      author: 'Jane Doe',
      versions: [{ version: '1.0', date: '2026-06-08', etat: 'Document created' }],
      contacts: [{ nom: 'Jane Doe', poste: 'Project lead', courriel: 'jane.doe@example.com' }]
    },
    preset()
  );

  const pdf = await render(dd);
  assert.ok(pdf.length > 5000, 'expected a non-trivial PDF');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // Cover + references + TOC + body, and the note has a manual page break.
  assert.ok(countPages(pdf) >= 5, `expected at least 5 pages, got ${countPages(pdf)}`);
});

/**
 * The shape src/mermaid.ts hands over: Mermaid's markup with its stylesheet
 * resolved into `style=""`, px units stripped, an arrowhead marker, and labels
 * in a family pdfmake does not know (it must fall back to the body font).
 */
const MERMAID_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" id="m" width="120" height="180" viewBox="0 0 120 180">',
  '<defs><marker id="m_arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto">',
  '<path d="M 0 0 L 10 5 L 0 10 z" style="fill:rgb(51, 51, 51);stroke-width:1"/></marker></defs>',
  '<g class="node" transform="translate(60, 30)">',
  '<rect x="-50" y="-20" width="100" height="40" style="fill:rgb(236, 236, 255);stroke:rgb(147, 112, 219);stroke-width:1"/>',
  '<text style="fill:rgb(51, 51, 51);font-size:16;font-weight:700;text-anchor:middle;dominant-baseline:central">',
  '<tspan x="0" dy="0">Début é</tspan></text></g>',
  '<path d="M 60 50 L 60 125" marker-end="url(#m_arrow)" style="fill:none;stroke:rgb(51, 51, 51);stroke-width:2;stroke-dasharray:3, 3"/>',
  '<g class="node" transform="translate(60, 150)">',
  '<rect x="-50" y="-20" width="100" height="40" style="fill:rgba(236, 236, 255, 0.5);stroke:rgb(147, 112, 219)"/>',
  '<text style="fill:rgb(51, 51, 51);font-size:16;text-anchor:middle;dominant-baseline:central">Fin</text></g>',
  '</svg>'
].join('');

test('a Mermaid diagram is drawn as vectors, labels as real text', async () => {
  const source = 'graph TD\n  A[Début é] -.-> B[Fin]';
  const build = (md: string) => ({
    ...buildDocDefinition(md, { docTitle: 'Schéma', tlp: 'GREEN' }, preset({ sections: ['body'] }), {
      diagrams: { [source]: { svg: MERMAID_SVG, width: 120, height: 180 } }
    }),
    compress: false
  });

  // svg-to-pdfkit reports what it cannot draw through console.warn.
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.join(' ')); };
  let pdf: string;
  let baseline: string;
  try {
    pdf = (await render(build('```mermaid\n' + source + '\n```'))).toString('latin1');
    baseline = (await render(build('Texte.'))).toString('latin1');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warned, []);
  assert.doesNotMatch(pdf, /\/Subtype\s*\/Image/, 'no raster image in the PDF');
  assert.match(pdf, /\[3 3\] 0 d/, 'the dashed edge keeps its dash pattern');
  // Both labels drawn as text (svg-to-pdfkit may open several blocks per
  // label), where the baseline page has a single paragraph.
  const textBlocks = (s: string) => (s.match(/\bBT\b/g) || []).length;
  assert.ok(textBlocks(pdf) - (textBlocks(baseline) - 1) >= 2, 'labels are text, not dropped');
});

test('every dash pattern the sanitiser emits is one pdfkit accepts', async () => {
  // The export failed with "dash([1,0]) invalid" on a real Mermaid diagram.
  const edge = (dash: string, y: number) =>
    `<path d="M 0 ${y} L 100 ${y}" style="fill:none;stroke:rgb(0, 0, 0);stroke-width:2;stroke-dasharray:${cssValue('stroke-dasharray', dash)}"/>`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60">' +
    [edge('1px, 0px', 10), edge('0px, 4px', 20), edge('0', 30), edge('5 3 2', 40), edge('3px, 3px', 50)].join('') +
    '</svg>';
  const source = 'graph LR\n  A --- B';
  const dd = buildDocDefinition('```mermaid\n' + source + '\n```', { docTitle: 'Tirets', tlp: 'GREEN' },
    preset({ sections: ['body'] }), { diagrams: { [source]: { svg, width: 100, height: 60 } } });
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('a report renders with the cover section disabled', async () => {
  const md = '# Section\n\nDu texte.\n';
  const dd = buildDocDefinition(md, { docTitle: 'Sans couverture', tlp: 'GREEN' }, preset({ sections: ['toc', 'body'] }));
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('callouts, task lists, tables, code and images all render', async () => {
  const md = [
    '# Démonstration',
    '',
    '> [!warning] Attention',
    '> Un callout Obsidian.',
    '',
    '- [ ] tâche ouverte',
    '- [x] tâche faite',
    '',
    '| Colonne | Valeur |',
    '|---|---|',
    '| a | 1 |',
    '',
    '```bash',
    'echo "![[piege.png]] ne doit pas être remplacé"',
    '```',
    '',
    '![légende](report-image:pixel "120")',
    '',
    '*Figure 1 : un pixel*',
    '',
    '\\pagebreak',
    '',
    '# Recommandations',
    '',
    '- première recommandation',
    '- seconde recommandation'
  ].join('\n');

  const dd = buildDocDefinition(md, { docTitle: 'Démo', tlp: 'AMBER' }, preset(), {
    images: { pixel: PIXEL_PNG }
  });
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(countPages(pdf) >= 2, 'the manual page break should add a page');
});

test('the Obsidian Columns example from the plugin README renders', async () => {
  const tick = (n: number) => '`'.repeat(n);
  // Verbatim from https://github.com/tnichols217/obsidian-columns, which is
  // the worst case: seven levels of fences, a callout inside a column, a
  // column group inside a column, and a js block inside that.
  const md = [
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
    '    } else {',
    '        console.log("a");',
    '    }',
    '}',
    'let msg = "Hello, world!";',
    'console.log(msg)',
    tick(3),
    tick(4),
    tick(5),
    tick(6),
    tick(7)
  ].join('\n');

  const dd = buildDocDefinition(md, { docTitle: 'Colonnes', tlp: 'GREEN' }, preset({ sections: ['body'] }));
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('columns render with borders, rows, images and the callout syntax', async () => {
  const tick = (n: number) => '`'.repeat(n);
  const md = [
    tick(4) + 'col',
    'textAlign=center',
    '===',
    tick(3) + 'col-md',
    'borderColor=#E97132',
    'borderStyle=dashed',
    'borderWidth=2px',
    'borderPadding=8',
    '===',
    '## Avec cadre',
    '',
    '![pixel](report-image:pixel "80")',
    tick(3),
    '',
    tick(3) + 'col-md',
    'flexGrow=2',
    'textAlign=left',
    '===',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    tick(3),
    '===',
    'Une seconde rangée, sur toute la largeur.',
    tick(4),
    '',
    '> [!col]',
    '> Colonne de gauche',
    '>',
    '>> [!col-md-2]',
    '>> Colonne de droite, deux fois plus large.'
  ].join('\n');

  const dd = buildDocDefinition(md, { docTitle: 'Colonnes', tlp: 'GREEN' }, preset({ sections: ['body'] }), {
    images: { pixel: PIXEL_PNG }
  });
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('a cover with a client logo and a larger body size renders', async () => {
  const p = preset({ sections: ['cover', 'toc', 'body'] });
  p.fonts.bodySize = 14;
  p.assets.clientLogo = PIXEL_PNG;
  p.layout.cover.logoX = 380;
  p.layout.cover.logoY = 90;
  p.layout.cover.logoW = 120;
  p.layout.cover.titleY = 240;

  const md = ['# Section', '', 'Du texte.', '', '| a | b |', '|---|---|', '| 1 | 2 |'].join('\n');
  const dd = buildDocDefinition(
    md,
    { docTitle: 'Avec logo', client: 'ACME', tlp: 'GREEN', coverTitle: 'Avec logo', coverSubtitle: 'CERT' },
    p
  );

  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('a six-level table of contents with roman numbering renders', async () => {
  const p = preset({ sections: ['toc', 'body'] });
  p.toc.levels = [true, true, true, true, true, true];
  p.toc.numbering = ['upperRoman', 'decimal', 'lowerRoman', 'upperAlpha', 'lowerAlpha', 'decimal'];

  const md = [
    '# Premier', 'Texte.',
    '## Deuxième', 'Texte.',
    '### Troisième', 'Texte.',
    '#### Quatrième', 'Texte.',
    '##### Cinquième', 'Texte.',
    '###### Sixième', 'Texte.',
    '# Second premier', 'Texte.'
  ].join('\n\n');

  const dd = buildDocDefinition(md, { docTitle: 'Sommaire', tlp: 'GREEN' }, p);
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // The table of contents is a page of its own plus the body.
  assert.ok(countPages(pdf) >= 2, `attendu au moins 2 pages, obtenu ${countPages(pdf)}`);
});

/* ------------------------------------------------------------------ */
/* Glyph coverage                                                      */
/* ------------------------------------------------------------------ */

/** Every string the generator puts in a document definition. */
function allText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => allText(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    // Skip identifiers and colours: they are never drawn as glyphs.
    if (['style', 'font', 'id', 'image', 'link', 'linkToDestination', 'type'].includes(key)) continue;
    if (key.endsWith('Color') || key === 'color' || key === 'background') continue;
    allText(value, out);
  }
  return out;
}

test('every character the generator emits exists in Liberation Sans', () => {
  const hasGlyph = loadCmap(join(root, 'fonts', 'LiberationSans-Regular.ttf'));

  // Exercise the paths that emit characters of our own choosing, rather than
  // the user's: checkboxes, callout labels, TLP wording, fixed section titles.
  const md = [
    '# Recommandations',
    '## Niveau deux',
    '### Niveau trois',
    '#### Niveau quatre',
    '- [ ] tâche ouverte',
    '- [x] tâche faite',
    '',
    '> [!danger]',
    '> corps',
    '',
    '> [!question]',
    '> corps',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |'
  ].join('\n');

  const dd = buildDocDefinition(md, { docTitle: 'T', client: 'C', tlp: 'AMBER+STRICT' }, preset());
  let text = allText(dd.content).join('\n') + '\n' + allText(dd.footer(2, 3)).join('\n');

  // Every ready-made pagination format too: one of them uses an en dash, and a
  // .notdef box in the footer of every page is exactly what this test is for.
  for (const { template } of paginationPresets()) {
    const p = preset();
    p.layout.pagination = template;
    const paged = buildDocDefinition(md, { docTitle: 'T', client: 'C', tlp: 'GREEN' }, p);
    text += '\n' + allText(paged.footer(2, 3)).join('\n');
  }

  const missing = missingChars(text, hasGlyph);
  assert.deepEqual(missing, [], `glyphes absents de la police : ${missing.join(', ')}`);
});

test('callout icons survive the real pdfmake SVG renderer', async () => {
  const md = [
    '> [!warning] Attention',
    '> Un avertissement.',
    '',
    '> [!info] Information',
    '> Un renseignement.',
    '',
    '> [!danger] Danger',
    '> Un risque.'
  ].join('\n');

  const dd = buildDocDefinition(md, { docTitle: 'Icônes', tlp: 'GREEN' }, preset({ sections: ['body'] }));
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // svg-to-pdfkit turns each icon into path operators, so a document with three
  // icons is meaningfully larger than the same one without them.
  const without = await render(
    buildDocDefinition(md, { docTitle: 'Icônes', tlp: 'GREEN' }, preset({ sections: ['body'], calloutIcons: false }))
  );
  assert.ok(pdf.length > without.length, 'expected the icons to add drawing operators');
});

test('automatic page breaks give each top-level part its own page', async () => {
  const p = preset({ sections: ['toc', 'body'] });
  p.toc.hierarchical = true;
  p.toc.numbering = ['decimal', 'decimal', 'upperAlpha', 'none', 'none', 'none'];
  p.toc.pageBreak = [true, false, false, false, false, false];

  const md = [
    '# Premier', '## Sous', 'Texte.',
    '# Second', '### Saut', 'Texte.',
    '# Troisième', 'Texte.'
  ].join('\n\n');

  const dd = buildDocDefinition(md, { docTitle: 'Sauts', tlp: 'GREEN' }, p);
  const pdf = await render(dd);
  // One TOC page, then one page per `#` — none blank in between.
  assert.equal(countPages(pdf), 4);
});

test('a full version with restricted passages labelled and highlighted renders', async () => {
  const md = redact(
    [
      '# Offer',
      '',
      'Ships in May<span data-audience="internal"> unless the budget slips</span>.',
      '',
      '## Pricing %%internal%%',
      '',
      'Margin: 18 %.',
      '',
      '### Sources %%tlp:red%%',
      '',
      '- a contact',
      '',
      '## Scope',
      '',
      'Three phases.'
    ].join('\n'),
    { levels: ['internal'], keep: null, tlp: 'CLEAR', placeholder: '', mark: true }
  );
  const dd = buildDocDefinition(md, { docTitle: 'Offer', tlp: 'AMBER' }, preset({ sections: ['toc', 'body'] }));
  const pdf = await render(dd);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
