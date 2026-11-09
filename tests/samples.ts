/**
 * The notes, templates and options the reference tests and the Word
 * validation script render, chosen to take every path through both engines:
 * generated documents with every page, template artwork and a logo, the
 * bundled example notes, a Word template with markers in its body and header,
 * and the test bench of templates written by Word (templates/word).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocx, calloutIcons, type DocxOptions } from '../src/docx.ts';
import { buildDocDefinition, defaultPreset, type PdfNode } from '../src/generator.ts';
import { setLocale } from '../src/i18n.ts';
import { stripFrontmatter } from '../src/textScan.ts';
import type { Preset, ReportVars, WordRole } from '../src/types.ts';
import { makeTemplate } from './docxRead.ts';

// Fixed wording, whatever the machine's language.
setLocale('en');

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const note = (name: string) => stripFrontmatter(readFileSync(join(ROOT, name), 'utf8').replace(/\r\n/g, '\n'));

const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ccc"/></svg>';

const vars: ReportVars = {
  docTitle: 'Website Migration Review',
  client: 'ACME Corp',
  tlp: 'AMBER',
  coverTitle: 'Website Migration Review',
  coverSubtitle: 'Audit',
  coverSubtitle2: 'WMR',
  tocTitle: '',
  versions: [{ version: '1.0', date: '2026-10-01', etat: 'Draft' }, { version: '1.1', date: '2026-10-21', etat: 'Final' }],
  contacts: [{ nom: 'Jane Doe', poste: 'Lead', courriel: 'jane@example.com' }],
  recipients: [{ nom: 'John Roe', societe: 'ACME Corp', courriel: 'john@example.com' }],
  author: 'Jane Doe'
};

const MERMAID = 'graph TD; A --> B';
const DEMO = [
  '# Introduction',
  '',
  'Some **bold**, *italic*, ~~struck~~ and `inline code` text, with [a link](https://example.com/?a=1&b=2).<br>Second line.',
  '',
  '## Findings',
  '',
  '- first',
  '  1. nested one',
  '     - deeper',
  '- [ ] open task',
  '- [x] done task',
  '',
  '| Item | Cost |',
  '|---|---:|',
  '| Hosting<br>and backups | 12 € |',
  '',
  '```bash',
  'git clone https://example.org/repo.git && cd repo',
  '```',
  '',
  ...['note', 'warning', 'danger', 'tip', 'quote'].flatMap((c) => [`> [!${c}] A ${c}`, '> Callout body.', '']),
  '```mermaid',
  MERMAID,
  '```',
  '',
  '![a pixel](report-image:img0 "120")',
  '',
  '*Figure 1: a pixel*',
  '',
  '<!-- report-mark-start INTERNAL -->',
  '',
  'Kept for the team.',
  '',
  '<!-- report-mark-end -->',
  '',
  'Ships in May<span data-report-mark>, unless it slips</span>.',
  '',
  'A claim worth a source.[^src] Cited again[^src], and an inline note.^[With `code` and [a link](https://example.com).]',
  '',
  '[^src]: The source, with **bold** text',
  '    and a second line.',
  '',
  '| Item | Cost |',
  '|---|---:|',
  '| Hosting | 12 € |',
  '',
  'Table 1: yearly costs',
  '',
  '````col',
  'textAlign=center',
  '===',
  '```col-md',
  'flexGrow=2',
  'borderColor=#1F5F8B',
  'borderPadding=6px',
  '===',
  '**Left**, twice as wide, with a list:',
  '',
  '- one',
  '- two',
  '```',
  '```col-md',
  '> [!tip] Right',
  '> A callout in a column.',
  '```',
  '````',
  '',
  '> [!col]',
  '> First column of a callout group.',
  '>',
  '> Second column.',
  '',
  '\\pagebreak',
  '',
  '### Last <words> & "quotes"'
].join('\n');

const preset = (): Preset => defaultPreset({}, 'en');
const drawn = (p: Preset): DocxOptions => ({
  images: { img0: PIXEL_PNG },
  diagrams: { [MERMAID]: { png: PIXEL_PNG, svg: SVG, width: 200, height: 100 } },
  icons: Object.fromEntries(calloutIcons(p).map((i) => [i.key, { png: PIXEL_PNG, svg: SVG, width: 24, height: 24 }]))
});

const template = makeTemplate({
  body:
    '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>{{ti</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>tle</w:t></w:r><w:r><w:t>}}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>{{client}} · {{date}} · {{version}} · {{status}}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>{{toc}}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>{{content}}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>End of {{title}}.</w:t></w:r></w:p>',
  styles:
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>',
  header: '<w:p><w:r><w:t>{{tlp}} {{title}}</w:t></w:r></w:p>'
});

/** Each Word sample, by file name, as a function that builds it. */
export function wordSamples(): Record<string, () => Uint8Array> {
  const samples: Record<string, () => Uint8Array> = {
    'generated.docx': () => buildDocx(DEMO, vars, preset(), drawn(preset())).bytes,
    'generated-artwork.docx': () => {
      const p = preset();
      p.assets = { coverBg: PIXEL_PNG, frame: PIXEL_PNG, clientLogo: null };
      return buildDocx(DEMO, vars, p, { ...drawn(p), clientLogo: PIXEL_PNG }).bytes;
    },
    'example-report.docx': () => buildDocx(note('example-report.md'), vars, preset()).bytes,
    'example-confidential.docx': () => buildDocx(note('example-confidential.md'), vars, preset()).bytes,
    'template.docx': () => buildDocx(DEMO, vars, preset(), { ...drawn(preset()), template }).bytes
  };
  // The test bench: templates written by Word itself, each filled with the
  // demo note and with the bundled example.
  const BENCH: Record<string, Partial<Record<WordRole, string>>> = {
    'consulting-report': {},
    // Its body text is a style of its own, picked in the settings.
    memo: { body: 'Corps de rapport' },
    'landscape-brief': {}
  };
  for (const [name, styles] of Object.entries(BENCH)) {
    const bytes = readFileSync(join(ROOT, 'templates', 'word', `${name}.dotx`));
    const p = (): Preset => ({ ...preset(), word: { template: `${name}.dotx`, styles } });
    samples[`bench-${name}.docx`] = () => buildDocx(DEMO, vars, p(), { ...drawn(p()), template: bytes }).bytes;
    samples[`bench-${name}-example.docx`] = () => buildDocx(note('example-report.md'), vars, p(), { template: bytes }).bytes;
  }
  return samples;
}

/** A preset changed by `change`, for the PDF variants. */
function presetWith(change: (p: Preset) => void): Preset {
  const p = preset();
  change(p);
  return p;
}

/** Each PDF sample, by name, as a function that builds its pdfmake document definition. */
export function pdfSamples(): Record<string, () => PdfNode> {
  const diagrams = { [MERMAID]: { svg: SVG, width: 200, height: 100 } };
  const demo = (p: Preset, v: ReportVars = vars) => () => buildDocDefinition(DEMO, v, p, { images: { img0: PIXEL_PNG }, diagrams });
  return {
    'example-report': () => buildDocDefinition(note('example-report.md'), vars, preset()),
    'example-confidential': () => buildDocDefinition(note('example-confidential.md'), vars, preset()),
    demo: demo(preset()),
    'demo-no-cover': demo(presetWith((p) => { p.sections = p.sections.filter((s) => s !== 'cover'); })),
    'demo-no-decoration-no-tlp': demo(presetWith((p) => { p.layout.decor = false; }), { ...vars, tlp: null }),
    'demo-body-only': demo(preset(), { ...vars, sections: ['body'] }),
    'demo-margins-left-aligned': demo(presetWith((p) => { p.layout.pageMargins = [40, 80, 50, 70]; p.justify = false; })),
    'artwork-and-logo': () => {
      const p = presetWith((q) => { q.assets = { coverBg: PIXEL_PNG, frame: PIXEL_PNG, clientLogo: null }; });
      return buildDocDefinition(DEMO, vars, p, { images: { img0: PIXEL_PNG }, diagrams, clientLogo: PIXEL_PNG });
    },
    'empty-note': () => buildDocDefinition('', vars, preset())
  };
}
