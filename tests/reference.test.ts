import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REFERENCE_DIR, UPDATE_HINT, referenceFiles } from './reference.ts';

/*
 * Every sample renders exactly as tests/reference records it. A refactoring
 * must leave these files untouched; a change to the rendering shows up here,
 * and its diff in the pull request.
 */

const files = referenceFiles();

/** Where two texts first differ, with a few lines of each around it. */
function firstDifference(expected: string, actual: string): string {
  const want = expected.split('\n');
  const got = actual.split('\n');
  let line = 0;
  while (line < want.length && line < got.length && want[line] === got[line]) line++;
  const around = (lines: string[]) => lines.slice(Math.max(0, line - 2), line + 3).map((l) => '    ' + l.slice(0, 200)).join('\n');
  return `first difference at line ${line + 1}:\n  expected\n${around(want)}\n  actual\n${around(got)}`;
}

for (const [path, actual] of files) {
  test(`reference output: ${path}`, () => {
    const file = join(REFERENCE_DIR, path);
    assert.ok(existsSync(file), `tests/reference/${path} is missing. ${UPDATE_HINT}`);
    // Git may have checked the file out with Windows line endings.
    const expected = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (expected !== actual) assert.fail(`tests/reference/${path} no longer matches the rendering, ${firstDifference(expected, actual)}\n${UPDATE_HINT}`);
  });
}

test('reference outputs: no file left over from a removed sample', () => {
  const listed = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listed(join(dir, e.name)) : [join(dir, e.name)]));
  const stale = listed(REFERENCE_DIR)
    .map((f) => relative(REFERENCE_DIR, f).replace(/\\/g, '/'))
    .filter((f) => !files.has(f));
  assert.deepEqual(stale, [], UPDATE_HINT);
});
