/*
 * Minimal TrueType cmap reader, so the tests can assert that every character
 * the generator emits actually exists in the bundled fonts.
 *
 * A missing glyph does not make pdfmake fail — it silently renders .notdef —
 * so this is the only cheap way to catch it before the PDF reaches a reader.
 */
import { readFileSync } from 'node:fs';

/** Codepoints available in a font's Windows Unicode cmap subtable (format 4). */
export function loadCmap(path: string): (codePoint: number) => boolean {
  const b = readFileSync(path);

  let cmapOff = 0;
  const tableCount = b.readUInt16BE(4);
  for (let i = 0; i < tableCount; i++) {
    const o = 12 + i * 16;
    if (b.toString('latin1', o, o + 4) === 'cmap') cmapOff = b.readUInt32BE(o + 8);
  }
  if (!cmapOff) throw new Error(`pas de table cmap dans ${path}`);

  let sub = 0;
  const subCount = b.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < subCount; i++) {
    const o = cmapOff + 4 + i * 8;
    const platform = b.readUInt16BE(o);
    const encoding = b.readUInt16BE(o + 2);
    if (platform === 3 && (encoding === 1 || encoding === 10)) sub = cmapOff + b.readUInt32BE(o + 4);
  }
  if (!sub) throw new Error(`pas de sous-table Unicode dans ${path}`);

  const format = b.readUInt16BE(sub);
  if (format !== 4) throw new Error(`format cmap ${format} non géré (${path})`);

  const segX2 = b.readUInt16BE(sub + 6);
  const segCount = segX2 / 2;
  const endO = sub + 14;
  const startO = endO + segX2 + 2;
  const deltaO = startO + segX2;
  const rangeO = deltaO + segX2;

  return (cp: number): boolean => {
    if (cp > 0xffff) return false;
    for (let i = 0; i < segCount; i++) {
      const end = b.readUInt16BE(endO + i * 2);
      if (cp > end) continue;
      const start = b.readUInt16BE(startO + i * 2);
      if (cp < start) return false;
      const delta = b.readInt16BE(deltaO + i * 2);
      const rangeOffset = b.readUInt16BE(rangeO + i * 2);
      if (rangeOffset === 0) return ((cp + delta) & 0xffff) !== 0;
      const gi = b.readUInt16BE(rangeO + i * 2 + rangeOffset + (cp - start) * 2);
      return gi !== 0;
    }
    return false;
  };
}

/** Characters in `text` that the font cannot render, deduplicated. */
export function missingChars(text: string, hasGlyph: (cp: number) => boolean): string[] {
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Line breaks and tabs never reach the glyph layer.
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue;
    if (!hasGlyph(cp)) missing.add(`${ch} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`);
  }
  return [...missing];
}
