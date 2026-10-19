/*
 * Resolve the images a note references into a pdfmake image dictionary.
 *
 *  - Rewrites are scoped to prose (see textScan.replaceOutsideCode), so a note
 *    that *documents* the `![[capture.png]]` syntax inside a fenced block keeps
 *    showing the syntax instead of a base64 blob.
 *  - Each distinct image is encoded once and referenced by name, instead of the
 *    whole data URL being pasted in at every occurrence: a note that reuses one
 *    screenshot ten times embeds it once.
 */
import { TFile, type App } from 'obsidian';
import { replaceOutsideCodeAsync } from './textScan.ts';
import { abToB64 } from './assets.ts';
import { t } from './i18n.ts';

const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  tif: 'image/tiff', tiff: 'image/tiff'
};
export const IMG_EXTS = new Set(Object.keys(IMG_MIME));

export interface ResolvedImages {
  markdown: string;
  /** pdfmake `images` dictionary: name -> data URL. */
  images: Record<string, string>;
  missing: string[];
}

/** Intrinsic pixel size read straight from PNG / GIF / JPEG bytes. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    // PNG: IHDR width/height are big-endian at bytes 16..23. Read unsigned —
    // `<< 24` would go negative on images wider than 32767 px.
    const rd = (o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
    return { w: rd(16), h: rd(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }; // GIF
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2; // JPEG: walk the marker chain to the SOF segment
    while (i < b.length - 8) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('the image could not be decoded'));
    im.src = url;
  });
}

/**
 * Vault image file -> a pdfmake-embeddable data URL and its pixel width.
 *
 * Module-level rather than a method, because the cover logo is artwork that
 * never passes through the Markdown rewrite and so has no resolver to ask.
 */
async function fileToDataUrl(app: App, file: TFile): Promise<{ url: string; w?: number } | null> {
  const buf = await app.vault.readBinary(file);
  const ext = (file.extension || '').toLowerCase();
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    const size = imageSize(new Uint8Array(buf));
    return { url: `data:${IMG_MIME[ext]};base64,${abToB64(buf)}`, w: size?.w };
  }
  // webp / gif / svg / bmp / avif / tiff: rasterise to PNG through a canvas.
  try {
    const srcUrl = `data:${IMG_MIME[ext] || 'application/octet-stream'};base64,${abToB64(buf)}`;
    const img = await loadHtmlImage(srcUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = createEl('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { url: canvas.toDataURL('image/png'), w };
  } catch (e) {
    console.warn('[PDF Report Exporter] image could not be converted:', file.path, e);
    return null;
  }
}

/**
 * Resolve a single image named outside the Markdown — the client logo of a
 * note's frontmatter. Accepts a vault path, a `[[wikilink]]`, or a data URL
 * already inlined.
 */
export async function loadVaultImage(
  app: App,
  target: string,
  sourcePath: string
): Promise<string | null> {
  const clean = String(target || '')
    .trim()
    .replace(/^!?\[\[/, '')
    .replace(/\]\]$/, '')
    .split('|')[0]
    .trim();
  if (!clean) return null;
  if (/^data:image\//i.test(clean)) return clean;

  const decoded = decodeURIComponent(clean);
  const file =
    app.metadataCache.getFirstLinkpathDest(decoded, sourcePath || '') ||
    app.vault.getAbstractFileByPath(decoded);
  if (!(file instanceof TFile) || !IMG_EXTS.has((file.extension || '').toLowerCase())) return null;

  const conv = await fileToDataUrl(app, file);
  return conv ? conv.url : null;
}

export class ImageResolver {
  private byPath = new Map<string, { name: string; w?: number } | null>();
  private images: Record<string, string> = {};
  private seq = 0;

  constructor(private app: App) {}

  /** Register a file once, returning the dictionary name to reference it by. */
  private async register(file: TFile): Promise<{ name: string; w?: number } | null> {
    const hit = this.byPath.get(file.path);
    if (hit !== undefined) return hit;
    const conv = await fileToDataUrl(this.app, file);
    const entry = conv ? { name: `img${this.seq++}`, w: conv.w } : null;
    if (conv && entry) this.images[entry.name] = conv.url;
    this.byPath.set(file.path, entry);
    return entry;
  }

  /**
   * Rewrite every image reference in `md` to `![alt](report-image:<name> "<width>")`,
   * which generator.imageNode turns into a pdfmake image node.
   */
  async resolve(md: string, sourcePath: string): Promise<ResolvedImages> {
    const missing: string[] = [];

    const handle = async (link: string, alt: string, sizeHint: string | undefined, embed: boolean, whole: string) => {
      const target = decodeURIComponent(link.trim());
      if (/^(https?:|data:)/i.test(target)) return whole; // remote or already inlined

      const file =
        this.app.metadataCache.getFirstLinkpathDest(target, sourcePath || '') ||
        this.app.vault.getAbstractFileByPath(target);

      if (!(file instanceof TFile)) {
        missing.push(target);
        return `*[${t('inline.imageMissing', { path: target })}]*`;
      }
      // For ![[...]] leave non-image embeds (notes, PDFs) to the transclusion pass.
      if (embed && !IMG_EXTS.has((file.extension || '').toLowerCase())) return whole;

      const entry = await this.register(file);
      if (!entry) return `*[${t('inline.imageUnconvertible', { name: file.name })}]*`;

      let widthPx = parseInt((sizeHint || '').split(/[x×]/)[0], 10);
      if (isNaN(widthPx) && entry.w) widthPx = entry.w;
      const title = !isNaN(widthPx) && widthPx > 0 ? ` "${widthPx}"` : '';
      return `![${(alt || '').replace(/[[\]]/g, '')}](report-image:${entry.name}${title})`;
    };

    // Obsidian embeds: ![[image.png|400]]
    let out = await replaceOutsideCodeAsync(md, /!\[\[\s*([^\][\n|]+?)\s*(?:\|\s*([^\][\n]+?)\s*)?\]\]/g, (m) =>
      handle(m[1], '', m[2], true, m[0])
    );
    // Standard Markdown: ![alt](path "title")
    out = await replaceOutsideCodeAsync(out, /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, async (m) => {
      let src = m[2];
      if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
      if (src.startsWith('report-image:')) return m[0]; // already rewritten above
      return handle(src, m[1], m[3], false, m[0]);
    });

    return { markdown: out, images: this.images, missing };
  }
}
