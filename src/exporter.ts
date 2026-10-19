/*
 * Export orchestration: note -> pdfmake document -> PDF bytes -> vault file.
 */
import { Notice, TFile, normalizePath, type App } from 'obsidian';
import type { PdfMake } from 'pdfmake/build/pdfmake.js';
import { buildDocDefinition, collectDiagrams, normalizeTlp, type PdfNode } from './generator.ts';
import { t, type MessageKey } from './i18n.ts';
import { ImageResolver, IMG_EXTS, loadVaultImage } from './images.ts';
import { renderMermaid } from './mermaid.ts';
import { flattenWikilinks, replaceOutsideCodeAsync, stripFrontmatter } from './textScan.ts';
import { normalizeContact, normalizeVersion, renderFilename, sanitizeSegment, uniqueName } from './storage.ts';
import {
  AudienceError,
  emptyCounts,
  framed,
  kept,
  noteMark,
  redact,
  totalRemoved,
  type AudienceFilter,
  type RedactionCounts
} from './redact.ts';
import {
  asText,
  hasContactContent,
  isSectionKey,
  type DocContact,
  type ExportProfile,
  type PluginData,
  type TlpKey,
  type Preset,
  type ReportVars,
  type SectionKey
} from './types.ts';
import type { AssetStore } from './assets.ts';

/** How deep `![[note]]` transclusions are followed before we stop. */
const MAX_TRANSCLUSION_DEPTH = 3;

export interface ExportDeps {
  app: App;
  data: PluginData;
  assets: AssetStore;
  getPdfMake: () => Promise<PdfMake>;
}

/* ------------------------------------------------------------------ */
/* Frontmatter -> variables                                            */
/* ------------------------------------------------------------------ */

/** Resolve a note's frontmatter into generator variables. FR and EN keys. */
export function parseVars(app: App, file: TFile): { vars: ReportVars; tlpWarning: string | null } {
  const cache = app.metadataCache.getFileCache(file);
  const fm: Record<string, unknown> = cache?.frontmatter || {};
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (fm[k] != null) return fm[k];
    return undefined;
  };

  const tlpRaw = pick('tlp', 'TLP');
  const declared = asText(tlpRaw).trim() !== '';
  const tlp = normalizeTlp(tlpRaw);

  // `destinataire` (singular) is an alias of `client`, so the recipients list
  // is the plural key. A singular key holding a list is accepted too, because
  // that mistake is easy to make.
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
  const rawRecipients = [pick('destinataires', 'recipients'), fm.destinataire, fm.recipient].find(Array.isArray);
  const recipients: DocContact[] = list(rawRecipients).map(normalizeContact).filter(hasContactContent);
  const text = (v: unknown, fallback = ''): string => asText(v) || fallback;

  const rawSections = pick('sections', 'sections_incluses');
  const sections: SectionKey[] | undefined = Array.isArray(rawSections)
    ? list(rawSections).map((s) => asText(s).trim().toLowerCase()).filter(isSectionKey)
    : undefined;

  const vars: ReportVars = {
    docTitle: text(pick('titre', 'docTitle', 'title'), file.basename),
    client: text(pick('client', 'client_code') ?? fm.destinataire),
    tlp: declared ? tlp.key : null,
    coverTitle: text(pick('coverTitle', 'titre', 'title'), file.basename),
    coverSubtitle: text(pick('sous_titre', 'sousTitre', 'coverSubtitle', 'subtitle')),
    coverSubtitle2: text(pick('acronyme', 'acronym', 'coverSubtitle2', 'subtitle2')),
    // Empty: the template's own label applies.
    tocTitle: text(pick('tocTitle', 'toc_title', 'sommaire_titre')),
    versions: list(pick('versions', 'statut', 'history')).map(normalizeVersion),
    contacts: list(pick('contacts')).map(normalizeContact),
    recipients,
    author: text(pick('auteur', 'author')),
    clientLogo: text(pick('logo', 'logo_client', 'clientLogo')).trim() || undefined,
    sections: sections && sections.length ? sections : undefined
  };

  return {
    vars,
    // A misspelt level would otherwise be silently downgraded — on a document
    // whose whole point is its handling marking.
    tlpWarning: tlp.recognised ? null : t('warn.tlp', { value: asText(tlpRaw), key: tlp.key })
  };
}

/** The preset named by the note's frontmatter, if it names one. */
export function presetFromFrontmatter(app: App, file: TFile, presets: Preset[]): Preset | null {
  const fm: Record<string, unknown> = app.metadataCache.getFileCache(file)?.frontmatter || {};
  const want = asText(fm.preset ?? fm.template ?? fm.modele).trim();
  if (!want) return null;
  const lower = want.toLowerCase();
  return presets.find((p) => p.id === want) || presets.find((p) => (p.name || '').toLowerCase() === lower) || null;
}

/**
 * The export profile the note's frontmatter names (`profile:`), if any. A name
 * that matches no profile is an error, not a full export: the author asked for
 * a restricted version.
 */
export function profileFromFrontmatter(app: App, file: TFile, profiles: ExportProfile[]): ExportProfile | null {
  const want = asText(frontmatterOf(app, file).profile ?? frontmatterOf(app, file).profil).trim();
  if (!want) return null;
  const lower = want.toLowerCase();
  const found = profiles.find((p) => p.id === want || p.name.toLowerCase() === lower);
  if (!found) throw new AudienceError(t('audience.unknownProfile', { name: want }));
  return found;
}

/**
 * What a version keeps. No profile is the full version. A profile's TLP
 * ceiling is the marking printed on it — its own, else the note's — and,
 * with neither, CLEAR: a passage marked with any TLP level then goes.
 */
export function audienceFilter(data: PluginData, profile: ExportProfile | null, noteTlp: TlpKey | null): AudienceFilter {
  return {
    levels: data.audienceLevels,
    keep: profile ? profile.keep : null,
    tlp: profile?.tlp ?? noteTlp ?? 'CLEAR',
    placeholder: profile?.placeholder ? t('audience.placeholder') : '',
    mark: data.markConfidential
  };
}

/* ------------------------------------------------------------------ */
/* Body assembly                                                       */
/* ------------------------------------------------------------------ */

/** The filter an export applies, and what it has removed so far. */
interface Audience {
  filter: AudienceFilter;
  counts: RedactionCounts;
}

function frontmatterOf(app: App, file: TFile): Record<string, unknown> {
  return app.metadataCache.getFileCache(file)?.frontmatter || {};
}

/**
 * What a note's frontmatter marks it with. An embedded note's `tlp:` counts
 * too; the exported note's own is the marking of the whole document.
 */
function markOf(app: App, file: TFile, filter: AudienceFilter, embedded: boolean) {
  return noteMark(frontmatterOf(app, file), filter, file.basename, embedded);
}

/**
 * Inline `![[note]]` transclusions, so a report can be assembled from section
 * notes instead of coming out full of link syntax.
 */
async function expandTransclusions(
  app: App,
  md: string,
  sourcePath: string,
  mode: Preset['transclusions'],
  audience: Audience,
  seen: Set<string>,
  depth: number
): Promise<string> {
  return replaceOutsideCodeAsync(md, /!\[\[\s*([^\][\n|]+?)\s*(?:\|[^\][\n]*)?\]\]/g, async (m) => {
    const target = m[1].trim();
    const file = app.metadataCache.getFirstLinkpathDest(target.replace(/[#^].*$/, ''), sourcePath);
    // Images are handled by ImageResolver; anything else is a note embed.
    if (!(file instanceof TFile) || IMG_EXTS.has(file.extension.toLowerCase())) return m[0];
    if (file.extension !== 'md') return `*[${t('inline.embedUnsupported', { target })}]*`;
    if (mode === 'warn') return `*[${t('inline.noteNotIncluded', { target })}]*`;
    if (depth >= MAX_TRANSCLUSION_DEPTH) return `*[${t('inline.depthExceeded', { target })}]*`;
    if (seen.has(file.path)) return `*[${t('inline.circular', { target })}]*`;
    // A note reserved for an audience this export leaves out goes whole, and
    // before it is read: none of it reaches the report.
    const mark = markOf(app, file, audience.filter, true);
    if (!kept(audience.filter, mark)) {
      audience.counts.notes++;
      return audience.filter.placeholder ? `*[${audience.filter.placeholder}]*` : '';
    }

    seen.add(file.path);
    try {
      const body = stripFrontmatter(await app.vault.cachedRead(file));
      const inlined = await expandTransclusions(app, body, file.path, mode, audience, seen, depth + 1);
      const marked = mark.levels.length > 0 || mark.tlp !== null;
      return audience.filter.mark && marked ? framed(inlined, mark) : inlined;
    } finally {
      seen.delete(file.path);
    }
  });
}

/**
 * Read a note and turn it into the Markdown the generator consumes.
 *
 * Confidential passages are cut here, after embedded notes are inlined and
 * before anything else reads the text: images, diagrams and links in a cut
 * passage are never loaded.
 */
export async function prepareBody(
  app: App,
  file: TFile,
  preset: Preset,
  profile: ExportProfile | null,
  filter: AudienceFilter,
  override?: string
): Promise<{ markdown: string; images: Record<string, string>; missing: string[]; counts: RedactionCounts }> {
  if (!kept(filter, markOf(app, file, filter, false))) {
    throw new AudienceError(t('audience.noteExcluded', { note: file.basename, profile: profile?.name ?? '' }));
  }
  const counts = emptyCounts();
  const raw = override ?? stripFrontmatter(await app.vault.cachedRead(file));
  const withNotes = await expandTransclusions(
    app, raw, file.path, preset.transclusions, { filter, counts }, new Set([file.path]), 0
  );
  const flattened = flattenWikilinks(redact(withNotes, filter, counts));
  const resolver = new ImageResolver(app);
  const { markdown, images, missing } = await resolver.resolve(flattened, file.path);
  return { markdown, images, missing, counts };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export interface RenderResult {
  bytes: ArrayBuffer;
  vars: ReportVars;
  warnings: string[];
  /** What the profile removed; null for a full export. */
  redacted: RedactionCounts | null;
}

/**
 * Turn a document definition into PDF bytes.
 *
 * Deliberately *not* `createPdf(dd).getBlob(cb)`: pdfmake's callback API builds
 * the document inside a promise continuation (`_createDoc` -> `urlResolver
 * .resolved().then(...)`), so a layout error becomes an unhandled rejection and
 * the callback simply never fires. The caller's progress notice would then hang
 * forever with no message on any malformed document.
 *
 * `getStream()` with no callback returns the PDFKit document synchronously, so
 * a build error propagates to the try/catch, and stream errors surface too. We
 * do not need pdfmake's URL resolution: fonts come from its vfs and images are
 * already data URLs.
 */
function toPdfBytes(pdfMake: PdfMake, dd: PdfNode): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const doc = pdfMake.createPdf(dd).getStream();
    const chunks: Uint8Array[] = [];
    doc.on('readable', () => {
      let chunk: Uint8Array | null;
      while ((chunk = doc.read(Number.MAX_SAFE_INTEGER)) !== null) chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      resolve(out.buffer);
    });
    doc.end();
  });
}

/**
 * Build the PDF bytes for a note. Does not touch the vault.
 *
 * `profile` restricts the export to one audience; null is the full version.
 */
export async function renderReport(
  deps: ExportDeps,
  file: TFile,
  preset: Preset,
  profile: ExportProfile | null,
  override?: string
): Promise<RenderResult> {
  const parsed = parseVars(deps.app, file);
  const filter = audienceFilter(deps.data, profile, parsed.vars.tlp);
  const { markdown, images, missing, counts } = await prepareBody(deps.app, file, preset, profile, filter, override);

  const pdfMake = await deps.getPdfMake();
  deps.assets.ensureFonts(pdfMake);

  const vars: ReportVars = profile?.tlp ? { ...parsed.vars, tlp: profile.tlp } : parsed.vars;
  const tlpWarning = profile?.tlp ? null : parsed.tlpWarning;
  const resolved = await deps.assets.resolvePreset(preset);

  // A `logo:` in the note wins over the one the template carries; naming one
  // that cannot be found is worth saying out loud rather than silently
  // falling back to the template's.
  const noteLogo = vars.clientLogo ? await loadVaultImage(deps.app, vars.clientLogo, file.path) : null;
  const logoWarning = vars.clientLogo && !noteLogo ? t('warn.logo', { path: vars.clientLogo }) : null;

  const { diagrams, failed } = await renderMermaid(collectDiagrams(markdown, resolved));

  const build = (withDiagrams: boolean): PdfNode =>
    buildDocDefinition(markdown, vars, resolved, {
      images,
      clientLogo: noteLogo,
      diagrams: withDiagrams ? diagrams : undefined
    });

  const warnings: string[] = [];
  let bytes: ArrayBuffer;
  try {
    bytes = await toPdfBytes(pdfMake, build(true));
  } catch (e) {
    // A drawing pdfkit cannot handle must not cost the whole report: print
    // the diagrams as code, and say so.
    if (!Object.keys(diagrams).length) throw e;
    console.warn('[PDF Report Exporter] export failed with diagrams, retrying without:', e);
    bytes = await toPdfBytes(pdfMake, build(false));
    warnings.push(t('warn.diagramsAsCode', { message: e instanceof Error ? e.message : String(e) }));
  }

  if (tlpWarning) warnings.push(tlpWarning);
  if (logoWarning) warnings.push(logoWarning);
  if (failed) {
    warnings.push(failed === 1 ? t('warn.diagramFailed') : t('warn.diagramsFailed', { count: failed }));
  }
  if (missing.length) {
    warnings.push(
      missing.length === 1
        ? t('warn.imageMissing', { path: missing[0] })
        : t('warn.imagesMissing', { count: missing.length, paths: missing.slice(0, 3).join(', ') })
    );
  }
  return { bytes, vars, warnings, redacted: profile ? counts : null };
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export interface SaveTarget {
  path: string;
  exists: boolean;
}

/** Where a note's PDF would go, honouring the folder, the filename template and the profile's suffix. */
export function targetPath(deps: ExportDeps, file: TFile, vars: ReportVars, profile: ExportProfile | null): SaveTarget {
  const folder = (deps.data.outputFolder || '').trim().replace(/^\/+|\/+$/g, '');
  const suffix = profile ? sanitizeSegment(profile.suffix) : '';
  const base = renderFilename(deps.data.filenameTemplate, { noteBasename: file.basename, vars }) + suffix;
  const path = normalizePath(folder ? `${folder}/${base}.pdf` : `${base}.pdf`);
  return { path, exists: deps.app.vault.getAbstractFileByPath(path) instanceof TFile };
}

/** Path that avoids clobbering an existing PDF ("Report" -> "Report-1"). */
export function incrementedPath(deps: ExportDeps, path: string): string {
  const dot = path.lastIndexOf('.');
  const stem = path.slice(0, dot);
  const ext = path.slice(dot);
  return uniqueName(stem, (name) => deps.app.vault.getAbstractFileByPath(name + ext) != null) + ext;
}

export async function writePdf(deps: ExportDeps, path: string, bytes: ArrayBuffer): Promise<TFile> {
  const folder = path.split('/').slice(0, -1).join('/');
  if (folder && !deps.app.vault.getAbstractFileByPath(folder)) {
    try {
      await deps.app.vault.createFolder(folder);
    } catch {
      /* created concurrently */
    }
  }
  const existing = deps.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await deps.app.vault.modifyBinary(existing, bytes);
    return existing;
  }
  return deps.app.vault.createBinary(path, bytes);
}

/** "Profile “Client”: 5 passages removed (2 sections, 3 phrases)." */
export function redactionSummary(profile: ExportProfile, c: RedactionCounts): string {
  const part = (n: number, one: MessageKey, many: MessageKey) => (n === 1 ? t(one) : t(many, { count: n }));
  const parts: string[] = [];
  if (c.notes) parts.push(part(c.notes, 'audience.note', 'audience.notes'));
  if (c.sections) parts.push(part(c.sections, 'audience.section', 'audience.sections'));
  if (c.blocks) parts.push(part(c.blocks, 'audience.block', 'audience.blocks'));
  if (c.phrases) parts.push(part(c.phrases, 'audience.phrase', 'audience.phrases'));
  return totalRemoved(c)
    ? t('audience.removed', { profile: profile.name, detail: parts.join(', ') })
    : t('audience.removedNone', { profile: profile.name });
}

/** Surface any non-fatal issues from the render as a single notice. */
export function reportWarnings(warnings: string[]): void {
  if (warnings.length) new Notice(t('notice.warnings', { warnings: warnings.join('\n') }), 8000);
}
