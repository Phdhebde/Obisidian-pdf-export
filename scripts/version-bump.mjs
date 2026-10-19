/*
 * Keep package.json, manifest.json and versions.json in step.
 *
 * The store reads manifest.json, Obsidian checks versions.json, npm reads
 * package.json: they must never drift apart.
 *
 *   node scripts/version-bump.mjs            # sync the manifest to package.json
 *   node scripts/version-bump.mjs 1.2.0      # set that version everywhere
 */
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

const pkg = read('package.json');
const manifest = read('manifest.json');
const versions = read('versions.json');

const target = process.argv[2] || pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(target)) {
  console.error(`Invalid version: "${target}" (expected x.y.z)`);
  process.exit(1);
}

pkg.version = target;
manifest.version = target;
versions[target] = manifest.minAppVersion;

write('package.json', pkg);
write('manifest.json', manifest);
write('versions.json', versions);

console.log(`Version ${target} (minAppVersion ${manifest.minAppVersion}) written to package.json, manifest.json, versions.json.`);
