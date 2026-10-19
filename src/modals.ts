import { App, FuzzySuggestModal, Modal, Setting, TFile } from 'obsidian';
import { sectionLabel, type ConflictMode, type Preset } from './types.ts';
import { t } from './i18n.ts';

/* ------------------------------------------------------------------ */
/* Vault file picker                                                   */
/* ------------------------------------------------------------------ */

/**
 * Choose a file from the vault, by fuzzy search over its path.
 *
 * This stands in for `<input type="file">`, which never opened its dialog from
 * inside the settings tab — neither detached nor attached to the document. A
 * vault picker is also the shape the rest of the plugin already has: exporting
 * a template writes its JSON into the vault, so importing reads it back from
 * the same place, and an image meant for a report usually lives there anyway.
 */
export class VaultFileModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private extensions: string[],
    placeholder: string,
    private onPick: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder(placeholder);
    this.setInstructions([
      { command: '↑↓', purpose: t('fileModal.navigate') },
      { command: '↵', purpose: t('fileModal.choose') },
      { command: 'esc', purpose: t('fileModal.cancel') }
    ]);
  }

  getItems(): TFile[] {
    const want = new Set(this.extensions.map((e) => e.toLowerCase()));
    return this.app.vault.getFiles().filter((f) => want.has((f.extension || '').toLowerCase()));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

/* ------------------------------------------------------------------ */
/* Confirmation                                                        */
/* ------------------------------------------------------------------ */

/** A yes/no gate for destructive actions. */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: { title: string; body: string; confirmText: string; onConfirm: () => void; danger?: boolean }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('pdf-report-modal');
    new Setting(contentEl).setName(this.opts.title).setHeading();
    contentEl.createEl('p', { text: this.opts.body });

    new Setting(contentEl)
      .addButton((b) => {
        b.setButtonText(this.opts.confirmText).onClick(() => this.confirm());
        if (this.opts.danger) b.setWarning();
        else b.setCta();
      })
      .addButton((b) => b.setButtonText(t('confirm.cancel')).onClick(() => this.close()));

    // Enter confirms; Escape cancels via the Modal's own handler.
    this.scope.register([], 'Enter', () => {
      this.confirm();
      return false;
    });
  }

  private confirm(): void {
    this.close();
    this.opts.onConfirm();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------------ */
/* Preset picker                                                       */
/* ------------------------------------------------------------------ */

export interface PickResult {
  presetId: string;
  /** The user asked not to be prompted again. */
  remember: boolean;
}

/** Choose the template to export with, by mouse or keyboard. */
export class PresetPickerModal extends Modal {
  private index = 0;
  private rows: HTMLElement[] = [];
  private ordered: Preset[] = [];
  private decided = false;
  private remember = false;

  constructor(
    app: App,
    private presets: Preset[],
    private defaultId: string | undefined,
    private onChoose: (result: PickResult | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('pdf-report-preset-picker');
    new Setting(contentEl).setName(t('picker.title')).setHeading();

    // Last used first, everything else in its stored order.
    this.ordered = [...this.presets].sort(
      (a, b) => Number(b.id === this.defaultId) - Number(a.id === this.defaultId)
    );

    for (const [i, p] of this.ordered.entries()) {
      const sections = (p.sections || []).map(sectionLabel).join(' · ');
      const s = new Setting(contentEl)
        .setName(p.name || p.id)
        .setDesc(p.id === this.defaultId ? `${sections} — ${t('picker.lastUsed')}` : sections);
      s.addButton((b) => b.setButtonText(t('picker.export')).setCta().onClick(() => this.choose(i)));
      s.settingEl.addClass('pdf-report-picker-row');
      s.settingEl.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).tagName !== 'BUTTON') this.focusRow(i);
      });
      this.rows.push(s.settingEl);
    }

    new Setting(contentEl)
      .setName(t('picker.dontAsk'))
      .setDesc(t('picker.dontAskDesc'))
      .addToggle((t) => t.setValue(false).onChange((v) => (this.remember = v)));

    contentEl.createEl('p', {
      cls: 'pdf-report-muted',
      text: t('picker.keys')
    });

    this.scope.register([], 'ArrowDown', () => { this.focusRow(this.index + 1); return false; });
    this.scope.register([], 'ArrowUp', () => { this.focusRow(this.index - 1); return false; });
    this.scope.register([], 'Enter', () => { this.choose(this.index); return false; });
    this.focusRow(0);
  }

  private focusRow(i: number): void {
    if (!this.rows.length) return;
    this.index = (i + this.rows.length) % this.rows.length;
    this.rows.forEach((el, n) => el.toggleClass('is-selected', n === this.index));
    this.rows[this.index].scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number): void {
    const p = this.ordered[i];
    if (!p) return;
    this.decided = true;
    this.onChoose({ presetId: p.id, remember: this.remember });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.onChoose(null);
  }
}

/* ------------------------------------------------------------------ */
/* Overwrite conflict                                                  */
/* ------------------------------------------------------------------ */

export type ConflictChoice = Exclude<ConflictMode, 'ask'> | null;

/**
 * What to do when the target PDF already exists. Overwriting silently could
 * quietly destroy a report that has already been sent out.
 */
export class ConflictModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private path: string,
    private onChoose: (choice: ConflictChoice, remember: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('pdf-report-modal');
    new Setting(contentEl).setName(t('conflict.title')).setHeading();
    contentEl.createEl('p', { text: this.path });

    let remember = false;
    new Setting(contentEl)
      .setName(t('conflict.remember'))
      .setDesc(t('conflict.rememberDesc'))
      .addToggle((t) => t.onChange((v) => (remember = v)));

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(t('conflict.overwrite')).setWarning().onClick(() => this.pick('overwrite', remember))
      )
      .addButton((b) =>
        b.setButtonText(t('conflict.keepBoth')).setCta().onClick(() => this.pick('increment', remember))
      )
      .addButton((b) => b.setButtonText(t('confirm.cancel')).onClick(() => this.close()));
  }

  private pick(choice: Exclude<ConflictMode, 'ask'>, remember: boolean): void {
    this.decided = true;
    this.onChoose(choice, remember);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.onChoose(null, false);
  }
}
