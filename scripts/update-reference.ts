/**
 * Rewrites tests/reference after an intended change to the rendering:
 *
 *   npm run reference:update
 *
 * Then read the diff of tests/reference: it is exactly what the change does to
 * the PDF and Word output. Files of samples that no longer exist are removed.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { REFERENCE_DIR, referenceFiles } from '../tests/reference.ts';

const files = referenceFiles();
let changed = 0;
for (const [path, content] of files) {
  const file = join(REFERENCE_DIR, path);
  if (existsSync(file) && readFileSync(file, 'utf8').replace(/\r\n/g, '\n') === content) continue;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log('updated', relative(process.cwd(), file));
  changed++;
}

const listed = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listed(join(dir, e.name)) : [join(dir, e.name)])) : [];
for (const file of listed(REFERENCE_DIR)) {
  if (files.has(relative(REFERENCE_DIR, file).replace(/\\/g, '/'))) continue;
  rmSync(file);
  console.log('removed', relative(process.cwd(), file));
  changed++;
}

console.log(changed ? `${changed} reference file(s) changed.` : 'Reference outputs are up to date.');
