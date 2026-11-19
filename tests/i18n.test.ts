import test from 'node:test';
import assert from 'node:assert/strict';
import { dictionary, htmlLanguage, resolveLanguage, SUPPORTED_LANGUAGES } from '../src/i18n';

test('all five interface languages have a complete nonblank dictionary', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES.map(language => language.code), ['en', 'zh', 'ja', 'fr', 'es']);
  const expected = Object.keys(dictionary('en')).sort();
  for (const language of SUPPORTED_LANGUAGES) {
    const translated = dictionary(language.code);
    assert.deepEqual(Object.keys(translated).sort(), expected);
    for (const [key, value] of Object.entries(translated)) assert.ok(value.trim(), `${language.code}: ${key}`);
    assert.equal(htmlLanguage(language.code), language.htmlLang);
  }
});

test('saved language wins, browser regions match, and unsupported preferences fall back safely', () => {
  assert.equal(resolveLanguage('ja', ['es-MX']), 'ja');
  assert.equal(resolveLanguage('unsupported', ['de-DE', 'fr-CA']), 'fr');
  assert.equal(resolveLanguage(null, ['zh-Hans-CN']), 'zh');
  assert.equal(resolveLanguage(null, ['ES-mx']), 'es');
  assert.equal(resolveLanguage(null, ['ko-KR']), 'en');
  assert.equal(resolveLanguage(null, []), 'en');
});
