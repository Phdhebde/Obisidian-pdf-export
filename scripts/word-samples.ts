/**
 * Writes sample Word documents covering every part of the Word export, for
 * the Open XML validator to check in CI (tools/ooxml-validate):
 *
 *   node scripts/word-samples.ts <output folder>
 *
 * Each sample takes a different path through docx.ts: the generated document
 * with every page, template artwork and a logo, the bundled example notes,
 * and a Word template with markers in its body and header.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocx, calloutIcons, type DocxOptions } from '../src/docx.ts';
import { defaultPreset } from '../src/generator.ts';
import { setLocale } from '../src/i18n.ts';
import { stripFrontmatter } from '../src/textScan.ts';
import type { Preset, ReportVars } from '../src/types.ts';
import { makeTemplate } from '../tests/docxRead.ts';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/word-samples.ts <output folder>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
setLocale('en');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const note = (name: string) => stripFrontmatter(readFileSync(join(root, name), 'utf8').replace(/\r\n/g, '\n'));

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

for (const [name, build] of Object.entries(samples)) {
  writeFileSync(join(out, name), build());
  console.log(join(out, name));
}
