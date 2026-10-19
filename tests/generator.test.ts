import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDiagrams, coverShift, fitCoverTitle, defaultLabels, defaultPreset, normalizeTlp } from '../src/generator.ts';
import { buildDocDefinition, markdownToPdf, type PdfNode } from './loose.ts';
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

function collectText(node: unknown): string {
  const parts: string[] = [];
  walk(node, (n) => { if (typeof n.text === 'string') parts.push(n.text); });
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/* TLP — B6                                                            */
/* ------------------------------------------------------------------ */

test('normalizeTlp canonicalises spellings and reports unknown values', () => {
  assert.deepEqual(normalizeTlp('RED'), { key: 'RED', recognised: true });
  assert.deepEqual(normalizeTlp(' tlp:amber '), { key: 'AMBER', recognised: true });
  assert.deepEqual(normalizeTlp('AMBER+STRICT'), { key: 'AMBER+STRICT', recognised: true });
  assert.deepEqual(normalizeTlp('amber strict'), { key: 'AMBER+STRICT', recognised: true });
  assert.deepEqual(normalizeTlp('WHITE'), { key: 'CLEAR', recognised: true });
  // Absent is fine and defaults to CLEAR; present-but-wrong must be flagged.
  assert.deepEqual(normalizeTlp(undefined), { key: 'CLEAR', recognised: true });
  assert.deepEqual(normalizeTlp('rouge'), { key: 'CLEAR', recognised: false });
});

test('a note with no tlp key carries no TLP marking by default', () => {
  const dd = buildDocDefinition('# T', vars({ tlp: null }), preset());
  assert.doesNotMatch(collectText(dd.footer(2, 5)), /TLP:/);
  assert.doesNotMatch(dd.info.keywords, /TLP:/);
});

test('with the TLP reminder on, an unmarked note is marked CLEAR, not RED', () => {
  const p = preset({ sections: ['cover', 'tlp', 'body'] });
  const dd = buildDocDefinition('# T', vars({ tlp: null }), p);
  assert.match(collectText(dd.footer(2, 5)), /TLP:CLEAR/);
});

test('a footer with neither TLP marking nor page number is left out', () => {
  const p = preset();
  p.layout.pagination = '';
  const dd = buildDocDefinition('# T', vars({ tlp: null }), p);
  assert.equal(dd.footer(2, 5), null);
});

test('without images, the built-in decoration is drawn in the preset colours', () => {
  const p = defaultPreset({});
  const dd = buildDocDefinition('# T', vars(), p);
  const cover = dd.background(1, { width: 595, height: 842 });
  const frame = dd.background(2, { width: 595, height: 842 });
  assert.ok(Array.isArray(cover.canvas) && cover.canvas.length);
  assert.ok(frame.canvas.some((n: PdfNode) => n.color === p.colors.banner));
  assert.ok(frame.canvas.some((n: PdfNode) => n.color === p.colors.dark));

  p.layout.decor = false;
  const bare = buildDocDefinition('# T', vars(), p);
  assert.equal(bare.background(1, { width: 595, height: 842 }), null);
  assert.equal(bare.background(2, { width: 595, height: 842 }), null);
});

/* ------------------------------------------------------------------ */
/* Cover / background / header / footer — B4                           */
/* ------------------------------------------------------------------ */

test('with the cover on, page 1 gets the cover art and no header or footer', () => {
  const dd = buildDocDefinition('# T', vars(), preset());
  assert.equal(dd.background(1, { width: 595, height: 842 }).image, 'coverBg');
  assert.equal(dd.header(1), null);
  assert.equal(dd.footer(1, 3), null);
  assert.equal(dd.background(2, { width: 595, height: 842 }).image, 'frame');
});

test('with the cover off, page 1 gets the frame and keeps its header and footer', () => {
  const p = preset({ sections: ['toc', 'body'] });
  const dd = buildDocDefinition('# T', vars(), p);
  assert.equal(dd.background(1, { width: 595, height: 842 }).image, 'frame');
  assert.notEqual(dd.header(1), null);
  assert.notEqual(dd.footer(1, 3), null);
  assert.match(collectText(dd.header(1)), /Rapport/);
});

test('the cover is pinned to page 1 even if the preset orders it later', () => {
  const p = preset({ sections: ['body', 'cover'] });
  const dd = buildDocDefinition('# T', vars(), p);
  assert.equal(dd.background(1, { width: 595, height: 842 }).image, 'coverBg');
});

test('a long cover title shrinks instead of overflowing', () => {
  const short = fitCoverTitle('RAPPORT', 36, 13);
  assert.equal(short.fontSize, 36);
  const long = fitCoverTitle("RAPPORT D'INVESTIGATION NUMÉRIQUE APPROFONDIE SUR INCIDENT", 36, 13);
  assert.ok(long.fontSize < 36, 'expected the type to shrink');
  assert.ok(long.text.split('\n').length <= 3, 'expected at most 3 lines');
});

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

test('disabled sections are omitted and frontmatter can override them', () => {
  const all = preset({ sections: ['cover', 'references', 'tlp', 'toc', 'body'] });
  const full = collectText(buildDocDefinition('# Corps', vars(), all).content);
  assert.match(full, /Document references/);
  assert.match(full, /Traffic Light Protocol reminder/);

  const bodyOnly = buildDocDefinition('# Corps', vars({ sections: ['body'] }), all);
  const text = collectText(bodyOnly.content);
  assert.doesNotMatch(text, /Document references/);
  assert.match(text, /Corps/);
});

test('preset labels replace the default wording', () => {
  const p = preset();
  p.labels.contactColumn = 'CONTACT ACME';
  p.labels.references = 'Références du document';
  const text = collectText(buildDocDefinition('', vars(), p).content);
  assert.match(text, /CONTACT ACME/);
  assert.match(text, /Références du document/);
  assert.doesNotMatch(text, /Document references/);
});

test('the default labels follow the requested language', () => {
  assert.equal(defaultLabels('en').recipients, 'Recipients');
  assert.equal(defaultLabels('fr').recipients, 'Destinataires');
  assert.equal(defaultPreset({}, 'fr').labels.toc, 'Table des matières');
});

/* ------------------------------------------------------------------ */
/* Markdown conversion                                                 */
/* ------------------------------------------------------------------ */

test('headings are auto-numbered A. then 1. and reset per level', () => {
  const md = '# Un\n## Alpha\n### Premier\n### Second\n## Beta\n# Deux\n## Gamma';
  const text = collectText(markdownToPdf(md, preset()));
  assert.match(text, /A\.\s+Alpha/);
  assert.match(text, /1\. Premier/);
  assert.match(text, /2\. Second/);
  assert.match(text, /B\.\s+Beta/);
  // A new H1 resets the letter counter.
  assert.match(text, /A\.\s+Gamma/);
});

test('h5 and h6 no longer collapse into the h4 style', () => {
  const nodes = markdownToPdf('#### Quatre\n##### Cinq\n###### Six', preset());
  const styles = nodes.map((n) => n.style);
  assert.deepEqual(styles, ['h4', 'h5', 'h6']);
});

test('bullets under a "Recommandations" heading become diamonds', () => {
  const diamonds = (md: string) => {
    let found = 0;
    walk(markdownToPdf(md, preset()), (n) => {
      if (Array.isArray(n.canvas) && n.canvas[0]?.type === 'polyline') found++;
    });
    return found;
  };
  assert.equal(diamonds('# Recommandations\n\n- a\n- b'), 2);
  assert.equal(diamonds('# Analyse\n\n- a\n- b'), 0);
});

test('task list items are drawn as vectors, not as font glyphs', () => {
  const nodes = markdownToPdf('- [ ] à faire\n- [x] fait', preset());
  const boxes: PdfNode[] = [];
  walk(nodes, (n) => { if (Array.isArray(n.canvas) && n.canvas[0]?.type === 'rect') boxes.push(n); });

  assert.equal(boxes.length, 2, 'one checkbox per task');
  // Liberation Sans has no ☐/☑ glyph, so the mark must never be typed text.
  assert.doesNotMatch(collectText(nodes), /[☐☑✓✔]/);
  assert.equal(boxes[0].canvas.length, 1, 'unchecked: just the box');
  assert.equal(boxes[1].canvas.length, 2, 'checked: box plus a tick');
  assert.equal(boxes[1].canvas[1].type, 'polyline');
  assert.ok(!nodes.some((n) => n.ul), 'a task list must not also get bullets');
});

test('Obsidian callouts are styled by type, with a default title', () => {
  const nodes = markdownToPdf('> [!warning] Attention\n> corps', preset());
  assert.match(collectText(nodes), /Attention[\s\S]*corps/);

  const untitled = markdownToPdf('> [!danger]\n> texte', preset());
  assert.match(collectText(untitled), /Danger/);

  // A plain blockquote keeps the original orange-barred box.
  const quote = markdownToPdf('> simple', preset());
  assert.match(collectText(quote), /simple/);
});

test('a callout title renders inline Markdown instead of its raw syntax', () => {
  const nodes = markdownToPdf(
    '> [!warning] Le dossier `.obsidian` est **masqué**\n> Corps du callout.',
    preset()
  );
  const runs: PdfNode[] = [];
  walk(nodes, (n) => { if (n.style === 'calloutTitle' && Array.isArray(n.text)) runs.push(...n.text); });

  assert.ok(runs.length, 'expected the title to be a run list, not a raw string');
  const code = runs.find((r) => r.text === '.obsidian');
  assert.ok(code, 'the code span should lose its backticks');
  assert.equal(code!.font, preset().fonts.monoFont);
  assert.ok(runs.find((r) => r.text === 'masqué')?.bold, 'bold should survive in the title');
  assert.doesNotMatch(collectText(nodes), /`\.obsidian`|\*\*masqué\*\*/);
});

test('a fully italic paragraph is body text, not a caption', () => {
  const emphasis = markdownToPdf('*Cette phrase est simplement en italique.*', preset());
  assert.equal(emphasis[0].style, 'body');
  const caption = markdownToPdf('*Figure 1 : la console*', preset());
  assert.equal(caption[0].style, 'caption');
});

test('manual page break markers set pageBreak on the following block', () => {
  const nodes = markdownToPdf('# Un\n\n\\pagebreak\n\n# Deux', preset());
  const broken = nodes.filter((n) => n.pageBreak === 'before');
  assert.equal(broken.length, 1);
  assert.equal(broken[0].text, 'Deux');
});

test('a trailing page break marker does not emit a blank page', () => {
  const nodes = markdownToPdf('# Un\n\n\\pagebreak\n', preset());
  assert.equal(nodes.filter((n) => n.pageBreak === 'before').length, 0);
});

test('tables carry a header row and the preset colours', () => {
  const nodes = markdownToPdf('| A | B |\n|---|---|\n| 1 | 2 |', preset());
  const t = nodes.find((n) => n.table);
  assert.ok(t);
  assert.equal(t.table.headerRows, 1);
  assert.equal(t.table.body.length, 2);
  assert.equal(t.layout.fillColor(0), preset().colors.tableHeaderBg);
  assert.equal(t.layout.fillColor(1), preset().colors.tableBodyBg);
});

test('images referenced through the host dictionary become pdfmake image nodes', () => {
  const nodes = markdownToPdf('![légende](report-image:img0 "400")', preset());
  const found: PdfNode[] = [];
  walk(nodes, (n) => { if (n.image) found.push(n); });
  assert.equal(found.length, 1);
  assert.equal(found[0].image, 'img0');
  assert.equal(found[0].width, 300); // 400 CSS px -> 300 pt
});

/* ------------------------------------------------------------------ */
/* Document metadata                                                   */
/* ------------------------------------------------------------------ */

test('the PDF carries document metadata', () => {
  const dd = buildDocDefinition('# T', vars({ tlp: 'RED', author: 'M. H.' }), preset());
  assert.equal(dd.info.title, 'Rapport');
  assert.equal(dd.info.author, 'M. H.');
  assert.match(dd.info.keywords, /TLP:RED/);
  assert.match(dd.info.keywords, /ACME/);
});

test('justification is a preset option', () => {
  assert.equal(buildDocDefinition('t', vars(), preset()).defaultStyle.alignment, 'justify');
  assert.equal(
    buildDocDefinition('t', vars(), preset({ justify: false })).defaultStyle.alignment,
    'left'
  );
});

/* ------------------------------------------------------------------ */
/* Recipients block                                                    */
/* ------------------------------------------------------------------ */

test('the recipients table is absent by default', () => {
  const text = collectText(buildDocDefinition('', vars(), preset()).content);
  assert.match(text, /Contacts/);
  assert.doesNotMatch(text, /Destinataires/);
});

test('a note that names recipients prints the table without any preset change', () => {
  const dd = buildDocDefinition(
    '',
    vars({ recipients: [{ nom: 'Claire MARTIN', societe: 'ACME-CORP', courriel: 'c.martin@acme.example' }] }),
    preset()
  );
  const text = collectText(dd.content);
  assert.match(text, /Recipients/);
  assert.match(text, /RECIPIENT/);
  assert.match(text, /Claire MARTIN/);
  // `societe` fills the middle column when no `poste` is given.
  assert.match(text, /ACME-CORP/);
  assert.match(text, /c\.martin@acme\.example/);
});

test('the preset can force a blank recipients form', () => {
  const dd = buildDocDefinition('', vars({ recipients: [] }), preset({ showRecipients: true }));
  const text = collectText(dd.content);
  assert.match(text, /Recipients/);

  // Same shape as the contacts table: header plus the template's blank rows.
  // (The TLP badges are tables too, but carry no explicit widths.)
  const people: PdfNode[] = [];
  walk(dd.content, (n) => {
    if (n.table && Array.isArray(n.table.widths) && n.table.widths.join(',') === '*,*,*') people.push(n);
  });
  assert.equal(people.length, 2, 'contacts + recipients');
  assert.ok(people.every((t) => t.table.body.length >= 4), 'both padded to the template rows');
});

test('a recipient poste wins over societe, and labels stay configurable', () => {
  const p = preset({ showRecipients: true });
  p.labels.recipients = 'Diffusion';
  p.labels.recipientRole = 'ENTITÉ';
  const dd = buildDocDefinition('', vars({ recipients: [{ nom: 'X', poste: 'RSSI', societe: 'ACME' }] }), p);
  const text = collectText(dd.content);
  assert.match(text, /Diffusion/);
  assert.match(text, /ENTITÉ/);
  assert.match(text, /RSSI/);
  assert.doesNotMatch(text, /ACME/);
});

/* ------------------------------------------------------------------ */
/* Callout icons                                                       */
/* ------------------------------------------------------------------ */

test('each callout type gets the Lucide icon Obsidian uses, in the accent colour', () => {
  const svgOf = (md: string): string | null => {
    let found: string | null = null;
    walk(markdownToPdf(md, preset()), (n) => { if (typeof n.svg === 'string' && !found) found = n.svg; });
    return found;
  };

  const warning = svgOf('> [!warning] Attention\n> corps');
  assert.ok(warning, 'a callout should carry an icon');
  // triangle-alert: the sloped sides of the triangle are its signature.
  assert.match(warning!, /a2 2 0 0 0-3\.48 0/);
  assert.match(warning!, /stroke="#F09B00"/);
  assert.doesNotMatch(warning!, /currentColor/, 'pdfmake cannot resolve currentColor');

  // Different types must not all share one glyph.
  const info = svgOf('> [!info]\n> corps');
  const bug = svgOf('> [!bug]\n> corps');
  assert.notEqual(info, warning);
  assert.notEqual(bug, warning);
  assert.match(info!, /stroke="#00B8D4"/);

  // Aliases resolve to the same icon as their canonical type.
  assert.equal(svgOf('> [!caution]\n> x'), warning);
  assert.equal(svgOf('> [!attention]\n> x'), warning);
});

test('an unknown callout type still renders, with the preset accent', () => {
  const svg: string[] = [];
  walk(markdownToPdf('> [!inconnu] Titre\n> corps', preset()), (n) => { if (n.svg) svg.push(n.svg); });
  assert.equal(svg.length, 1);
  assert.match(svg[0], new RegExp(preset().colors.brand));
});

test('callout icons can be turned off per preset', () => {
  const nodes = markdownToPdf('> [!warning] Attention\n> corps', preset({ calloutIcons: false }));
  let count = 0;
  walk(nodes, (n) => { if (n.svg) count++; });
  assert.equal(count, 0);
  // The title text must survive the layout change.
  assert.match(collectText(nodes), /Attention/);
});

test('a plain blockquote gets no icon', () => {
  let count = 0;
  walk(markdownToPdf('> simple citation', preset()), (n) => { if (n.svg) count++; });
  assert.equal(count, 0);
});

/* ------------------------------------------------------------------ */
/* Mermaid diagrams                                                    */
/* ------------------------------------------------------------------ */

const FLOW = 'graph TD\n  A --> B';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"></svg>';
const drawn = (width: number, height: number) => ({ svg: SVG, width, height });

test('mermaid sources are found wherever the body renders them, and only there', () => {
  const md = [
    '```mermaid', FLOW, '```',
    '',
    '> [!note] Schéma',
    '> ```mermaid',
    '> sequenceDiagram',
    '> ```',
    '',
    '````md',
    '```mermaid',
    'pie',
    '```',
    '````',
    '',
    '```mermaid',
    FLOW, // repeated: listed once
    '```'
  ].join('\n');
  assert.deepEqual(collectDiagrams(md, preset()), [FLOW, 'sequenceDiagram']);
});

test('a rendered diagram prints as vectors, sized from its natural width', () => {
  const dd = buildDocDefinition('```mermaid\r\n' + FLOW + '\r\n```', vars({ sections: ['body'] }), preset(), {
    diagrams: { [FLOW]: drawn(400, 200) }
  });
  const found: PdfNode[] = [];
  walk(dd.content, (n) => { if (n.svg) found.push(n); });
  assert.equal(found.length, 1);
  assert.equal(found[0].svg, SVG);
  assert.deepEqual(found[0].fit, [300, 580]); // 400 CSS px -> 300 pt
  assert.doesNotMatch(collectText(dd.content), /A --> B/);
  let rasters = 0;
  walk(dd.content, (n) => { if (n.image) rasters++; });
  assert.equal(rasters, 0, 'no raster image');
});

test('a wide diagram is held to the column it sits in', () => {
  const dd = buildDocDefinition('> [!info]\n> ```mermaid\n> ' + FLOW.replace('\n', '\n> ') + '\n> ```',
    vars({ sections: ['body'] }), preset(), { diagrams: { [FLOW]: drawn(2000, 300) } });
  const found: PdfNode[] = [];
  walk(dd.content, (n) => { if (n.svg === SVG) found.push(n); }); // not the callout icon
  assert.equal(found.length, 1);
  assert.ok(found[0].fit[0] < 451, 'narrower than the full text width inside a callout');
});

test('a diagram the host could not render falls back to its code', () => {
  const text = collectText(buildDocDefinition('```mermaid\n' + FLOW + '\n```', vars({ sections: ['body'] }), preset()).content);
  assert.match(text, /A --> B/);
});

test('a three-line cover title pushes the rule and subtitles down instead of crossing them', () => {
  const p = preset();
  assert.equal(coverShift({ coverTitle: 'Short title' }, p), 0);

  const long = { coverTitle: 'Website Migration Review', coverSubtitle: 'Team' };
  const shift = coverShift(long, p);
  assert.ok(shift > 0, 'a third line reaches the rule');

  const dd = buildDocDefinition('', vars(long), p);
  const placed: PdfNode[] = [];
  walk(dd.content, (n) => { if (n.absolutePosition) placed.push(n); });
  const rule = placed.find((n) => n.canvas);
  const subtitle = placed.find((n) => n.text === 'Team');
  assert.equal(rule!.absolutePosition.y, p.layout.cover.ruleY + shift);
  assert.equal(subtitle!.absolutePosition.y, p.layout.cover.subtitleY + shift);
});
