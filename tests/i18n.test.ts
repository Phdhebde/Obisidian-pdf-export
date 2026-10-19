import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, setLocale, t } from '../src/i18n.ts';

test('the locale follows the language tag, English by default', () => {
  try {
    assert.equal(setLocale('fr'), 'fr');
    assert.equal(setLocale('fr-CA'), 'fr');
    assert.equal(setLocale('en-GB'), 'en');
    assert.equal(setLocale('de'), 'en');
    assert.equal(setLocale(undefined), 'en');
  } finally {
    setLocale('en');
  }
});

test('placeholders are filled, and unknown ones left for the reader', () => {
  try {
    assert.equal(t('notice.exported', { path: 'a.pdf' }), 'PDF exported: a.pdf');
    setLocale('fr');
    assert.equal(getLocale(), 'fr');
    assert.equal(t('notice.exported', { path: 'a.pdf' }), 'PDF exporté : a.pdf');
    // {{page}} is part of the message, not a variable of this call.
    assert.match(t('set.paginationFormatDesc', { sample: '3/12' }), /\{\{page\}\}.*3\/12/);
  } finally {
    setLocale('en');
  }
});
