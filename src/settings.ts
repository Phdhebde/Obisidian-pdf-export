import { App, Notice, PluginSettingTab, Setting, TFile, debounce, normalizePath } from 'obsidian';
import type PdfReportPlugin from './main.ts';
import { ConfirmModal, VaultFileModal } from './modals.ts';
import { IMG_EXTS, loadVaultImage } from './images.ts';
import { migratePreset, presetId } from './storage.ts';
import {
  DEFAULT_BODY_SIZE,
  DEFAULT_PAGINATION,
  MAX_BODY_SIZE,
  MIN_BODY_SIZE,
  defaultLabels,
  defaultToc,
  headingLabel,
  numberingOptions,
  paginationPresets,
  renderPagination
} from './generator.ts';
import type { PresetImageKey } from './assets.ts';
import { t, type MessageKey } from './i18n.ts';
import {
  HEADING_LEVELS,
  SECTION_KEYS,
  sectionLabel,
  type ConflictMode,
  type NumberingStyle,
  type Preset,
  type PresetColors,
  type PresetLabels,
  type SectionKey
} from './types.ts';

/** Dropdown value standing for "write your own template". */
const PAGINATION_CUSTOM = '\u0000custom';

/** Every image slot a preset owns — walked whenever they move together. */
const PRESET_IMAGE_KEYS: PresetImageKey[] = ['coverBg', 'frame', 'clientLogo'];

/** Marks a JSON file as a shared template. */
const PRESET_FILE_MARK = 'pdfReportPreset';
const PRESET_FILE_SUFFIX = '.report-template.json';

const FONT_KEYS = ['Liberation', 'Archivo', 'LiberationMono'] as const;

const CONFLICT_OPTIONS: [ConflictMode, MessageKey][] = [
  ['ask', 'conflict.ask'],
  ['increment', 'conflict.increment'],
  ['overwrite', 'conflict.overwriteOpt']
];

const COLOR_KEYS: (keyof PresetColors)[] = [
  'brand',
  'banner',
  'dark',
  'headerText',
  'footerText',
  'tableHeaderBg',
  'tableHeaderText',
  'tableBodyBg',
  'tableBorder',
  'link',
  'tocTitle',
  'text'
];

const LABEL_KEYS: (keyof PresetLabels)[] = [
  'references',
  'status',
  'versionColumn',
  'versionDate',
  'versionState',
  'contacts',
  'contactColumn',
  'contactRole',
  'contactEmail',
  'recipients',
  'recipientColumn',
  'recipientRole',
  'recipientEmail',
  'tlpReminder',
  'tlpReminderSubtitle',
  'toc'
];

export class ReportSettingTab extends PluginSettingTab {
  private editing: string | null = null;
  /** Sticky while the pagination dropdown is on "Custom", so that typing a
   *  format that happens to match a ready-made one does not make the text
   *  field vanish under the caret. */
  private customPagination = false;
  private showLabels = false;

  /** Coalesce writes: dragging a colour picker fires an event per pixel. */
  private save = debounce(() => void this.plugin.saveSettings(), 400, false);

  constructor(app: App, private plugin: PdfReportPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    // Every change re-renders the whole tab, and emptying it drops the scroll
    // position. Which element scrolls depends on the Obsidian version — the
    // tab itself or its parent — so both are put back where they were.
    const scrollers = [containerEl, containerEl.parentElement].filter((el): el is HTMLElement => el !== null);
    const offsets = scrollers.map((el) => el.scrollTop);
    containerEl.empty();
    containerEl.addClass('pdf-report-settings');

    if (!this.editing || !this.plugin.data.presets.some((p) => p.id === this.editing)) {
      this.editing = this.plugin.data.presets[0]?.id ?? null;
    }

    this.renderGlobal(containerEl);
    this.renderPresetSelector(containerEl);

    const preset = this.plugin.data.presets.find((p) => p.id === this.editing);
    if (preset) this.renderEditor(containerEl, preset);

    scrollers.forEach((el, i) => { el.scrollTop = offsets[i]; });
  }

  /* ================================================================ */
  /* Global settings                                                   */
  /* ================================================================ */

  private renderGlobal(c: HTMLElement): void {
    new Setting(c)
      .setName(t('set.outputFolder'))
      .setDesc(t('set.outputFolderDesc'))
      .addText((tx) =>
        tx
          .setPlaceholder('Reports/PDF')
          .setValue(this.plugin.data.outputFolder)
          .onChange((v) => {
            this.plugin.data.outputFolder = v.trim();
            this.save();
          })
      );

    new Setting(c)
      .setName(t('set.filename'))
      .setDesc(t('set.filenameDesc'))
      .addText((tx) =>
        tx
          .setPlaceholder('{{note}}')
          .setValue(this.plugin.data.filenameTemplate)
          .onChange((v) => {
            this.plugin.data.filenameTemplate = v;
            this.save();
          })
      );

    new Setting(c).setName(t('set.conflict')).addDropdown((d) => {
      for (const [k, label] of CONFLICT_OPTIONS) d.addOption(k, t(label));
      d.setValue(this.plugin.data.conflictMode).onChange((v) => {
        this.plugin.data.conflictMode = v as ConflictMode;
        this.save();
      });
    });

    new Setting(c).setName(t('set.templates')).setHeading();

    new Setting(c)
      .setName(t('set.rememberLast'))
      .setDesc(t('set.rememberLastDesc'))
      .addToggle((tg) =>
        tg.setValue(this.plugin.data.rememberLast).onChange((v) => {
          this.plugin.data.rememberLast = v;
          this.save();
        })
      );

    new Setting(c)
      .setName(t('set.alwaysUseLast'))
      .setDesc(t('set.alwaysUseLastDesc'))
      .addToggle((tg) =>
        tg.setValue(this.plugin.data.alwaysUseLast).onChange((v) => {
          this.plugin.data.alwaysUseLast = v;
          this.save();
        })
      );

    new Setting(c)
      .setName(t('set.defaultContacts'))
      .setDesc(t('set.defaultContactsDesc'))
      .addTextArea((ta) => {
        ta.inputEl.rows = 3;
        ta.setPlaceholder(t('set.defaultContactsPlaceholder'))
          .setValue(this.plugin.data.defaultContacts.map((x) => [x.nom, x.poste, x.courriel].join(' | ')).join('\n'))
          .onChange((v) => {
            this.plugin.data.defaultContacts = v
              .split('\n')
              .map((line) => line.split('|').map((s) => s.trim()))
              .filter((parts) => parts.some(Boolean))
              .map(([nom, poste, courriel]) => ({ nom: nom || '', poste: poste || '', courriel: courriel || '' }));
            this.save();
          });
      });
  }

  /* ================================================================ */
  /* Preset CRUD                                                       */
  /* ================================================================ */

  private renderPresetSelector(c: HTMLElement): void {
    new Setting(c)
      .setName(t('set.editTemplate'))
      .setDesc(t('set.editTemplateDesc'))
      .addDropdown((d) => {
        for (const p of this.plugin.data.presets) d.addOption(p.id, p.name || p.id);
        d.setValue(this.editing ?? '');
        d.onChange((v) => {
          this.editing = v;
          this.display();
        });
      })
      .addExtraButton((b) => b.setIcon('plus').setTooltip(t('set.newTemplate')).onClick(() => void this.newPreset()))
      .addExtraButton((b) => b.setIcon('copy').setTooltip(t('set.duplicate')).onClick(() => void this.duplicate()))
      .addExtraButton((b) =>
        b.setIcon('download').setTooltip(t('set.exportJson')).onClick(() => void this.exportPreset())
      )
      .addExtraButton((b) => b.setIcon('upload').setTooltip(t('set.importJson')).onClick(() => this.importPreset()))
      .addExtraButton((b) => b.setIcon('trash').setTooltip(t('set.delete')).onClick(() => this.deletePreset()));
  }

  /** A new template starts from the factory defaults, not from another one. */
  private async newPreset(): Promise<void> {
    const preset = migratePreset({});
    preset.id = presetId('template');
    preset.name = t('set.newTemplateName');
    this.plugin.data.presets.push(preset);
    this.editing = preset.id;
    await this.plugin.saveSettings();
    this.display();
  }

  private async duplicate(): Promise<void> {
    const cur = this.plugin.data.presets.find((p) => p.id === this.editing);
    if (!cur) return;
    const copy = structuredClone(cur);
    copy.id = presetId(cur.name);
    copy.name = t('set.copySuffix', { name: cur.name || t('set.templateFallback') });
    // Its own copy of the artwork, so deleting either preset leaves the other intact.
    for (const key of PRESET_IMAGE_KEYS) {
      copy.assets[key] = await this.plugin.assets.copyCustomImage(copy.id, key, cur.assets[key]);
    }
    this.plugin.data.presets.push(copy);
    this.editing = copy.id;
    await this.plugin.saveSettings();
    this.display();
  }

  private deletePreset(): void {
    const presets = this.plugin.data.presets;
    if (presets.length <= 1) {
      new Notice(t('set.cannotDeleteLast'));
      return;
    }
    const cur = presets.find((p) => p.id === this.editing);
    if (!cur) return;

    new ConfirmModal(this.app, {
      title: t('set.deleteTitle'),
      body: t('set.deleteBody', { name: cur.name }),
      confirmText: t('set.deleteConfirm'),
      danger: true,
      onConfirm: () => {
        for (const key of PRESET_IMAGE_KEYS) void this.plugin.assets.removeCustomImage(cur.assets[key]);
        presets.splice(presets.indexOf(cur), 1);
        this.editing = presets[0].id;
        void this.plugin.saveSettings();
        this.display();
      }
    }).open();
  }

  /**
   * Templates are shared by file: exporting inlines the images so the JSON is
   * self-contained, and the receiver imports it from their own vault.
   */
  private async exportPreset(): Promise<void> {
    const cur = this.plugin.data.presets.find((p) => p.id === this.editing);
    if (!cur) return;
    try {
      const resolved = await this.plugin.assets.resolvePreset(cur);
      const folder = this.plugin.data.outputFolder.trim().replace(/^\/+|\/+$/g, '');
      const name = (cur.name || cur.id).replace(/[\\/:*?"<>|#^[\]]/g, '-');
      const file = name + PRESET_FILE_SUFFIX;
      const path = normalizePath(folder ? `${folder}/${file}` : file);
      const payload = JSON.stringify({ [PRESET_FILE_MARK]: 1, preset: resolved }, null, 2);
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.modify(existing, payload);
      else await this.app.vault.create(path, payload);
      new Notice(t('set.exportedTo', { path }));
    } catch (e) {
      new Notice(t('set.exportFailed', { message: e instanceof Error ? e.message : String(e) }));
    }
  }

  private importPreset(): void {
    new VaultFileModal(this.app, ['json'], t('set.importPlaceholder'), (file) => void this.applyPresetFile(file)).open();
  }

  private async applyPresetFile(file: TFile): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await this.app.vault.read(file));
      // A bare preset object is accepted too, as is any `{ preset }` wrapper.
      const raw = parsed && typeof parsed === 'object' && 'preset' in parsed ? parsed.preset : parsed;
      const preset = migratePreset(raw);
      preset.id = presetId(preset.name);
      preset.name = t('set.importedSuffix', { name: preset.name });
      // Inlined images become plugin-folder files, keeping data.json small.
      for (const key of PRESET_IMAGE_KEYS) {
        preset.assets[key] = await this.materialise(preset.id, key, preset.assets[key]);
      }
      this.plugin.data.presets.push(preset);
      this.editing = preset.id;
      await this.plugin.saveSettings();
      new Notice(t('set.imported', { name: preset.name }));
      this.display();
    } catch (e) {
      console.error('[PDF Report Exporter] template import', e);
      new Notice(t('set.importInvalid', { message: e instanceof Error ? e.message : String(e) }));
    }
  }

  /**
   * Turn an inline data URL into a file next to the plugin. Anything else — a
   * path from someone else's install, or worse — is dropped.
   */
  private async materialise(id: string, key: PresetImageKey, value: string | null): Promise<string | null> {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(value || '');
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpg';
    return this.plugin.assets.saveCustomImage(id, key, bytes.buffer, ext);
  }

  /* ================================================================ */
  /* Preset editor                                                     */
  /* ================================================================ */

  private renderEditor(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.identity')).setHeading();
    new Setting(c).setName(t('set.templateName')).addText((tx) =>
      tx.setValue(preset.name).onChange((v) => {
        preset.name = v;
        this.save();
      })
    );

    this.renderSections(c, preset);
    this.renderHeadings(c, preset);
    this.renderColors(c, preset);
    this.renderTypography(c, preset);
    this.renderCover(c, preset);
    this.renderHeaderFooter(c, preset);
    this.renderTlp(c, preset);
    this.renderLabels(c, preset);
    this.renderAssets(c, preset);
  }

  /** Section toggles, with ordering. Order drives the page sequence. */
  private renderSections(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.sections')).setHeading();
    c.createEl('p', { cls: 'pdf-report-muted', text: t('set.sectionsDesc') });

    const move = (key: SectionKey, delta: number) => {
      const i = preset.sections.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= preset.sections.length) return;
      [preset.sections[i], preset.sections[j]] = [preset.sections[j], preset.sections[i]];
      void this.plugin.saveSettings();
      this.display();
    };

    // Enabled sections first, in their configured order, then the disabled ones.
    const ordered: SectionKey[] = [
      ...preset.sections,
      ...SECTION_KEYS.filter((k) => !preset.sections.includes(k))
    ];

    for (const key of ordered) {
      const enabled = preset.sections.includes(key);
      const s = new Setting(c).setName(sectionLabel(key)).setDesc(t(`sectionHint.${key}` as MessageKey));
      if (enabled && key !== 'cover') {
        s.addExtraButton((b) => b.setIcon('chevron-up').setTooltip(t('set.moveUp')).onClick(() => move(key, -1)));
        s.addExtraButton((b) => b.setIcon('chevron-down').setTooltip(t('set.moveDown')).onClick(() => move(key, 1)));
      }
      s.addToggle((tg) =>
        tg.setValue(enabled).onChange((v) => {
          if (v) {
            if (!preset.sections.includes(key)) preset.sections.push(key);
          } else {
            preset.sections = preset.sections.filter((k) => k !== key);
          }
          void this.plugin.saveSettings();
          this.display();
        })
      );
    }

    new Setting(c)
      .setName(t('set.recipients'))
      .setDesc(t('set.recipientsDesc'))
      .addToggle((tg) =>
        tg.setValue(preset.showRecipients).onChange((v) => {
          preset.showRecipients = v;
          this.save();
        })
      );
  }

  /**
   * One row per Markdown heading level: how it is numbered, whether it reaches
   * the table of contents, and whether it starts a new page.
   *
   * They belong together because they are the same question asked three ways —
   * how much structure the report shows — and because the number is part of
   * the text pdfmake copies into the table of contents.
   */
  private renderHeadings(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.headings')).setHeading();
    c.createEl('p', { cls: 'pdf-report-muted', text: t('set.headingsDesc') });

    const toc = preset.toc;

    new Setting(c)
      .setName(t('set.hierarchical'))
      .setDesc(t('set.hierarchicalDesc'))
      .addToggle((tg) =>
        tg.setValue(toc.hierarchical).onChange((v) => {
          toc.hierarchical = v;
          void this.plugin.saveSettings();
          this.display();
        })
      );

    // The sample shows each level as the second of its kind under second
    // parents, so a chained number is visibly different from a plain one.
    const sampleCounters = new Array<number>(HEADING_LEVELS).fill(2);
    for (let i = 0; i < HEADING_LEVELS; i++) {
      const sample = headingLabel(toc, sampleCounters, i) + t('set.headingSample');
      new Setting(c)
        .setName(t('set.level', { n: i + 1, hashes: '#'.repeat(i + 1) }))
        .setDesc(t('set.levelPreview', { sample }))
        .addDropdown((d) => {
          for (const o of numberingOptions()) d.addOption(o.value, o.label);
          d.setValue(toc.numbering[i]).onChange((v) => {
            toc.numbering[i] = v as NumberingStyle;
            void this.plugin.saveSettings();
            this.display();
          });
          captioned(d.selectEl, t('set.numbering'));
        })
        .addToggle((tg) => {
          tg.setTooltip(t('set.contentsTip'))
            .setValue(toc.levels[i])
            .onChange((v) => {
              toc.levels[i] = v;
              void this.plugin.saveSettings();
              this.display();
            });
          captioned(tg.toggleEl, t('set.contents'));
        })
        .addToggle((tg) => {
          tg.setTooltip(t('set.newPageTip'))
            .setValue(toc.pageBreak[i])
            .onChange((v) => {
              toc.pageBreak[i] = v;
              void this.plugin.saveSettings();
              this.display();
            });
          captioned(tg.toggleEl, t('set.newPage'));
        });
    }

    // A table of contents with nothing to list comes out as a bare title, and
    // that is a confusing thing to discover in a finished PDF.
    if (preset.sections.includes('toc') && !toc.levels.some(Boolean)) {
      c.createEl('p', { cls: 'pdf-report-muted pdf-report-warn', text: t('set.emptyToc') });
    }

    new Setting(c)
      .setName(t('set.resetNumbering'))
      .setDesc(t('set.resetNumberingDesc'))
      .addButton((b) =>
        b.setButtonText(t('set.reset')).onClick(() => {
          preset.toc = defaultToc();
          void this.plugin.saveSettings();
          this.display();
        })
      );
  }

  private renderColors(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.colors')).setHeading();
    for (const key of COLOR_KEYS) {
      this.color(c, t(`color.${key}` as MessageKey), () => preset.colors[key], (v) => (preset.colors[key] = v));
    }
  }

  private renderTypography(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.typography')).setHeading();

    const fontDropdown = (name: MessageKey, get: () => string, set: (v: string) => void) =>
      new Setting(c).setName(t(name)).addDropdown((d) => {
        for (const k of FONT_KEYS) d.addOption(k, t(`font.${k}` as MessageKey));
        d.setValue(get()).onChange((v) => {
          set(v);
          this.save();
        });
      });
    fontDropdown('set.bodyFont', () => preset.fonts.bodyFont, (v) => (preset.fonts.bodyFont = v));
    fontDropdown('set.headingFont', () => preset.fonts.headingFont, (v) => (preset.fonts.headingFont = v));

    new Setting(c)
      .setName(t('set.bodySize'))
      .setDesc(t('set.bodySizeDesc', { size: DEFAULT_BODY_SIZE }))
      .addSlider((sl) =>
        sl
          .setLimits(MIN_BODY_SIZE, MAX_BODY_SIZE, 0.5)
          .setValue(preset.fonts.bodySize)
          .setDynamicTooltip()
          .onChange((v) => {
            preset.fonts.bodySize = v;
            this.save();
          })
      )
      .addExtraButton((b) =>
        b
          .setIcon('reset')
          .setTooltip(t('set.bodySizeReset', { size: DEFAULT_BODY_SIZE }))
          .onClick(() => {
            preset.fonts.bodySize = DEFAULT_BODY_SIZE;
            void this.plugin.saveSettings();
            this.display();
          })
      );

    this.toggle(c, 'set.calloutIcons', 'set.calloutIconsDesc', () => preset.calloutIcons, (v) => (preset.calloutIcons = v));
    this.toggle(c, 'set.justify', 'set.justifyDesc', () => preset.justify, (v) => (preset.justify = v));
    this.toggle(c, 'set.diamondBullets', 'set.diamondBulletsDesc', () => preset.diamondBullets, (v) => (preset.diamondBullets = v));

    new Setting(c)
      .setName(t('set.transclusions'))
      .setDesc(t('set.transclusionsDesc'))
      .addDropdown((d) => {
        d.addOption('inline', t('set.transclusionsInline'));
        d.addOption('warn', t('set.transclusionsWarn'));
        d.setValue(preset.transclusions).onChange((v) => {
          preset.transclusions = v === 'warn' ? 'warn' : 'inline';
          this.save();
        });
      });

    new Setting(c)
      .setName(t('set.margins'))
      .setDesc(t('set.marginsDesc'))
      .addText((tx) =>
        tx.setValue(preset.layout.pageMargins.join(', ')).onChange((v) => {
          const arr = v.split(',').map((x) => parseInt(x.trim(), 10));
          if (arr.length === 4 && arr.every((n) => !isNaN(n) && n >= 0)) {
            preset.layout.pageMargins = arr as [number, number, number, number];
            this.save();
          }
        })
      );
  }

  /**
   * Where the cover text sits on the page.
   *
   * Everything here is an absolute position in points, measured from the
   * top-left corner of the A4 page — the cover is drawn over a full-page
   * background, so there is no flow to hang it off.
   */
  private renderCover(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.cover')).setHeading();
    c.createEl('p', { cls: 'pdf-report-muted', text: t('set.coverDesc') });

    const cv = preset.layout.cover;

    this.num(c, 'cover.x', 'cover.xDesc', () => cv.x, (v) => { cv.x = v; }, 0, 595);
    this.num(c, 'cover.titleY', 'cover.titleYDesc', () => cv.titleY, (v) => { cv.titleY = v; }, 0, 842);
    this.num(c, 'cover.titleSize', 'cover.titleSizeDesc', () => cv.titleSize, (v) => { cv.titleSize = v; }, 8, 96);
    this.num(c, 'cover.titleMaxChars', 'cover.titleMaxCharsDesc',
      () => cv.titleMaxChars, (v) => { cv.titleMaxChars = v; }, 4, 80);

    new Setting(c)
      .setName(t('cover.rule'))
      .setDesc(t('cover.ruleDesc'))
      .addToggle((tg) =>
        tg.setValue(cv.showRule).onChange((v) => {
          cv.showRule = v;
          void this.plugin.saveSettings();
          this.display();
        })
      );

    // Its position and width mean nothing while it is hidden.
    if (cv.showRule) {
      this.num(c, 'cover.ruleY', 'cover.ruleYDesc', () => cv.ruleY, (v) => { cv.ruleY = v; }, 0, 842);
      this.num(c, 'cover.ruleW', null, () => cv.ruleW, (v) => { cv.ruleW = v; }, 0, 595);
    }

    this.num(c, 'cover.subtitleY', 'cover.subtitleYDesc', () => cv.subtitleY, (v) => { cv.subtitleY = v; }, 0, 842);
    this.num(c, 'cover.subtitleSize', null, () => cv.subtitleSize, (v) => { cv.subtitleSize = v; }, 6, 60);
    this.num(c, 'cover.acronymY', 'cover.acronymYDesc', () => cv.acronymY, (v) => { cv.acronymY = v; }, 0, 842);
    this.num(c, 'cover.acronymSize', null, () => cv.acronymSize, (v) => { cv.acronymSize = v; }, 6, 60);
    this.num(c, 'cover.logoX', 'cover.logoXDesc', () => cv.logoX, (v) => { cv.logoX = v; }, 0, 595);
    this.num(c, 'cover.logoY', null, () => cv.logoY, (v) => { cv.logoY = v; }, 0, 842);
    this.num(c, 'cover.logoW', 'cover.logoWDesc', () => cv.logoW, (v) => { cv.logoW = v; }, 10, 595);
  }

  /**
   * What goes in the header and footer bands.
   *
   * Sizes are deliberately not exposed: unlike the body text, the header and
   * footer have a band of a fixed height to fit into.
   */
  private renderHeaderFooter(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.headerFooter')).setHeading();
    c.createEl('p', { cls: 'pdf-report-muted', text: t('set.headerFooterDesc') });

    const L = preset.layout;
    const presets = paginationPresets();
    const known = presets.find((o) => o.template === L.pagination);
    const custom = this.customPagination || !known;
    const sample = renderPagination(L.pagination, 3, 12) || t('set.paginationNone');

    new Setting(c)
      .setName(t('set.pagination'))
      .setDesc(custom ? t('set.paginationCustomDesc') : t('set.paginationDesc', { sample }))
      .addDropdown((d) => {
        for (const o of presets) d.addOption(o.template, o.sample);
        d.addOption(PAGINATION_CUSTOM, t('set.paginationCustom'));
        d.setValue(custom ? PAGINATION_CUSTOM : (known as { template: string }).template).onChange((v) => {
          if (v === PAGINATION_CUSTOM) {
            this.customPagination = true;
          } else {
            this.customPagination = false;
            L.pagination = v;
          }
          void this.plugin.saveSettings();
          this.display();
        });
      });

    if (custom) {
      new Setting(c)
        .setName(t('set.paginationFormat'))
        .setDesc(t('set.paginationFormatDesc', { sample }))
        .addText((tx) =>
          tx
            .setPlaceholder(DEFAULT_PAGINATION)
            .setValue(L.pagination)
            .onChange((v) => {
              L.pagination = v;
              this.save();
            })
        )
        // The preview only refreshes on a redraw, and typing must not steal
        // the caret, so it takes a deliberate click.
        .addExtraButton((b) => b.setIcon('refresh-cw').setTooltip(t('set.refreshPreview')).onClick(() => this.display()));
    }

    this.num(c, 'hf.headerY', 'hf.headerYDesc', () => L.headerY, (v) => { L.headerY = v; }, 0, 400);
    this.num(c, 'hf.headerRight', null, () => L.headerRight, (v) => { L.headerRight = v; }, 0, 300);
    this.num(c, 'hf.footerY', 'hf.footerYDesc', () => L.footerY, (v) => { L.footerY = v; }, 0, 400);
    this.num(c, 'hf.footerRight', null, () => L.footerRight, (v) => { L.footerRight = v; }, 0, 300);
  }

  private renderTlp(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.tlpColors')).setHeading();
    for (const key of ['RED', 'AMBER', 'AMBER+STRICT', 'GREEN', 'CLEAR']) {
      if (!preset.tlp[key]) preset.tlp[key] = { bg: '#888888', fg: '#FFFFFF' };
      this.color(c, `TLP:${key}`, () => preset.tlp[key].bg, (v) => (preset.tlp[key].bg = v));
    }
  }

  private renderLabels(c: HTMLElement, preset: Preset): void {
    new Setting(c)
      .setName(t('set.labels'))
      .setDesc(t('set.labelsDesc'))
      .setHeading()
      .addExtraButton((b) =>
        b
          .setIcon(this.showLabels ? 'chevron-up' : 'chevron-down')
          .setTooltip(this.showLabels ? t('set.hide') : t('set.show'))
          .onClick(() => {
            this.showLabels = !this.showLabels;
            this.display();
          })
      );
    if (!this.showLabels) return;

    const defaults = defaultLabels();
    for (const key of LABEL_KEYS) {
      new Setting(c).setName(t(`label.${key}` as MessageKey)).addText((tx) =>
        tx
          .setPlaceholder(defaults[key])
          .setValue(preset.labels[key])
          .onChange((v) => {
            preset.labels[key] = v || defaults[key];
            this.save();
          })
      );
    }
  }

  private renderAssets(c: HTMLElement, preset: Preset): void {
    new Setting(c).setName(t('set.artwork')).setHeading();
    c.createEl('p', { cls: 'pdf-report-muted', text: t('set.artworkDesc') });

    this.toggle(c, 'set.decor', 'set.decorDesc', () => preset.layout.decor, (v) => (preset.layout.decor = v));

    const row = (key: PresetImageKey, blank: string, resetTip: MessageKey) => {
      const value = preset.assets[key];
      new Setting(c)
        .setName(t(`asset.${key}` as MessageKey))
        .setDesc(value ? t('asset.custom', { path: value }) : blank)
        .addButton((b) => b.setButtonText(t('set.choose')).onClick(() => this.importImage(preset, key)))
        .addExtraButton((b) =>
          b
            .setIcon('reset')
            .setTooltip(t(resetTip))
            .setDisabled(!value)
            .onClick(() => {
              void this.plugin.assets.removeCustomImage(value);
              preset.assets[key] = null;
              void this.plugin.saveSettings();
              this.display();
            })
        );
    };

    row('coverBg', t('asset.builtIn'), 'asset.reset');
    row('frame', t('asset.builtIn'), 'asset.reset');
    row('clientLogo', t('asset.noLogo'), 'asset.removeLogo');
  }

  /* ================================================================ */
  /* Widgets                                                           */
  /* ================================================================ */

  private toggle(c: HTMLElement, name: MessageKey, desc: MessageKey, get: () => boolean, set: (v: boolean) => void): void {
    new Setting(c)
      .setName(t(name))
      .setDesc(t(desc))
      .addToggle((tg) =>
        tg.setValue(get()).onChange((v) => {
          set(v);
          this.save();
        })
      );
  }

  /**
   * A points field.
   *
   * Only a finite number inside the bounds is committed, so a half-typed value
   * ("1" on the way to "120") cannot wipe out a layout coordinate.
   */
  private num(
    c: HTMLElement,
    label: MessageKey,
    desc: MessageKey | null,
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number
  ): void {
    const s = new Setting(c).setName(t(label));
    if (desc) s.setDesc(t(desc));
    s.addText((tx) => {
      tx.inputEl.type = 'number';
      tx.inputEl.addClass('pdf-report-num');
      tx.setValue(String(get())).onChange((v) => {
        const n = Number(String(v).trim().replace(',', '.'));
        if (!isFinite(n) || n < min || n > max) return;
        set(n);
        this.save();
      });
    });
  }

  private color(c: HTMLElement, label: string, get: () => string, set: (v: string) => void): void {
    new Setting(c).setName(label).addColorPicker((cp) =>
      cp.setValue(toHex6(get())).onChange((v) => {
        set(v);
        this.save();
      })
    );
  }

  private importImage(preset: Preset, key: PresetImageKey): void {
    new VaultFileModal(this.app, [...IMG_EXTS], t('asset.pickImage'), (file) =>
      void this.applyImage(preset, key, file)
    ).open();
  }

  private async applyImage(preset: Preset, key: PresetImageKey, file: TFile): Promise<void> {
    try {
      // Goes through the same loader as the images of a note, so a WEBP or an
      // SVG logo is rasterised to PNG rather than written out under an
      // extension pdfmake cannot embed.
      const url = await loadVaultImage(this.app, file.path, '');
      const rel = url ? await this.materialise(preset.id, key, url) : null;
      if (!rel || rel === url) {
        new Notice(t('asset.unconvertible', { name: file.name }));
        return;
      }
      const previous = preset.assets[key];
      if (previous && previous !== rel) await this.plugin.assets.removeCustomImage(previous);
      preset.assets[key] = rel;
      await this.plugin.saveSettings();
      new Notice(t('asset.imported', { name: file.name }));
      this.display();
    } catch (e) {
      console.error('[PDF Report Exporter] image import', e);
      new Notice(t('asset.importFailed', { message: e instanceof Error ? e.message : String(e) }));
    }
  }
}

function toHex6(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + c.slice(1).split('').map((x) => x + x).join('');
  }
  return '#000000';
}

/**
 * Put a short caption under a control, in place. Three bare controls side by
 * side on one row read as a puzzle; a tooltip only helps once you hover.
 */
function captioned(control: HTMLElement, caption: string): void {
  const parent = control.parentElement;
  if (!parent) return;
  const wrap = createDiv({ cls: 'pdf-report-captioned' });
  parent.insertBefore(wrap, control);
  wrap.appendChild(control);
  wrap.createSpan({ cls: 'pdf-report-caption', text: caption });
}
