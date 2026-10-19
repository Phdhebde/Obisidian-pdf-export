/*
 * Computed CSS values -> what svg-to-pdfkit (and pdfkit under it) accepts.
 * Pure, so the tests can reach it: mermaid.ts imports 'obsidian'.
 */

/**
 * A computed `stroke-dasharray` as pdfkit will take it, or `none`.
 *
 * SVG allows zeros in a dash pattern; pdfkit throws on them ("lengths must be
 * numeric and greater than zero"), and one bad edge used to fail the whole
 * export. Chromium computes `1, 0` for some Mermaid edges: dashes with no gap,
 * which is a solid line.
 */
export function printableDashArray(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'none') return 'none';
  const parts = raw.split(/[\s,]+/).filter(Boolean).map(Number); // not parseFloat: "10%" must not read as 10
  // Invalid per SVG (non-numeric, percentages we cannot resolve, negatives): solid.
  if (!parts.length || parts.some((n) => !isFinite(n) || n < 0)) return 'none';
  // An odd-length list repeats itself, so dashes and gaps swap on the repeat.
  const list = parts.length % 2 ? [...parts, ...parts] : parts;
  const gaps = list.filter((_, i) => i % 2 === 1);
  if (gaps.every((n) => n === 0)) return 'none'; // no gap: solid
  // A zero-length dash is a dot with round caps (nothing with butt caps):
  // keep it, just not at zero.
  return list.map((n) => String(n === 0 ? 0.001 : n)).join(' ');
}

/**
 * A computed value in the form svg-to-pdfkit parses: bare user units rather
 * than `px`, and `url(#id)` without the quotes Chromium adds.
 */
export function cssValue(property: string, v: string): string {
  const clean = v
    .replace(/(\d)px\b/g, '$1')
    .replace(/url\(\s*(["'])(.*?)\1\s*\)/g, 'url($2)')
    .trim();
  return property === 'stroke-dasharray' ? printableDashArray(clean) : clean;
}
