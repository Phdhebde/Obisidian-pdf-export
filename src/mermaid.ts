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

/** Rounded corners Pele sets in `style=""` (`rx:var(--_r)`), which svg-to-pdfkit reads only as attributes. */
const CORNERS = ['rx', 'ry'];
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/**
 * Copy every resolved paint and text property onto the element itself.
 *
 * Everything is read before anything is written: Pele declares its colours as
 * custom properties in the root group's `style=""`, and replacing that style
 * first would leave every element below it without a colour — no strokes, and
 * fills in the text colour.
 */
function inlineStyles(root: SVGSVGElement): void {
  const view = root.ownerDocument.defaultView || window;
  const resolved: Array<[Element, string, Array<[string, string]>]> = [];
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
    const attrs: Array<[string, string]> = [];
    if (el.tagName.toLowerCase() === 'rect') {
      for (const p of CORNERS) {
        const v = cs.getPropertyValue(p);
        if (!el.hasAttribute(p) && v && v !== 'auto') attrs.push([p, cssValue(p, v)]);
      }
    }
    resolved.push([el, decl.join(';'), attrs]);
  }
  for (const [el, style, attrs] of resolved) {
    el.setAttribute('style', style);
    for (const [p, v] of attrs) el.setAttribute(p, v);
  }
  root.querySelectorAll('style').forEach((s) => s.remove());
}

/**
 * Drop `xml:space="preserve"`, which Pele puts on its labels: svg-to-pdfkit
 * then misplaces the text — centred lines start off-centre, and the runs of a
 * formatted line (bold, italic) scatter. Without it, single spaces between
 * runs are kept; only leading, trailing and repeated spaces collapse, as they
 * did in Mermaid's labels.
 */
function collapseSpaces(root: SVGSVGElement): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    el.removeAttributeNS(XML_NS, 'space');
    el.removeAttribute('xml:space');
  }
}

/**
 * Run `render` with the labels measured in the print font. Pele (Obsidian
 * 1.15+) ignores the directive's font and measures in `--font-mermaid` as the
 * body has it; Mermaid before it ignores the variable. Pele renders
 * synchronously, so the variable is set back before the next frame and no
 * diagram on screen changes font (only a diagram with `$$` maths may wait for
 * MathJax in between).
 */
async function inPrintFont<T>(render: () => Promise<T>): Promise<T> {
  const body = document.body;
  const before = body.style.getPropertyValue('--font-mermaid');
  body.setCssProps({ '--font-mermaid': FONT });
  try {
    return await render();
  } finally {
    body.setCssProps({ '--font-mermaid': before });
  }
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
    collapseSpaces(svg);
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
    console.warn('[Report Exporter] Mermaid unavailable:', e);
    return { diagrams, failed: sources.length };
  }

  const stamp = Date.now().toString(36);
  // One at a time: Mermaid keeps global state while it renders.
  for (let i = 0; i < sources.length; i++) {
    const id = `pdf-report-mermaid-${stamp}-${i}`;
    try {
      const { svg } = await inPrintFont(() => mermaid.render(id, withPrintDirective(sources[i])));
      const out = toPrintableSvg(svg);
      if (out) diagrams[sources[i]] = out;
      else failed++;
    } catch (e) {
      console.warn('[Report Exporter] Mermaid diagram not rendered:', e);
      failed++;
    } finally {
      // A failed render can leave its scratch element in the page.
      document.getElementById(id)?.remove();
      document.getElementById('d' + id)?.remove();
    }
  }
  return { diagrams, failed };
}
