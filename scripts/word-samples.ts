/**
 * Writes sample Word documents covering every part of the Word export, for
 * the Open XML validator to check in CI (tools/ooxml-validate):
 *
 *   node scripts/word-samples.ts <output folder>
 *
 * The samples are defined in tests/samples.ts, which the reference tests
 * render too.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wordSamples } from '../tests/samples.ts';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/word-samples.ts <output folder>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

for (const [name, build] of Object.entries(wordSamples())) {
  writeFileSync(join(out, name), build());
  console.log(join(out, name));
}
