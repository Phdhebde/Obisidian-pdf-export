/*
 * Persistence shape and migration for data.json.
 *
 * Pure functions only — no Obsidian API — so the migration and the filename
 * templating can be tested directly.
 */
import {
  CURRENT_SCHEMA_VERSION,
  asText,
  HEADING_LEVELS,
  SECTION_KEYS,
  TLP_KEYS,
  isNumberingStyle,
  isSectionKey,
  isWordRole,
  type ConflictMode,
  type DocContact,
  type DocVersion,
  type ExportProfile,
  type PluginData,
  type Preset,
  type PresetToc,
  type ReportVars,
  type SectionKey,
  type TlpKey
} from './types.ts';
import { defaultLabels, defaultPreset, defaultToc } from './generator.ts';
import { normalizeLevels } from './redact.ts';

/**
 * Bring a stored heading configuration back to exactly six levels of known
 * values. A hand-edited data.json, or a preset from a build that had fewer
 * levels, must not leave a hole that the generator then indexes into.
 */
function migrateToc(raw: unknown): PresetToc {
  const base = defaultToc();
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<PresetToc>;
  const levels = (Array.isArray(p.levels) ? p.levels : []).slice(0, HEADING_LEVELS);
  const numbering = (Array.isArray(p.numbering) ? p.numbering : []).slice(0, HEADING_LEVELS);
  const pageBreak = (Array.isArray(p.pageBreak) ? p.pageBreak : []).slice(0, HEADING_LEVELS);
  return {
    levels: base.levels.map((d, i) => (typeof levels[i] === 'boolean' ? levels[i] : d)),
    numbering: base.numbering.map((d, i) => (isNumberingStyle(numbering[i]) ? numbering[i] : d)),
    hierarchical: typeof p.hierarchical === 'boolean' ? p.hierarchical : base.hierarchical,
    pageBreak: base.pageBreak.map((d, i) => (typeof pageBreak[i] === 'boolean' ? pageBreak[i] : d))
  };
}

export const DEFAULT_FILENAME_TEMPLATE = '{{note}}';

export function defaultData(): PluginData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    presets: [],
    outputFolder: '',
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    conflictMode: 'ask',
    rememberLast: true,
    alwaysUseLast: false,
    defaultContacts: [],
    audienceLevels: ['internal'],
    profiles: [defaultProfile()],
    markConfidential: true,
    logExports: false
  };
}

/** The profile a first install starts with: a client version without internal passages. */
export function defaultProfile(): ExportProfile {
  return { id: 'client', name: 'Client', keep: [], suffix: '-client', placeholder: false, tlp: null };
}

/** Bring a stored profile up to the current shape. */
export function migrateProfile(raw: unknown): ExportProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = asText(p.id).trim();
  if (!id) return null;
  const tlp = asText(p.tlp).trim().toUpperCase();
  return {
    id,
    name: asText(p.name).trim() || id,
    keep: normalizeLevels(p.keep),
    suffix: asText(p.suffix),
    placeholder: p.placeholder === true,
    tlp: (TLP_KEYS as readonly string[]).includes(tlp) ? (tlp as TlpKey) : null
  };
}

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

/**
 * Bring a stored or imported preset up to the current shape.
 *
 * Idempotent, and non-destructive: anything the user customised is kept, only
 * missing fields are filled from the factory defaults.
 */
export function migratePreset(raw: unknown): Preset {
  const base = defaultPreset({});
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Preset> & Record<string, unknown>;
  const layout = (p.layout || {}) as Partial<Preset['layout']>;

  const sections: SectionKey[] = Array.isArray(p.sections)
    ? p.sections.filter(isSectionKey)
    : [...base.sections];

  return {
    id: typeof p.id === 'string' && p.id ? p.id : base.id,
    name: typeof p.name === 'string' && p.name ? p.name : base.name,
    colors: { ...base.colors, ...(p.colors || {}) },
    fonts: { ...base.fonts, ...(p.fonts || {}) },
    layout: {
      ...base.layout,
      ...layout,
      // A template is text; a malformed import would otherwise print its
      // number on every page.
      pagination: typeof layout.pagination === 'string' ? layout.pagination : base.layout.pagination,
      // Templates travel as JSON, so a hand-edited "yes" must not read as a
      // boolean: only an explicit false turns these off.
      decor: layout.decor !== false,
      cover: {
        ...base.layout.cover,
        ...(layout.cover || {}),
        showRule: layout.cover?.showRule !== false
      }
    },
    tlp: { ...base.tlp, ...(p.tlp || {}) },
    tlpReminder: Array.isArray(p.tlpReminder) && p.tlpReminder.length ? p.tlpReminder : base.tlpReminder,
    sections: sections.length ? sections : [...SECTION_KEYS],
    toc: migrateToc((p as Record<string, unknown>).toc),
    assets: {
      coverBg: p.assets?.coverBg ?? null,
      frame: p.assets?.frame ?? null,
      clientLogo: p.assets?.clientLogo ?? null
    },
    labels: { ...defaultLabels(), ...(p.labels || {}) },
    showRecipients: p.showRecipients === true,
    calloutIcons: p.calloutIcons !== false,
    diamondBullets: p.diamondBullets !== false,
    justify: typeof p.justify === 'boolean' ? p.justify : true,
    transclusions: p.transclusions === 'warn' ? 'warn' : 'inline',
    word: migrateWord(p.word)
  };
}

function migrateWord(raw: unknown): Preset['word'] {
  const w = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const styles: Preset['word']['styles'] = {};
  if (w.styles && typeof w.styles === 'object') {
    for (const [role, name] of Object.entries(w.styles as Record<string, unknown>)) {
      if (isWordRole(role) && typeof name === 'string' && name.trim()) styles[role] = name.trim();
    }
  }
  return { template: typeof w.template === 'string' && w.template.trim() ? w.template.trim() : null, styles };
}

/** Normalise whatever loadData() returned into a complete, current PluginData. */
export function migrateData(raw: unknown): PluginData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<PluginData>;
  const out = defaultData();

  out.presets = (Array.isArray(d.presets) ? d.presets : []).map(migratePreset);
  out.outputFolder = typeof d.outputFolder === 'string' ? d.outputFolder : '';
  out.filenameTemplate =
    typeof d.filenameTemplate === 'string' && d.filenameTemplate.trim()
      ? d.filenameTemplate
      : DEFAULT_FILENAME_TEMPLATE;
  out.conflictMode = (['ask', 'overwrite', 'increment'] as ConflictMode[]).includes(d.conflictMode as ConflictMode)
    ? (d.conflictMode as ConflictMode)
    : 'ask';
  out.rememberLast = d.rememberLast !== false;
  out.alwaysUseLast = d.alwaysUseLast === true;
  out.lastPresetId = typeof d.lastPresetId === 'string' ? d.lastPresetId : undefined;
  out.defaultContacts = Array.isArray(d.defaultContacts) ? d.defaultContacts : [];
  // Absent before 1.1: a first install and an upgrade both get the defaults.
  if (d.audienceLevels !== undefined) out.audienceLevels = normalizeLevels(d.audienceLevels);
  if (Array.isArray(d.profiles)) {
    out.profiles = d.profiles.map(migrateProfile).filter((p): p is ExportProfile => p !== null);
  }
  out.markConfidential = d.markConfidential !== false;
  out.logExports = d.logExports === true;

  // Seed the factory preset on first run. Once the user has templates of their
  // own, they are free to delete it.
  if (!out.presets.length) out.presets.push(defaultPreset({}));

  out.schemaVersion = CURRENT_SCHEMA_VERSION;
  return out;
}

/* ------------------------------------------------------------------ */
/* Frontmatter people and versions                                     */
/* ------------------------------------------------------------------ */

/** First non-empty value among `keys`, as text. */
function pickText(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = asText(o[k]);
    if (v.trim() !== '') return v;
  }
  return undefined;
}

/**
 * A contact or recipient as written in a note, in French or English keys
 * (`nom` / `name`, `poste` / `role`, `courriel` / `email`, `societe` /
 * `company`), mapped onto the shape the generator prints.
 */
export function normalizeContact(raw: unknown): DocContact {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    nom: pickText(o, ['nom', 'name']),
    poste: pickText(o, ['poste', 'role', 'title', 'position']),
    courriel: pickText(o, ['courriel', 'email', 'mail', 'e-mail']),
    societe: pickText(o, ['societe', 'société', 'company', 'organisation', 'organization'])
  };
}

/** A row of the status table, in French or English keys. */
export function normalizeVersion(raw: unknown): DocVersion {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    version: pickText(o, ['version']),
    date: pickText(o, ['date']),
    etat: pickText(o, ['etat', 'état', 'status', 'state', 'description', 'changes'])
  };
}

/**
 * True for a value naming an image this store wrote itself. Templates travel
 * between people as JSON, so a stored value is never trusted as a path: one
 * like `../../note.md` would otherwise be read on export and removed along
 * with the template.
 */
export function isStoredFile(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^assets\/[a-z0-9-]+\.(png|jpe?g)$/i.test(value);
}

/* ------------------------------------------------------------------ */
/* Output filename                                                     */
/* ------------------------------------------------------------------ */

/** Characters Windows and Obsidian both refuse in a file name. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/** Collapse a token value into something safe to put in a file name. */
export function sanitizeSegment(s: string): string {
  return String(s ?? '')
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
}

export interface FilenameContext {
  noteBasename: string;
  vars: Pick<ReportVars, 'docTitle' | 'client' | 'tlp' | 'versions'>;
  now?: Date;
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Expand a filename template. Unknown tokens are dropped rather than left
 * literal, and the result always falls back to the note name so a template made
 * entirely of empty tokens cannot produce a nameless file.
 */
export function renderFilename(template: string, ctx: FilenameContext): string {
  const now = ctx.now || new Date();
  const latest = ctx.vars.versions?.[ctx.vars.versions.length - 1];
  const tokens: Record<string, string> = {
    note: ctx.noteBasename,
    titre: ctx.vars.docTitle || ctx.noteBasename,
    title: ctx.vars.docTitle || ctx.noteBasename,
    client: ctx.vars.client || '',
    tlp: ctx.vars.tlp || '',
    date: isoDate(now),
    version: latest?.version || ''
  };

  const out = String(template || DEFAULT_FILENAME_TEMPLATE)
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => sanitizeSegment(tokens[key.toLowerCase()] ?? ''))
    // Tidy the separators left behind by tokens that resolved to nothing.
    .replace(/\s*[-–—]\s*(?=\s*[-–—]|$)/g, '')
    .replace(/^\s*[-–—]\s*/, '')
    .trim();

  return sanitizeSegment(out) || sanitizeSegment(ctx.noteBasename) || 'report';
}

/**
 * Next free name for `base` given the names already taken, e.g. "Report" ->
 * "Report-1". Used by the "increment" conflict mode.
 */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** Stable, readable id for a new preset. */
export function presetId(name: string): string {
  const slug = (name || 'preset')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip the combining marks NFD split off
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
  return (slug || 'preset') + '-' + Math.random().toString(36).slice(2, 7);
}
