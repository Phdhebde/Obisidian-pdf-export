/*
 * Text width estimates, in PDF points, for the bundled fonts.
 *
 * pdfmake measures text only while it lays the page out, which is too late to
 * choose a table's column widths. The widths come from the fonts themselves
 * (scripts/gen-metrics.mjs), so for Basic Latin and Latin-1 the estimate is the
 * advance pdfmake will use, kerning aside.
 */
import { FACE_METRICS, type FaceMetrics } from './fontMetrics.ts';

function face(font: string, bold: boolean): FaceMetrics {
  return (bold && FACE_METRICS[font + ':bold']) || FACE_METRICS[font] || FACE_METRICS.Liberation;
}

function charWidth(m: FaceMetrics, cp: number): number {
  const i = cp >= 0x20 && cp <= 0x7e ? cp - 0x20 : cp >= 0xa0 && cp <= 0xff ? cp - 0xa0 + 95 : -1;
  const w = i >= 0 ? m.widths[i] : 0;
  return w || m.fallback;
}

/** Width of `text` set in `font` at `size` points. */
export function textWidth(text: string, font: string, size: number, bold = false): number {
  const m = face(font, bold);
  let units = 0;
  for (const ch of text) units += charWidth(m, ch.codePointAt(0)!);
  return (units * size) / 1000;
}
