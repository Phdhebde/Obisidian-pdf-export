import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILENAME_TEMPLATE,
  isStoredFile,
  migrateData,
  migratePreset,
  normalizeContact,
  normalizeVersion,
  presetId,
  renderFilename,
  sanitizeSegment,
  uniqueName
} from '../src/storage.ts';
import { CURRENT_SCHEMA_VERSION } from '../src/types.ts';

/**
 * A partial template, as a hand-edited or older JSON export carries it: only
 * some colours, no labels, no toc, a section list with the TLP page.
 */
const partialPreset = {
  id: 'acme',
  name: 'ACME',
  colors: { brand: '#E97132', link: '#467886' },
  fonts: { bodyFont: 'Liberation', headingFont: 'Archivo', monoFont: 'LiberationMono' },
  layout: { pageMargins: [71, 118, 71, 86] },
  sections: ['cover', 'references', 'tlp', 'toc', 'body'],
  assets: { coverBg: 'assets/acme-coverBg.png', frame: null }
};

const storedData = {
  presets: [partialPreset],
  outputFolder: 'Downloads',
  rememberLast: true,
  lastPresetId: 'acme'
};

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

test('a partial template is completed without losing customisation', () => {
  const d = migrateData(structuredClone(storedData));
  assert.equal(d.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(d.outputFolder, 'Downloads');
  assert.equal(d.lastPresetId, 'acme');
  assert.equal(d.presets.length, 1);

  const p = d.presets[0];
  assert.equal(p.colors.brand, '#E97132');
  assert.equal(p.colors.tableHeaderText, '#FFFFFF'); // filled from the defaults
  assert.deepEqual(p.sections, ['cover', 'references', 'tlp', 'toc', 'body']);
  assert.equal(p.labels.contactColumn, 'CONTACT');
  assert.equal(p.justify, true);
  assert.equal(p.diamondBullets, true);
  assert.equal(p.layout.decor, true);
  assert.equal(p.transclusions, 'inline');
  assert.deepEqual(p.layout.pageMargins, [71, 118, 71, 86]);
  assert.equal(p.layout.cover.titleSize, 36);
  assert.equal(p.assets.coverBg, 'assets/acme-coverBg.png');
  assert.equal(p.assets.frame, null);
});

test('only an explicit false turns the built-in decoration off', () => {
  assert.equal(migratePreset({ layout: { decor: false } }).layout.decor, false);
  assert.equal(migratePreset({ layout: { decor: 'no' } }).layout.decor, true);
});

test('a fresh install asks before overwriting a PDF', () => {
  assert.equal(migrateData(null).conflictMode, 'ask');
  assert.equal(migrateData({ conflictMode: 'overwrite' }).conflictMode, 'overwrite');
  assert.equal(migrateData({ conflictMode: 'bogus' }).conflictMode, 'ask');
});

test('migration is idempotent', () => {
  const once = migrateData(structuredClone(storedData));
  const twice = migrateData(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('the factory template is seeded on first run only', () => {
  const fresh = migrateData(null);
  assert.equal(fresh.presets.length, 1);
  assert.equal(fresh.presets[0].id, 'default');
  // Drawn by the generator: no artwork, and no TLP page by default.
  assert.equal(fresh.presets[0].assets.coverBg, null);
  assert.ok(!fresh.presets[0].sections.includes('tlp'));

  // Once the user has templates of their own, the factory one may be gone.
  assert.deepEqual(migrateData(structuredClone(storedData)).presets.map((p) => p.id), ['acme']);

  const junk = migrateData({ presets: [{ id: 'x', sections: ['nope', 'body'] }] });
  // Unknown section keys are dropped rather than reaching the generator.
  assert.deepEqual(junk.presets[0].sections, ['body']);
});

test('migratePreset survives garbage input', () => {
  for (const junk of [null, undefined, 42, 'texte', []]) {
    const p = migratePreset(junk);
    assert.equal(typeof p.id, 'string');
    assert.equal(p.colors.brand, '#1F5F8B');
    assert.ok(p.sections.length);
  }
});

/* ------------------------------------------------------------------ */
/* Frontmatter people and versions                                     */
/* ------------------------------------------------------------------ */

test('contacts are read from French or English keys', () => {
  assert.deepEqual(normalizeContact({ name: 'Jane', role: 'Lead', email: 'j@x.io', company: 'ACME' }), {
    nom: 'Jane', poste: 'Lead', courriel: 'j@x.io', societe: 'ACME'
  });
  assert.deepEqual(normalizeContact({ nom: 'Camille', poste: 'Cheffe', courriel: 'c@x.fr' }), {
    nom: 'Camille', poste: 'Cheffe', courriel: 'c@x.fr', societe: undefined
  });
  assert.deepEqual(normalizeContact('not an object'), {});
});

test('status rows are read from French or English keys', () => {
  assert.deepEqual(normalizeVersion({ version: 1.1, date: '2026-06-08', status: 'Reviewed' }), {
    version: '1.1', date: '2026-06-08', etat: 'Reviewed'
  });
  assert.equal(normalizeVersion({ etat: 'Création' }).etat, 'Création');
});

/* ------------------------------------------------------------------ */
/* Filenames                                                           */
/* ------------------------------------------------------------------ */

const vars = (over = {}) =>
  Object.assign({ docTitle: 'Rapport', client: 'ACME', tlp: 'RED' as const, versions: [] }, over);

test('the default template keeps the v1.0 behaviour', () => {
  const name = renderFilename(DEFAULT_FILENAME_TEMPLATE, { noteBasename: 'ma note', vars: vars() });
  assert.equal(name, 'ma note');
});

test('templates expand tokens and sanitise the result', () => {
  const name = renderFilename('{{date}} - {{client}} - {{titre}}', {
    noteBasename: 'note',
    vars: vars({ docTitle: 'Rapport: Investigation', client: 'ACME/CORP' }),
    now: new Date(2026, 8, 4)
  });
  assert.equal(name, '2026-09-04 - ACME-CORP - Rapport- Investigation');
});

test('empty tokens do not leave dangling separators', () => {
  assert.equal(
    renderFilename('{{client}} - {{titre}}', {
      noteBasename: 'ma-note',
      vars: vars({ docTitle: '', client: '' })
    }),
    'ma-note'
  );
});

test('the version token uses the latest frontmatter entry', () => {
  const name = renderFilename('{{titre}} {{version}}', {
    noteBasename: 'n',
    vars: vars({ versions: [{ version: 'V 1.0' }, { version: 'V 1.2' }] })
  });
  assert.equal(name, 'Rapport V 1.2');
});

test('sanitizeSegment strips path and reserved characters', () => {
  assert.equal(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(sanitizeSegment('  ..nom..  '), 'nom');
});

test('uniqueName walks past taken names', () => {
  const taken = new Set(['Rapport', 'Rapport-1']);
  assert.equal(uniqueName('Rapport', (n) => taken.has(n)), 'Rapport-2');
  assert.equal(uniqueName('Autre', (n) => taken.has(n)), 'Autre');
});

test('presetId slugifies accents and stays unique', () => {
  assert.match(presetId('Modèle Réf & Cie'), /^modele-ref-cie-[a-z0-9]{5}$/);
  assert.notEqual(presetId('x'), presetId('x'));
});

test('only image files the plugin wrote itself count as stored template images', () => {
  assert.ok(isStoredFile('assets/default-coverBg.png'));
  assert.ok(isStoredFile('assets/acme-x1y2z-frame.jpg'));
  for (const bad of ['../../note.md', 'assets/../../x.png', 'assets/a/b.png', '/etc/passwd', 'assets/x.md', '', null]) {
    assert.equal(isStoredFile(bad), false, String(bad));
  }
});

test('an install from before export profiles gets the internal level and a client profile', () => {
  const d = migrateData({ presets: [], outputFolder: 'PDF' });
  assert.deepEqual(d.audienceLevels, ['internal']);
  assert.deepEqual(d.profiles.map((p) => [p.id, p.keep, p.suffix]), [['client', [], '-client']]);
});

test('stored profiles are kept, cleaned, and the ones without an id dropped', () => {
  const d = migrateData({
    audienceLevels: ['Internal', 'Board', 'internal'],
    profiles: [
      { id: 'partner', name: 'Partner', keep: 'Board', suffix: '-partner', placeholder: true, tlp: 'amber' },
      { name: 'no id' },
      'junk',
      { id: 'bad-tlp', tlp: 'PURPLE' }
    ]
  });
  assert.deepEqual(d.audienceLevels, ['internal', 'board']);
  assert.deepEqual(d.profiles, [
    { id: 'partner', name: 'Partner', keep: ['board'], suffix: '-partner', placeholder: true, tlp: 'AMBER' },
    { id: 'bad-tlp', name: 'bad-tlp', keep: [], suffix: '', placeholder: false, tlp: null }
  ]);
});

test('a user who deleted every profile keeps none', () => {
  assert.deepEqual(migrateData({ profiles: [] }).profiles, []);
});
