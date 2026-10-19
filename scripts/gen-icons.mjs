import { readFileSync, writeFileSync } from 'node:fs';

// Obsidian's callout type -> the Lucide icon it uses. Run from the repo root:
//   npm i --no-save lucide-static && node scripts/gen-icons.mjs
const ICONS = {
  pencil: 'pencil',
  clipboardList: 'clipboard-list',
  info: 'info',
  listTodo: 'list-todo',
  flame: 'flame',
  check: 'check',
  circleHelp: 'circle-help',
  triangleAlert: 'triangle-alert',
  x: 'x',
  zap: 'zap',
  bug: 'bug',
  list: 'list',
  quote: 'quote'
};

const inner = (file) => {
  const raw = readFileSync(`node_modules/lucide-static/icons/${file}.svg`, 'utf8');
  const m = /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(raw);
  if (!m) throw new Error(`no SVG content in ${file}`);
  return m[1].replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
};

const entries = Object.entries(ICONS)
  .map(([key, file]) => `  ${key}:\n    '${inner(file).replace(/'/g, "\'")}'`)
  .join(',\n');

const version = JSON.parse(readFileSync('node_modules/lucide-static/package.json', 'utf8')).version;

writeFileSync('src/icons.ts', `/*
 * Callout icons — the same Lucide glyphs Obsidian itself uses, so a report
 * looks like the note it came from.
 *
 * Generated from lucide-static v${version} (ISC). Only the drawing commands are
 * kept; the <svg> wrapper is rebuilt at render time so the stroke can take the
 * callout's accent colour (Lucide ships "currentColor", which pdfmake's SVG
 * renderer does not resolve).
 *
 * pdfmake draws these through svg-to-pdfkit, so they stay vectors in the PDF
 * and need no icon font.
 */

/** Inner drawing commands of each icon, on Lucide's 24x24 grid. */
export const ICON_PATHS = {
${entries}
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * A standalone SVG for one icon, stroked in \`color\`.
 *
 * Lucide is a stroked icon set: fill stays none and the 2px stroke is what you
 * see, so scaling happens through the viewBox rather than the path data.
 */
export function iconSvg(name: IconName, color: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    \`stroke="\${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\` +
    ICON_PATHS[name] +
    '</svg>'
  );
}
`);
console.log('src/icons.ts generated —', Object.keys(ICONS).length, 'icones, lucide-static', version);
