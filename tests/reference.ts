/*
 * Reference outputs: what each sample of tests/samples.ts renders to, as text
 * that can be read and diffed, so that a change to either engine shows up in
 * the tests and in the pull request.
 *
 * - PDF: the pdfmake document definition, with the header, footer and
 *   background evaluated on the first three pages of three.
 * - Word: every XML part of the package, one tag per line, and a hash of
 *   each picture.
 *
 * reference.test.ts compares them with tests/reference; scripts/update-reference.ts
 * rewrites tests/reference after an intended change.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { PAGE_H, PAGE_W, type PdfNode } from '../src/generator.ts';
import { ROOT, pdfSamples, wordSamples } from './samples.ts';

export const REFERENCE_DIR = join(ROOT, 'tests', 'reference');

/** How to bring the references up to date, for failure messages. */
export const UPDATE_HINT = 'If the change is intended, run `npm run reference:update` and commit tests/reference.';

/** Every reference file, by path relative to REFERENCE_DIR, with its expected content. */
export function referenceFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, build] of Object.entries(pdfSamples())) files.set(`pdf/${name}.json`, pdfText(build()));
  for (const [name, build] of Object.entries(wordSamples())) files.set(`word/${name.replace(/\.docx$/, '')}.txt`, wordText(build()));
  return files;
}

const PAGES = 3;

/** The page callbacks of a pdfmake document definition. */
interface PageCallbacks {
  background: (page: number, size: { width: number; height: number }) => unknown;
  header: (page: number) => unknown;
  footer: (page: number, pageCount: number) => unknown;
}

function pdfText(definition: PdfNode): string {
  const { background, header, footer, ...rest } = definition as PdfNode & PageCallbacks;
  const page = { width: PAGE_W, height: PAGE_H };
  const pages = Array.from({ length: PAGES }, (_, i) => ({
    page: i + 1,
    background: background(i + 1, page),
    header: header(i + 1),
    footer: footer(i + 1, PAGES)
  }));
  return JSON.stringify({ ...rest, pages }, null, 1) + '\n';
}

function wordText(bytes: Uint8Array): string {
  const sections: string[] = [];
  for (const [path, data] of Object.entries(unzipSync(bytes)).sort(([a], [b]) => a.localeCompare(b))) {
    const isXml = /\.(xml|rels)$/.test(path);
    // Word ends a template's XML declaration with CRLF: insignificant, and the
    // reference files are compared with LF line endings.
    const xml = () => strFromU8(data).replace(/\r\n/g, '\n').replace(/></g, '>\n<');
    const content = isXml ? xml() : `sha256 ${createHash('sha256').update(data).digest('hex')}`;
    sections.push(`===== ${path}\n${content}`);
  }
  return sections.join('\n') + '\n';
}
