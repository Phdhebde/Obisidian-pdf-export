/*
 * The generator's entry points, typed loosely for the tests.
 *
 * The plugin types pdfmake nodes as `Record<string, unknown>`, which keeps its
 * own code honest; the tests, which reach deep into the nodes to check them,
 * read far better without a cast at every step.
 */
import * as gen from '../src/generator.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only reads into pdfmake nodes
export type PdfNode = Record<string, any>;

export const buildDocDefinition = gen.buildDocDefinition as (
  ...args: Parameters<typeof gen.buildDocDefinition>
) => PdfNode;

export const markdownToPdf = gen.markdownToPdf as (...args: Parameters<typeof gen.markdownToPdf>) => PdfNode[];
