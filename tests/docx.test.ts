import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { buildDocx, calloutIcons, listWordStyles, WordTemplateError } from '../src/docx.ts';
import { defaultPreset } from '../src/generator.ts';
import { fillMarkers, paragraphText, withRunProps } from '../src/ooxml.ts';
import { stripFrontmatter } from '../src/textScan.ts';
import { setLocale } from '../src/i18n.ts';
import type { Preset, ReportVars } from '../src/types.ts';
import { assertPackageWellFormed, makeTemplate, parts } from './docxRead.ts';

setLocale('en');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const preset = (over: Partial<Preset> = {}): Preset => Object.assign(defaultPreset({}, 'en'), over);

const vars: ReportVars = {
  docTitle: 'Website Migration Review',
  client: 'ACME Corp',
  tlp: 'AMBER',
  coverTitle: 'Website Migration Review',
  coverSubtitle: 'Audit',
  coverSubtitle2: '',
  tocTitle: '',
  versions: [{ version: '1.0', date: '2026-10-01', etat: 'Draft' }, { version: '1.1', date: '2026-10-21', etat: 'Final' }],
  contacts: [],
  recipients: [],
  author: 'Jane Doe'
};

/** A 1x1 PNG, to exercise the image path without shipping a fixture. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const DEMO = [
  '# Introduction',
  '',
  'Some **bold**, *italic*, ~~struck~~ and `inline code` text, with [a link](https://example.com/?a=1&b=2).',
  '',
  '## Findings',
  '',
  '- first',
  '- second',
  '  1. nested one',
  '  2. nested two',
  '',
  '1. step',
  '2. step',
  '',
  '- [ ] open task',
  '- [x] done task',
  '',
  '| Item | Cost |',
  '|---|---:|',
  '| Hosting | 12 € |',
  '',
  '```bash',
  'git clone https://example.org/repo.git && cd repo',
  '    indented\twith tab',
  '```',
  '',
  '> [!warning] Mind the gap',
  '> Callout body.',
  '',
  '![a pixel](report-image:img0 "120")',
  '',
  '*Figure 1: a pixel*',
  '',
  '---',
  '',
  '\\pagebreak',
  '',
  '### Last <words> & "quotes"'
].join('\n');

test('a generated document is a well-formed package with every part wired', () => {
  const { bytes, warnings } = buildDocx(DEMO, vars, preset(), { images: { img0: PIXEL_PNG } });
  assertPackageWellFormed(bytes);
  const p = parts(bytes);
  assert.deepEqual(warnings, []);

  const ct = p['[Content_Types].xml'];
  assert.match(ct, /PartName="\/word\/document\.xml" ContentType="[^"]*document\.main\+xml"/);
  assert.match(ct, /PartName="\/word\/numbering\.xml"/);
  assert.match(ct, /Extension="png"/);

  const rels = p['word/_rels/document.xml.rels'];
  assert.match(rels, /Target="https:\/\/example\.com\/\?a=1&amp;b=2" TargetMode="External"/);
  assert.match(rels, /Target="media\/report-image1\.png"/);
  assert.match(rels, /Target="numbering\.xml"/);

  const doc = p['word/document.xml'];
  // No marker survives, and none of the Markdown syntax either.
  assert.ok(!doc.includes('{{'), 'marker left');
  assert.ok(!/\*\*|~~|\[!warning\]/.test(doc));
  // Headings carry the PDF template's numbering as text.
  // Each is bookmarked, for the table of contents to link to.
  assert.match(doc, /<w:pStyle w:val="Heading1"\/>(?:<w:pageBreakBefore\/>)?<\/w:pPr><w:bookmarkStart w:id="(\d+)" w:name="_TocReport\1"\/><w:r><w:t xml:space="preserve">Introduction<\/w:t><\/w:r><w:bookmarkEnd w:id="\1"\/>/);
  assert.match(doc, /<w:pStyle w:val="Heading2"\/><\/w:pPr><w:bookmarkStart [^>]*\/><w:r><w:t xml:space="preserve">A\. {2}<\/w:t><\/w:r><w:r><w:t xml:space="preserve">Findings/);
  // Escaped, and an unknown inline tag printed as written, as in the PDF.
  assert.match(doc, /Last <\/w:t><\/w:r><w:r><w:t xml:space="preserve">&lt;words&gt;<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> &amp; &quot;quotes&quot;/);
  // Lists: Word numbering, two instances; tasks get boxes instead.
  assert.match(doc, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
  assert.match(doc, /☐ [\s\S]*open task/);
  assert.match(doc, /☑ [\s\S]*done task/);
  // Tables repeat their header row.
  assert.match(doc, /<w:tblHeader\/>/);
  assert.match(doc, /<w:jc w:val="right"\/><\/w:pPr><w:r><w:t xml:space="preserve">12 €/);
  // Code keeps its spaces and tabs, in the code style, aligned left by the style.
  assert.match(doc, /<w:pStyle w:val="HTMLPreformatted"\/>/);
  assert.match(doc, /<w:br\/><w:t xml:space="preserve"> {4}indented<\/w:t><w:tab\/><w:t xml:space="preserve">with tab/);
  // Links, the callout title, the image, the caption, the rule, the break.
  assert.match(doc, /<w:hyperlink r:id="rIdReport\d+" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/>/);
  // A callout is a tinted box with a bar of its colour, its title in that colour.
  assert.match(doc, /<w:left w:val="single" w:sz="24" w:space="0" w:color="F09B00"\/>[\s\S]*?<w:shd w:val="clear" w:color="auto" w:fill="FEF5E6"\/><\/w:tcPr><w:p><w:pPr><w:keepNext\/>[\s\S]*?<w:color w:val="F09B00"\/>[\s\S]*?Mind the gap/);
  assert.match(doc, /<wp:extent cx="1143000" cy="1143000"\/>/);
  assert.match(doc, /<w:pStyle w:val="Caption"\/>/);
  assert.match(doc, /<w:br w:type="page"\/>/);

  const styles = p['word/styles.xml'];
  assert.match(styles, /w:styleId="HTMLPreformatted"[\s\S]*?<w:jc w:val="left"\/>/);
  assert.match(styles, /<w:style w:type="paragraph" w:default="1" w:styleId="Normal">/);
  assert.match(styles, /<w:style w:type="table" w:styleId="TableGrid">/);

  // The cover title, upper case as in the PDF, then the pages in the template's order.
  assert.match(doc, /<w:pStyle w:val="Title"\/><w:spacing w:before="\d+" w:after="0" w:line="\d+" w:lineRule="exact"\/><w:ind w:left="720"\/><\/w:pPr><w:r><w:rPr><w:sz w:val="72"\/><w:szCs w:val="72"\/><\/w:rPr><w:t xml:space="preserve">WEBSITE<\/w:t><w:br\/>/);
  assert.match(doc, /<w:pStyle w:val="ReportSectionTitle"\/><w:pageBreakBefore\/><\/w:pPr><w:r><w:t xml:space="preserve">Document references/);
  assert.match(doc, /<w:t xml:space="preserve">1\.1<\/w:t>[\s\S]*?2026-10-21[\s\S]*?Final/);
  assert.ok(doc.indexOf('Document references') < doc.indexOf('Table of contents'));
  assert.ok(doc.indexOf('Table of contents') < doc.indexOf('Introduction</w:t>'));
  // Headers and footers: the frame on every page, the cover's own on the first.
  assert.match(doc, /<w:sectPr><w:headerReference w:type="default" r:id="rIdReport\d+"\/><w:footerReference w:type="default" r:id="rIdReport\d+"\/><w:headerReference w:type="first"[^>]*\/><w:footerReference w:type="first"[^>]*\/><w:pgSz w:w="11906" w:h="16838"\/><w:pgMar w:top="2000" w:right="1280" w:bottom="1640" w:left="1280" w:header="300" w:footer="\d+" w:gutter="0"\/><w:titlePg\/><\/w:sectPr>/);
  assert.match(p['word/footer1.xml'], /<w:b\/><w:bCs\/><w:color w:val="FFC000"\/><w:sz w:val="22"\/><w:szCs w:val="22"\/><\/w:rPr><w:t xml:space="preserve">TLP:AMBER/);
  assert.match(p['word/footer1.xml'], /<w:instrText xml:space="preserve"> PAGE <\/w:instrText>[\s\S]*<w:instrText xml:space="preserve"> NUMPAGES <\/w:instrText>/);
  // The bands are pictures placed on the page behind the text, in the template's colours.
  const header = p['word/header1.xml'];
  assert.match(header, /<wp:anchor [^>]*behindDoc="1"[\s\S]*?<wp:positionH relativeFrom="page"><wp:posOffset>0<\/wp:posOffset>[\s\S]*?<wp:extent cx="7560056" cy="812800"\/>/);
  assert.match(header, /<w:jc w:val="right"\/>[\s\S]*Website Migration Review[\s\S]*ACME Corp/);
  assert.match(p['word/_rels/header1.xml.rels'], /Target="media\/report-image\d+\.png"/);
  assert.match(p['word/header2.xml'], /<wp:extent cx="177800" cy="10692003"\/>/);
  assert.match(p['docProps/core.xml'], /<dc:title>Website Migration Review<\/dc:title><dc:creator>Jane Doe<\/dc:creator>/);
});

test('without a cover section the generated document starts with the body', () => {
  const p = parts(buildDocx('Hello', { ...vars, sections: ['body'] }, preset()).bytes);
  assert.ok(!p['word/document.xml'].includes('w:val="Title"'));
  assert.ok(!p['word/document.xml'].includes('<w:titlePg/>'));
  assert.ok(!p['word/header2.xml']);
  assert.match(p['word/document.xml'], /<w:body><w:p><w:pPr><w:pStyle w:val="Normal"\/><\/w:pPr><w:r><w:t xml:space="preserve">Hello/);
});

test('the table of contents lists the headings, links to them, and asks Word to update it', () => {
  const md = '# One\n\n## Sub\n\n#### Too deep\n\n# Two';
  const p = parts(buildDocx(md, { ...vars, sections: ['toc', 'body'] }, preset()).bytes);
  const doc = p['word/document.xml'];
  assert.match(doc, /<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"\/>/);
  assert.match(doc, /<w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u <\/w:instrText>/);
  // Levels the template leaves out of the table are not listed.
  const entries = [...doc.matchAll(/<w:hyperlink w:anchor="_TocReport\d+" w:history="1"><w:r><w:t xml:space="preserve">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(entries, ['One', 'A.  Sub', 'Two']);
  for (const m of doc.matchAll(/w:anchor="(_TocReport\d+)"/g)) assert.ok(doc.includes('w:name="' + m[1] + '"'), m[1]);
  // The first heading of the body opens a new page after the table.
  assert.match(doc, /<w:pStyle w:val="Heading1"\/><w:pageBreakBefore\/>/);
  assert.match(p['word/settings.xml'], /<w:updateFields w:val="true"\/><w:compat>/);
  assert.match(p['word/styles.xml'], /<w:name w:val="toc 1"\/>/);
});

test('the TLP reminder page shows each level on its colour', () => {
  const p = parts(buildDocx('Body', { ...vars, sections: ['tlp', 'body'] }, preset()).bytes);
  const doc = p['word/document.xml'];
  assert.match(doc, /Traffic Light Protocol reminder/);
  assert.match(doc, /<w:shd w:val="clear" w:color="auto" w:fill="EE0000"\/>[\s\S]*?TLP:RED/);
});

test('diagrams and callout icons the host drew are embedded as SVG with a PNG fallback', () => {
  const source = 'graph TD; A --> B';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="10" y="20">A</text></svg>';
  const icon = calloutIcons(preset()).find((i) => i.key.startsWith('triangleAlert:'));
  assert.ok(icon);
  const { bytes, warnings } = buildDocx('```mermaid\n' + source + '\n```\n\n> [!warning]\n> Careful.', { ...vars, sections: ['body'] }, preset(), {
    diagrams: { [source]: { png: PIXEL_PNG, svg, width: 200, height: 100 } },
    icons: { [icon.key]: { png: PIXEL_PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 24, height: 24 } }
  });
  assertPackageWellFormed(bytes);
  assert.deepEqual(warnings, []);
  const p = parts(bytes);
  const doc = p['word/document.xml'];
  assert.ok(!doc.includes('graph TD'));
  assert.match(doc, /<a:blip r:embed="rIdReport\d+"><a:extLst><a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}"><asvg:svgBlip xmlns:asvg="[^"]+" r:embed="rIdReport\d+"\/>/);
  // 200 px wide, half as high.
  assert.match(doc, /<wp:extent cx="1905000" cy="952500"\/>/);
  // The icon sits in the callout's title line, 12 pt square.
  assert.match(doc, /<wp:extent cx="152400" cy="152400"\/>[\s\S]*?Warning/);
  assert.match(p['[Content_Types].xml'], /Extension="svg" ContentType="image\/svg\+xml"/);
});

test('template artwork and the note logo replace the built-in decoration', () => {
  const p = preset();
  p.assets = { coverBg: PIXEL_PNG, frame: PIXEL_PNG, clientLogo: null };
  const out = parts(buildDocx('Body', vars, p, { clientLogo: PIXEL_PNG }).bytes);
  // One full-page picture each, and the logo on the cover.
  assert.equal((out['word/header1.xml'].match(/<wp:anchor /g) || []).length, 1);
  assert.match(out['word/header1.xml'], /<wp:extent cx="7560056" cy="10692003"\/>/);
  assert.match(out['word/header2.xml'], /<wp:extent cx="7560056" cy="10692003"\/>[\s\S]*<wp:extent cx="1524000" cy="1524000"\/>/);
});

test('the bundled example note exports to a well-formed document', () => {
  const md = stripFrontmatter(readFileSync(join(root, 'example-report.md'), 'utf8'));
  const { bytes, warnings } = buildDocx(md, vars, preset());
  assertPackageWellFormed(bytes);
  assert.ok(warnings.every((w) => /Mermaid/.test(w)), warnings.join('\n'));
});

test('a full version labels its restricted passages, as the PDF does', () => {
  const md = [
    '<!-- report-mark-start INTERNAL -->',
    '',
    'Kept for the team.',
    '',
    '<!-- report-mark-end -->',
    '',
    'Ships in May<span data-report-mark>, unless it slips</span>.'
  ].join('\n');
  const doc = parts(buildDocx(md, { ...vars, sections: ['body'] }, preset()).bytes)['word/document.xml'];
  assert.match(doc, /<w:keepNext\/><w:pBdr><w:bottom w:val="single"[^>]*w:color="FFC000"\/><\/w:pBdr><\/w:pPr><w:r><w:rPr><w:b\/><w:bCs\/><w:color w:val="000000"\/><w:sz w:val="15"\/><w:szCs w:val="15"\/><w:shd w:val="clear" w:color="auto" w:fill="FFC000"\/><\/w:rPr><w:t xml:space="preserve"> INTERNAL <\/w:t>/);
  assert.match(doc, /<w:bottom w:val="dashed"[^>]*w:color="FFC000"\/>/);
  assert.match(doc, /<w:shd w:val="clear" w:color="auto" w:fill="FFEFBF"\/><\/w:rPr><w:t xml:space="preserve">, unless it slips/);
  assert.ok(!doc.includes('data-report-mark'));
});

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

/** The paragraph Word writes after a spell check split a marker in three runs. */
const SPLIT_TITLE =
  '<w:p><w:pPr><w:pStyle w:val="Titre"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>{{ti</w:t></w:r>' +
  '<w:proofErr w:type="spellStart"/><w:r><w:t>tl</w:t></w:r><w:r><w:t>e}} for {{client}}</w:t></w:r></w:p>';

const FRENCH_STYLES =
  '<w:style w:type="paragraph" w:styleId="Titre"><w:name w:val="Title"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Corpsdetexte"><w:name w:val="Body Text"/></w:style>';

const TEMPLATE_BODY =
  SPLIT_TITLE +
  '<w:p><w:r><w:t>Version {{version}} of {{date}}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve"> {{content}} </w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Signed: {{author}} {{unknown}}</w:t></w:r></w:p>';

test('a Word template keeps its own parts and fills its markers, even split across runs', () => {
  const template = makeTemplate({
    body: TEMPLATE_BODY,
    styles: FRENCH_STYLES,
    header: '<w:p><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>{{tlp}} — {{title}}</w:t></w:r></w:p>',
    dotx: true
  });
  const md = '# Contexte\n\nUn paragraphe qui écrit {{title}} en toutes lettres.\n\n## Détail\n\n```\ncode\n```';
  const { bytes, warnings } = buildDocx(md, vars, preset(), { template });
  assertPackageWellFormed(bytes);
  const p = parts(bytes);
  const doc = p['word/document.xml'];

  // The split marker: the value lands in the first run, keeping its bold.
  assert.match(doc, /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Website Migration Review<\/w:t><\/w:r><w:proofErr w:type="spellStart"\/><w:r><w:t xml:space="preserve"><\/w:t><\/w:r><w:r><w:t xml:space="preserve"> for ACME Corp<\/w:t>/);
  assert.match(doc, /Version 1\.1 of 2026-10-21/);
  // An unknown marker is the user's text, not ours.
  assert.match(doc, /Signed: Jane Doe \{\{unknown\}\}/);
  // The report replaced the {{content}} paragraph, between the cover and the signature.
  assert.ok(!/\{\{\s*content/.test(doc));
  assert.ok(doc.indexOf('Contexte') > doc.indexOf('Version 1.1') && doc.indexOf('Contexte') < doc.indexOf('Signed'));
  // The note's own text is never treated as a marker.
  assert.match(doc, /qui écrit \{\{title\}\} en toutes lettres/);
  // Styles are found by internal name, whatever their id; a numbered heading
  // style keeps its own numbering, and gets none from the plugin.
  assert.match(doc, /<w:pStyle w:val="Titre1"\/><\/w:pPr><w:bookmarkStart [^>]*\/><w:r><w:t xml:space="preserve">Contexte/);
  assert.match(doc, /<w:pStyle w:val="Titre2"\/><\/w:pPr><w:bookmarkStart [^>]*\/><w:r><w:t xml:space="preserve">Détail/);
  // The header's marking is coloured, in a run of its own that keeps the size.
  assert.match(p['word/header1.xml'], /<w:rPr><w:b\/><w:color w:val="FFC000"\/><w:sz w:val="16"\/><\/w:rPr><w:t xml:space="preserve">TLP:AMBER<\/w:t>/);
  assert.match(p['word/header1.xml'], / — Website Migration Review/);
  // A .dotx comes out as a document.
  assert.match(p['[Content_Types].xml'], /PartName="\/word\/document\.xml" ContentType="[^"]*document\.main\+xml"/);
  assert.ok(!p['[Content_Types].xml'].includes('template.main'));
  // What the template lacked was added, without a warning: Word itself only
  // writes a built-in style into a file once it is used.
  assert.match(p['word/styles.xml'], /<w:name w:val="HTML Preformatted"\/>/);
  assert.ok(!/<w:name w:val="heading 1"\/>[\s\S]*<w:name w:val="heading 1"\/>/.test(p['word/styles.xml']));
  assert.deepEqual(warnings, []);
});

test('a {{toc}} paragraph in a template becomes a table of contents', () => {
  const template = makeTemplate({
    body: '<w:p><w:r><w:t>{{toc}}</w:t></w:r></w:p><w:p><w:r><w:t>{{content}}</w:t></w:r></w:p>',
    extra: {
      'word/settings.xml':
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:compat/><w:rsids/></w:settings>'
    }
  });
  const withSettings = rezip(template, {
    'word/_rels/document.xml.rels': parts(template)['word/_rels/document.xml.rels'].replace(
      '</Relationships>',
      '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
    )
  });
  const p = parts(buildDocx('# Part\n\nText', vars, preset(), { template: withSettings }).bytes);
  assert.ok(!p['word/document.xml'].includes('{{toc}}'));
  assert.match(p['word/document.xml'], /TOC \\o "1-3"[\s\S]*w:anchor="_TocReport\d+"[\s\S]*Part/);
  // In schema order: after zoom, before compat.
  assert.match(p['word/settings.xml'], /<w:zoom w:percent="100"\/><w:updateFields w:val="true"\/><w:compat\/>/);
});

test('the settings can point a role at another style of the template', () => {
  const template = makeTemplate({ body: '<w:p><w:r><w:t>{{content}}</w:t></w:r></w:p>', styles: FRENCH_STYLES });
  const p = preset({ word: { template: 'x.dotx', styles: { body: 'Body Text', heading1: 'No such style' } } });
  const { bytes, warnings } = buildDocx('# T\n\nText', vars, p, { template });
  const doc = parts(bytes)['word/document.xml'];
  assert.match(doc, /<w:pStyle w:val="Corpsdetexte"\/><\/w:pPr><w:r><w:t xml:space="preserve">Text/);
  assert.match(doc, /<w:pStyle w:val="Titre1"\/>/);
  assert.ok(warnings.some((w) => w.includes('No such style')));
});

test('a template without {{content}} gets the report at the end, before its section properties', () => {
  const template = makeTemplate({ body: '<w:p><w:r><w:t>Cover</w:t></w:r></w:p>' });
  const { bytes, warnings } = buildDocx('Body text', vars, preset(), { template });
  const doc = parts(bytes)['word/document.xml'];
  assert.ok(doc.indexOf('Body text') > doc.indexOf('Cover'));
  assert.ok(doc.indexOf('Body text') < doc.indexOf('<w:sectPr'));
  assert.ok(warnings.some((w) => w.includes('{{content}}')));
});

test('list numbering is appended after the template’s own definitions', () => {
  const numbering =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="multilevel"/></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>';
  const template = makeTemplate({
    body: '<w:p><w:r><w:t>{{content}}</w:t></w:r></w:p>',
    extra: { 'word/numbering.xml': numbering }
  });
  // Wire the existing numbering part the way Word does.
  const withRel = parts(template);
  const p = parts(
    buildDocx('- a\n- b\n\n1. c', vars, preset(), {
      template: rezip(template, {
        'word/_rels/document.xml.rels': withRel['word/_rels/document.xml.rels'].replace(
          '</Relationships>',
          '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'
        )
      })
    }).bytes
  );
  const num = p['word/numbering.xml'];
  // New ids never collide with the template's, and every abstract comes first.
  assert.match(num, /<w:abstractNum w:abstractNumId="4">/);
  assert.match(num, /<w:num w:numId="8">/);
  assert.ok(num.lastIndexOf('<w:abstractNum ') < num.indexOf('<w:num '));
});

test('macro-enabled and broken templates are refused with a clear message', () => {
  const macro = makeTemplate({ body: '', extra: { 'word/vbaProject.bin': 'x' } });
  assert.throws(() => buildDocx('x', vars, preset(), { template: macro }), WordTemplateError);
  assert.throws(() => buildDocx('x', vars, preset(), { template: new Uint8Array([1, 2, 3]) }), WordTemplateError);
});

test('the styles of a template are listed by internal name', () => {
  const names = listWordStyles(makeTemplate({ body: '', styles: FRENCH_STYLES })).map((s) => s.name);
  assert.deepEqual(names, ['Normal', 'Title', 'heading 1', 'heading 2', 'Body Text']);
});

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

test('markers are found across runs and filled in place', () => {
  const p = '<w:p><w:r><w:t>{{</w:t></w:r><w:r><w:t xml:space="preserve">client</w:t></w:r><w:r><w:t>}} &amp; co</w:t></w:r></w:p>';
  const out = fillMarkers(p, (n) => (n === 'client' ? { text: 'A<B' } : null));
  assert.equal(paragraphText(out), 'A<B & co');
  assert.ok(out.includes('A&lt;B'));
});

test('run properties stay in schema order when bold and a colour are added', () => {
  assert.equal(
    withRunProps('<w:rPr><w:rFonts w:ascii="X"/><w:i/><w:sz w:val="20"/></w:rPr>', { bold: true, color: 'FF0000' }),
    '<w:rPr><w:rFonts w:ascii="X"/><w:b/><w:i/><w:color w:val="FF0000"/><w:sz w:val="20"/></w:rPr>'
  );
  assert.equal(withRunProps('', { color: 'FF0000' }), '<w:rPr><w:color w:val="FF0000"/></w:rPr>');
});

/** Replace some files of a zip. */
function rezip(bytes: Uint8Array, files: Record<string, string>): Uint8Array {
  const all = unzipSync(bytes);
  for (const [k, v] of Object.entries(files)) all[k] = strToU8(v);
  return zipSync(all);
}
