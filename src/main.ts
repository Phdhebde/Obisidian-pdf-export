import {
  FileSystemAdapter,
  FileView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  getLanguage,
  normalizePath,
  type Editor,
  type MarkdownFileInfo,
  type MarkdownView
} from 'obsidian';
import { ReportSettingTab } from './settings.ts';
import { ConflictModal, PresetPickerModal, ProfilePickerModal } from './modals.ts';
import { AssetStore } from './assets.ts';
import { migrateData } from './storage.ts';
import {
  incrementedPath,
  presetFromFrontmatter,
  profileFromFrontmatter,
  redactionSummary,
  renderReport,
  reportWarnings,
  targetPath,
  writePdf,
  type ExportDeps
} from './exporter.ts';
import { getLocale, setLocale, t } from './i18n.ts';
import type { RedactionCounts } from './redact.ts';
import type { ConflictMode, DocContact, ExportProfile, PluginData, Preset } from './types.ts';
import type { PdfMake } from 'pdfmake/build/pdfmake.js';

/**
 * pdfmake's browser build (pdfkit + fontkit bundled). Loaded on first export,
 * so that a failure to initialise surfaces there rather than breaking plugin
 * load, and so Obsidian starts without paying for it.
 */
async function getPdfMake(): Promise<PdfMake> {
  return (await import('pdfmake/build/pdfmake.js')).default;
}

export default class PdfReportPlugin extends Plugin {
  data!: PluginData;
  assets!: AssetStore;

  async onload(): Promise<void> {
    setLocale(getLanguage());
    this.data = migrateData(await this.loadData());
    this.assets = new AssetStore(this.app, this.manifest);

    this.addSettingTab(new ReportSettingTab(this.app, this));

    this.addCommand({
      id: 'export-pdf-report',
      name: t('cmd.export'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.exportFile(file);
        return true;
      }
    });

    this.addCommand({
      id: 'preview-pdf-report',
      name: t('cmd.preview'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.previewFile(file);
        return true;
      }
    });

    this.addCommand({
      id: 'export-pdf-report-profile',
      name: t('cmd.exportProfile'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) {
          new ProfilePickerModal(this.app, this.data.profiles, (profile) => void this.exportFile(file, undefined, profile)).open();
        }
        return true;
      }
    });

    this.addCommand({
      id: 'export-all-versions',
      name: t('cmd.exportAll'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.exportAllVersions(file);
        return true;
      }
    });

    this.addCommand({
      id: 'export-selection-pdf-report',
      name: t('cmd.exportSelection'),
      editorCheckCallback: (checking, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        const sel = editor.getSelection();
        const file = ctx.file;
        if (!sel.trim() || !file || file.extension !== 'md') return false;
        if (!checking) void this.exportFile(file, sel);
        return true;
      }
    });

    this.addCommand({
      id: 'insert-report-frontmatter',
      name: t('cmd.insertFrontmatter'),
      editorCallback: (editor: Editor) => this.insertFrontmatter(editor)
    });

    this.addRibbonIcon('file-text', t('ribbon.export'), () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') {
        new Notice(t('notice.openMarkdown'));
        return;
      }
      void this.exportFile(file);
    });

    // Right-click in the file explorer: a note, or a whole folder.
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, item) => {
        if (item instanceof TFile && item.extension === 'md') {
          menu.addItem((mi) =>
            mi.setTitle(t('menu.exportNote')).setIcon('file-text').onClick(() => void this.exportFile(item))
          );
        } else if (item instanceof TFolder) {
          const notes = this.markdownFilesIn(item);
          if (!notes.length) return;
          menu.addItem((mi) =>
            mi
              .setTitle(t('menu.exportFolder', { count: notes.length }))
              .setIcon('folder-output')
              .onClick(() => void this.exportFolder(item))
          );
        }
      })
    );
  }

  /* ---------------------------------------------------------------- */
  /* Data                                                              */
  /* ---------------------------------------------------------------- */

  async saveSettings(): Promise<void> {
    await this.saveData(this.data);
  }

  private deps(): ExportDeps {
    return { app: this.app, data: this.data, assets: this.assets, getPdfMake };
  }

  getPreset(id?: string): Preset | undefined {
    return this.data.presets.find((p) => p.id === id) || this.data.presets[0];
  }

  private markdownFilesIn(folder: TFolder): TFile[] {
    const out: TFile[] = [];
    const walk = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === 'md') out.push(child);
        else if (child instanceof TFolder) walk(child);
      }
    };
    walk(folder);
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Preset selection                                                  */
  /* ---------------------------------------------------------------- */

  /** Resolve which preset to use, prompting only when it is genuinely ambiguous. */
  private async choosePreset(file: TFile): Promise<Preset | null> {
    const presets = this.data.presets;
    if (!presets.length) {
      new Notice(t('notice.noPreset'));
      return null;
    }

    // A note can pin its own template, which skips the prompt entirely.
    const pinned = presetFromFrontmatter(this.app, file, presets);
    if (pinned) return pinned;

    if (presets.length === 1) return presets[0];
    if (this.data.alwaysUseLast && this.data.lastPresetId) {
      const last = presets.find((p) => p.id === this.data.lastPresetId);
      if (last) return last;
    }

    return new Promise((resolve) => {
      new PresetPickerModal(
        this.app,
        presets,
        this.data.rememberLast ? this.data.lastPresetId : undefined,
        (result) => {
          if (!result) return resolve(null);
          if (result.remember) this.data.alwaysUseLast = true;
          this.data.lastPresetId = result.presetId;
          void this.saveSettings();
          resolve(presets.find((p) => p.id === result.presetId) || null);
        }
      ).open();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Export                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Export one version of a note. `profile` undefined means the one the note's
   * frontmatter names, or the full version when it names none.
   */
  async exportFile(file: TFile, selection?: string, profile?: ExportProfile | null): Promise<void> {
    const preset = await this.choosePreset(file);
    if (!preset) return;

    const notice = new Notice(t('notice.generating'), 0);
    try {
      const deps = this.deps();
      const chosen = profile === undefined ? profileFromFrontmatter(this.app, file, this.data.profiles) : profile;
      const result = await this.writeVersion(deps, file, preset, chosen, selection);
      if (!result) { notice.hide(); return; }

      await this.rememberPreset(preset);
      notice.hide();
      reportWarnings(result.warnings);
      if (chosen && result.redacted) new Notice(redactionSummary(chosen, result.redacted), 8000);
      this.noticeWithActions(t('notice.exported', { path: result.file.path }), result.file);
    } catch (e) {
      notice.hide();
      this.reportError(e, file);
    }
  }

  /** The full version, then one per profile, each under its own name. */
  async exportAllVersions(file: TFile): Promise<void> {
    const preset = await this.choosePreset(file);
    if (!preset) return;

    const notice = new Notice(t('notice.generating'), 0);
    const deps = this.deps();
    const written: TFile[] = [];
    const warnings = new Set<string>();
    const summaries: string[] = [];
    try {
      for (const profile of [null, ...this.data.profiles]) {
        const result = await this.writeVersion(deps, file, preset, profile);
        if (!result) continue;
        written.push(result.file);
        result.warnings.forEach((w) => warnings.add(w));
        if (profile && result.redacted) summaries.push(redactionSummary(profile, result.redacted));
      }
      await this.rememberPreset(preset);
    } catch (e) {
      // Stop at the first failure: a version that cannot be made safely must
      // not be silently missing from a set the user believes complete.
      this.reportError(e, file);
    } finally {
      notice.hide();
    }

    reportWarnings([...warnings]);
    if (summaries.length) new Notice(summaries.join('\n'), 8000);
    if (written.length) {
      this.noticeWithActions(
        t('notice.exportedMany', { count: written.length, paths: written.map((f) => f.path).join('\n') }),
        written[0]
      );
    }
  }

  /** Render one version and write it, asking about an existing file. Null when the user cancels. */
  private async writeVersion(
    deps: ExportDeps,
    file: TFile,
    preset: Preset,
    profile: ExportProfile | null,
    selection?: string
  ): Promise<{ file: TFile; warnings: string[]; redacted: RedactionCounts | null } | null> {
    const { bytes, vars, warnings, redacted } = await renderReport(deps, file, preset, profile, selection);
    let target = targetPath(deps, file, vars, profile);
    if (target.exists) {
      const mode = await this.resolveConflict(target.path);
      if (!mode) return null;
      if (mode === 'increment') target = { path: incrementedPath(deps, target.path), exists: false };
    }
    const written = await writePdf(deps, target.path, bytes);
    if (profile && redacted) await this.logExport(file, written, profile, redacted);
    return { file: written, warnings, redacted };
  }

  /**
   * One line in the export log, when the user asked for one: which note left,
   * under which name, and what was removed from it. The log never holds the
   * removed text itself.
   */
  private async logExport(source: TFile, written: TFile, profile: ExportProfile, counts: RedactionCounts): Promise<void> {
    if (!this.data.logExports) return;
    try {
      const folder = (this.data.outputFolder || '').trim().replace(/^\/+|\/+$/g, '');
      const name = `${t('log.file')}.md`;
      const path = normalizePath(folder ? `${folder}/${name}` : name);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const link = `[[${source.path.replace(/\.md$/, '')}|${source.basename}]]`;
      const line = `- ${stamp} — ${link} → ${written.path} — ${redactionSummary(profile, counts)}\n`;

      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.process(existing, (data) => (data.endsWith('\n') || !data ? data : data + '\n') + line);
      } else {
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        await this.app.vault.create(path, t('log.header') + line);
      }
    } catch (e) {
      // The PDF is written; a log that cannot be is not worth failing it for.
      console.warn('[PDF Report Exporter] export log not written', e);
    }
  }

  private async rememberPreset(preset: Preset): Promise<void> {
    if (!this.data.rememberLast) return;
    this.data.lastPresetId = preset.id;
    await this.saveSettings();
  }

  /** Ask what to do about an existing PDF, unless a mode is already chosen. */
  private resolveConflict(path: string): Promise<Exclude<ConflictMode, 'ask'> | null> {
    if (this.data.conflictMode !== 'ask') return Promise.resolve(this.data.conflictMode);
    return new Promise((resolve) => {
      new ConflictModal(this.app, path, (choice, remember) => {
        if (choice && remember) {
          this.data.conflictMode = choice;
          void this.saveSettings();
        }
        resolve(choice);
      }).open();
    });
  }

  async exportFolder(folder: TFolder): Promise<void> {
    const notes = this.markdownFilesIn(folder);
    if (!notes.length) return;

    const preset = await this.choosePreset(notes[0]);
    if (!preset) return;

    const progress = new Notice(t('notice.batchProgress', { count: notes.length }), 0);
    const deps = this.deps();
    const failures: string[] = [];
    let done = 0;

    for (const note of notes) {
      progress.setMessage(t('notice.batchStep', { done: done + 1, count: notes.length, name: note.basename }));
      try {
        const notePreset = presetFromFrontmatter(this.app, note, this.data.presets) || preset;
        const profile = profileFromFrontmatter(this.app, note, this.data.profiles);
        const { bytes, vars, redacted } = await renderReport(deps, note, notePreset, profile);
        // In batch, never prompt: a collision falls back to a numbered name
        // unless the user has explicitly chosen to overwrite.
        const target = targetPath(deps, note, vars, profile);
        const path =
          target.exists && this.data.conflictMode !== 'overwrite' ? incrementedPath(deps, target.path) : target.path;
        const written = await writePdf(deps, path, bytes);
        if (profile && redacted) await this.logExport(note, written, profile, redacted);
        done++;
      } catch (e) {
        console.error('[PDF Report Exporter] export failed:', note.path, e);
        failures.push(note.basename);
      }
    }

    progress.hide();
    new Notice(
      failures.length
        ? t('notice.batchFailures', {
            done,
            count: notes.length,
            names: failures.slice(0, 5).join(', ') + (failures.length > 5 ? '…' : '')
          })
        : t('notice.batchDone', { done, folder: this.data.outputFolder || t('notice.vaultRoot') }),
      failures.length ? 12000 : 6000
    );
  }

  /* ---------------------------------------------------------------- */
  /* Preview                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Render to a single reused file and open it in Obsidian's own PDF viewer,
   * so tuning a template needs no round trip through an external reader. It
   * deliberately writes a real vault file rather than a blob URL: Obsidian's
   * viewer is the only PDF renderer we can count on inside the app. The same
   * file is reused every time, so previewing never litters the vault.
   */
  async previewFile(file: TFile): Promise<void> {
    const preset = await this.choosePreset(file);
    if (!preset) return;

    const notice = new Notice(t('notice.generatingPreview'), 0);
    try {
      const deps = this.deps();
      const profile = profileFromFrontmatter(this.app, file, this.data.profiles);
      const { bytes, warnings } = await renderReport(deps, file, preset, profile);
      const folder = (this.data.outputFolder || '').trim().replace(/^\/+|\/+$/g, '');
      const name = t('preview.file');
      const path = normalizePath(folder ? `${folder}/${name}` : name);
      const written = await writePdf(deps, path, bytes);

      notice.hide();
      reportWarnings(warnings);
      // Reuse the leaf already showing the preview, so repeated previews do not
      // pile up tabs while iterating on a preset.
      const existing = this.app.workspace
        .getLeavesOfType('pdf')
        .find((leaf) => leaf.view instanceof FileView && leaf.view.file?.path === written.path);
      const leaf = existing || this.app.workspace.getLeaf('tab');
      await leaf.openFile(written);
      void this.app.workspace.revealLeaf(leaf);
    } catch (e) {
      notice.hide();
      this.reportError(e, file);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Frontmatter helper                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Insert a frontmatter skeleton, with its keys in the interface language —
   * the export reads French and English keys alike.
   */
  private insertFrontmatter(editor: Editor): void {
    if (/^---\r?\n/.test(editor.getValue())) {
      new Notice(t('notice.hasFrontmatter'));
      return;
    }
    const fr = getLocale() === 'fr';
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const date = fr ? `${dd}/${mm}/${today.getFullYear()}` : `${today.getFullYear()}-${mm}-${dd}`;
    const k = fr
      ? { title: 'titre', subtitle: 'sous_titre', acronym: 'acronyme', state: 'etat', name: 'nom', role: 'poste', email: 'courriel', company: 'societe', recipients: 'destinataires', created: 'Création du document' }
      : { title: 'title', subtitle: 'subtitle', acronym: 'acronym', state: 'status', name: 'name', role: 'role', email: 'email', company: 'company', recipients: 'recipients', created: 'Document created' };
    const q = (v: string | undefined) => JSON.stringify(v || '');
    const person = (c: DocContact) =>
      `  - ${k.name}: ${q(c.nom)}\n    ${k.role}: ${q(c.poste)}\n    ${k.email}: ${q(c.courriel)}`;
    const contacts = (this.data.defaultContacts.length ? this.data.defaultContacts : [{}]).map(person).join('\n');

    const block = [
      '---',
      `${k.title}: `,
      'client: ',
      `${k.subtitle}: `,
      `${k.acronym}: `,
      'versions:',
      '  - version: "1.0"',
      `    date: "${date}"`,
      `    ${k.state}: "${k.created}"`,
      'contacts:',
      contacts,
      // Left blank on purpose: entries with no content are ignored, so the
      // recipients table stays hidden until someone is actually named.
      `${k.recipients}:`,
      `  - ${k.name}: ""`,
      `    ${k.company}: ""`,
      `    ${k.email}: ""`,
      '---',
      ''
    ].join('\n');

    editor.replaceRange(block, { line: 0, ch: 0 });
    editor.setCursor({ line: 1, ch: k.title.length + 2 }); // land on the empty title value
  }

  /* ---------------------------------------------------------------- */
  /* Feedback                                                          */
  /* ---------------------------------------------------------------- */

  /** Success notice with "open" and "reveal" actions, so the PDF is one click away. */
  private noticeWithActions(message: string, file: TFile): void {
    const frag = createFragment();
    frag.createDiv({ text: message });
    const row = frag.createDiv({ cls: 'pdf-report-notice-actions' });

    const open = row.createEl('button', { text: t('notice.open') });
    open.addEventListener('click', () => void this.app.workspace.getLeaf('tab').openFile(file));

    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const reveal = row.createEl('button', { text: t('notice.reveal') });
      reveal.addEventListener('click', () => {
        try {
          window.require?.('electron').shell.showItemInFolder(adapter.getFullPath(file.path));
        } catch (e) {
          console.warn('[PDF Report Exporter] showItemInFolder unavailable', e);
        }
      });
    }
    new Notice(frag, 10000);
  }

  private reportError(e: unknown, file: TFile): void {
    console.error('[PDF Report Exporter] export error', file.path, e);
    const message = e instanceof Error ? e.message : String(e);
    new Notice(t('notice.error', { name: file.basename, message }), 10000);
  }
}
