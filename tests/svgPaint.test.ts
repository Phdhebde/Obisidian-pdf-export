import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssValue, printableDashArray } from '../src/svgPaint.ts';

test('a dash pattern with no gap is a solid line', () => {
  // What Chromium computes for some Mermaid edges; pdfkit threw on it.
  assert.equal(printableDashArray('1, 0'), 'none');
  assert.equal(printableDashArray('0'), 'none');
  assert.equal(printableDashArray('4 0 2 0'), 'none');
});

test('ordinary dash patterns go through unchanged', () => {
  assert.equal(printableDashArray('3, 3'), '3 3');
  assert.equal(printableDashArray('2.5 4'), '2.5 4');
  // An odd-length list is repeated, as SVG does.
  assert.equal(printableDashArray('5 3 2'), '5 3 2 5 3 2');
});

test('zero-length dashes survive as near-zero, which pdfkit accepts', () => {
  assert.equal(printableDashArray('0 4'), '0.001 4');
});

test('invalid patterns fall back to a solid line', () => {
  assert.equal(printableDashArray('none'), 'none');
  assert.equal(printableDashArray(''), 'none');
  assert.equal(printableDashArray('3 -1'), 'none');
  assert.equal(printableDashArray('10%'), 'none');
});

test('cssValue strips px and url quotes, and routes dash patterns', () => {
  assert.equal(cssValue('stroke-width', '1.5px'), '1.5');
  assert.equal(cssValue('marker-end', 'url("#arrow")'), 'url(#arrow)');
  assert.equal(cssValue('stroke-dasharray', '1px, 0px'), 'none');
  assert.equal(cssValue('stroke-dasharray', '3px, 3px'), '3 3');
});
