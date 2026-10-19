/*
 * Render ```mermaid blocks to self-contained SVG for the generator.
 *
 * pdfmake draws SVG as vectors, but from a string it reads presentation
 * attributes and `style=""` only: the `<style>` sheet Mermaid colours
 * everything with is ignored, which would leave every shape black. So the
 * diagram is laid out once in the page, where the browser resolves that sheet,
 * and the resolved values are written back onto each element.
 *
 * Rasterising instead (what 1.5.0 did) was both slow — pdfkit re-encodes a
 * PNG's alpha channel in JavaScript — and blurry once scaled to the page.
 */
import { loadMermaid } from 'obsidian';
import type { DiagramSvg } from './generator.ts';
import { cssValue } from './svgPaint.ts';

/** Obsidian's Mermaid instance, as far as this module uses it. */
interface Mermaid {
  render(id: string, source: string): Promise<{ svg: string }>;
}

/**
 * Paper, not screen: the light theme whatever Obsidian's, and SVG `<text>`
 * labels rather than HTML ones, which pdfmake cannot draw. Arial because it
 * shares its metrics with Liberation Sans, the font the PDF sets the labels
 * in: boxes Mermaid sizes for one fit the other. A directive only lasts for
 * one render, so the diagrams in the open notes keep Obsidian's settings.
 */
const FONT = 'Arial, "Liberation Sans", Helvetica, sans-serif';
const PRINT_DIRECTIVE = '%%{init: ' + JSON.stringify({
  theme: 'default',
  fontFamily: FONT,
  themeVariables: { fontFamily: FONT },
  htmlLabels: false,
  flowchart: { htmlLabels: false }
}) + '}%%';

/**
 * The properties svg-to-pdfkit understands and that Mermaid sets through its
 * stylesheet. Written into `style=""`, which replaces Mermaid's own inline
 * styles — the computed value already accounts for them, `!important` included.
 */
const PAINT = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-size', 'font-weight', 'font-style', 'text-anchor'
];
/** Written only when they say something, so an `auto` never overrides an attribute. */
const SPARSE: Record<string, string> = {
  'dominant-baseline': 'auto',
  'alignment-baseline': 'auto',
  display: 'inline',
  visibility: 'visible'
};

/** Put the print directive in, after the diagram's own frontmatter if it has one. */
export function withPrintDirective(source: string): string {
  const fm = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  return fm
    ? fm[0] + PRINT_DIRECTIVE + '\n' + source.slice(fm[0].length)
    : PRINT_DIRECTIVE + '\n' + source;
}

/** Copy every resolved paint and text property onto the element itself. */
function inlineStyles(root: SVGSVGElement): void {
  const view = root.ownerDocument.defaultView || window;
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (el.tagName.toLowerCase() === 'style') continue;
    const cs = view.getComputedStyle(el);
    const decl: string[] = [];
    for (const p of PAINT) {
      const v = cs.getPropertyValue(p);
      if (v) decl.push(`${p}:${cssValue(p, v)}`);
    }
    for (const [p, skip] of Object.entries(SPARSE)) {
      const v = cs.getPropertyValue(p);
      if (v && v !== skip) decl.push(`${p}:${cssValue(p, v)}`);
    }
    // The `text-decoration` shorthand computes to "none solid rgb(…)".
    const line = cs.getPropertyValue('text-decoration-line');
    if (line && line !== 'none') decl.push(`text-decoration:${line.split(/\s+/)[0]}`);
    el.setAttribute('style', decl.join(';'));
  }
  root.querySelectorAll('style').forEach((s) => s.remove());
}

/** Mermaid's markup -> standalone SVG that pdfmake can draw, and its size. */
function toPrintableSvg(markup: string): DiagramSvg | null {
  // Mermaid serialises as HTML (`<br>` in labels): parse it as such, and let
  // XMLSerializer write it back as well-formed XML.
  const parsed = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
  if (!parsed) return null;
  const box = (parsed.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const w = box[2];
  const h = box[3];
  if (!(w > 0 && h > 0)) return null;

  // Laid out off-screen, not hidden: `visibility` and `display` would be
  // inherited into the computed styles we are about to copy.
  const host = document.body.createDiv({ cls: 'pdf-report-mermaid-scratch' });
  try {
    const svg = document.importNode(parsed, true);
    host.appendChild(svg);
    inlineStyles(svg);
    // pdfmake sizes the drawing from these; `100%` has nothing to refer to.
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.removeAttribute('style');
    return { svg: new XMLSerializer().serializeToString(svg), width: w, height: h };
  } finally {
    host.remove();
  }
}

/**
 * Render each source in turn. One that fails is left out, and the generator
 * prints its code instead; `failed` says how many that was.
 */
export async function renderMermaid(
  sources: string[]
): Promise<{ diagrams: Record<string, DiagramSvg>; failed: number }> {
  const diagrams: Record<string, DiagramSvg> = {};
  if (!sources.length) return { diagrams, failed: 0 };

  let failed = 0;
  let mermaid: Mermaid;
  try {
    mermaid = (await loadMermaid()) as Mermaid;
  } catch (e) {
    console.warn('[PDF Report Exporter] Mermaid unavailable:', e);
    return { diagrams, failed: sources.length };
  }

  const stamp = Date.now().toString(36);
  // One at a time: Mermaid keeps global state while it renders.
  for (let i = 0; i < sources.length; i++) {
    const id = `pdf-report-mermaid-${stamp}-${i}`;
    try {
      const { svg } = await mermaid.render(id, withPrintDirective(sources[i]));
      const out = toPrintableSvg(svg);
      if (out) diagrams[sources[i]] = out;
      else failed++;
    } catch (e) {
      console.warn('[PDF Report Exporter] Mermaid diagram not rendered:', e);
      failed++;
    } finally {
      // A failed render can leave its scratch element in the page.
      document.getElementById(id)?.remove();
      document.getElementById('d' + id)?.remove();
    }
  }
  return { diagrams, failed };
}
