/*
 * Fonts and preset images.
 *
 * The fonts are bundled into main.js (see fonts.ts) and handed to pdfmake on
 * the first export. Images a user imports into a template are written as files
 * in the plugin's folder rather than inlined into data.json: a pair of A4
 * PNGs as base64 would make the settings file several MB, re-read on every
 * Obsidian start.
 */
import { normalizePath, type App, type PluginManifest } from 'obsidian';
import type { PdfMake } from 'pdfmake/build/pdfmake.js';
import { FONT_VFS } from './fonts.ts';
import { isStoredFile } from './storage.ts';
import type { Preset } from './types.ts';

/** The images a preset can carry, and the keys they are stored under. */
export type PresetImageKey = 'coverBg' | 'frame' | 'clientLogo';

export const PDF_FONTS = {
  Liberation: {
    normal: 'LiberationSans-Regular.ttf',
    bold: 'LiberationSans-Bold.ttf',
    italics: 'LiberationSans-Italic.ttf',
    bolditalics: 'LiberationSans-BoldItalic.ttf'
  },
  Archivo: {
    normal: 'ArchivoBlack-Regular.ttf',
    bold: 'ArchivoBlack-Regular.ttf',
    italics: 'ArchivoBlack-Regular.ttf',
    bolditalics: 'ArchivoBlack-Regular.ttf'
  },
  LiberationMono: {
    normal: 'LiberationMono-Regular.ttf',
    bold: 'LiberationMono-Bold.ttf',
    italics: 'LiberationMono-Regular.ttf',
    bolditalics: 'LiberationMono-Bold.ttf'
  }
};

/** ArrayBuffer -> base64, chunked to stay under the call-stack limit. */
export function abToB64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export class AssetStore {
  /** Preset images, keyed by their plugin-relative path. */
  private cache = new Map<string, string>();

  constructor(
    private app: App,
    private manifest: PluginManifest
  ) {}

  private path(rel: string): string {
    return normalizePath((this.manifest.dir || '') + '/' + rel);
  }

  /** Hand the bundled TTFs to pdfMake's virtual file system. */
  ensureFonts(pdfMake: PdfMake): void {
    pdfMake.vfs = { ...(pdfMake.vfs || {}), ...FONT_VFS };
    pdfMake.fonts = PDF_FONTS;
  }

  /** Write an imported image next to the plugin, returning its path. */
  async saveCustomImage(presetId: string, key: PresetImageKey, data: ArrayBuffer, ext: string): Promise<string> {
    const rel = `assets/${presetId}-${key}.${ext}`;
    const folder = this.path('assets');
    if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.adapter.mkdir(folder);
    await this.app.vault.adapter.writeBinary(this.path(rel), data);
    this.cache.delete(rel);
    return rel;
  }

  /**
   * Give a duplicated preset its own copy of an imported image, so deleting
   * one of the two presets cannot take the other's artwork with it.
   */
  async copyCustomImage(presetId: string, key: PresetImageKey, value: string | null): Promise<string | null> {
    if (value?.startsWith('data:')) return value;
    if (!isStoredFile(value)) return null;
    try {
      const ab = await this.app.vault.adapter.readBinary(this.path(value));
      const ext = (value.split('.').pop() || 'png').toLowerCase();
      return await this.saveCustomImage(presetId, key, ab, ext);
    } catch {
      console.warn('[PDF Report Exporter] template image not copied:', value);
      return value;
    }
  }

  async removeCustomImage(rel: string | null): Promise<void> {
    if (!isStoredFile(rel)) return;
    this.cache.delete(rel);
    try {
      await this.app.vault.adapter.remove(this.path(rel));
    } catch {
      /* already gone */
    }
  }

  private async resolveOne(value: string | null): Promise<string | null> {
    if (!value) return null;
    if (/^data:image\/(png|jpe?g);base64,/i.test(value)) return value;
    if (!isStoredFile(value)) return null;
    const cached = this.cache.get(value);
    if (cached) return cached;
    try {
      const ext = (value.split('.').pop() || 'png').toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      const url = `data:${mime};base64,${abToB64(await this.app.vault.adapter.readBinary(this.path(value)))}`;
      this.cache.set(value, url);
      return url;
    } catch {
      console.warn('[PDF Report Exporter] template image not found:', value);
      return null;
    }
  }

  /** Replace a preset's image references with embeddable data URLs. */
  async resolvePreset(preset: Preset): Promise<Preset> {
    const [coverBg, frame, clientLogo] = await Promise.all([
      this.resolveOne(preset.assets.coverBg),
      this.resolveOne(preset.assets.frame),
      this.resolveOne(preset.assets.clientLogo)
    ]);
    return { ...preset, assets: { coverBg, frame, clientLogo } };
  }
}
