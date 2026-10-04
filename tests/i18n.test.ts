import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  defineCatalog,
  interpolate,
  resolveLocale,
  type Locale,
} from '../src/i18n/index';
import { formatDate, formatNumber, weekdayName } from '../src/i18n/fmt';

const en = {
  greeting: 'Hello, {name}',
  onlyEnglish: 'Only in English',
  stops_one: '{count} stop',
  stops_other: '{count} stops',
} as const;

function translator(locale: Locale) {
  return defineCatalog(
    en,
    {
      fr: {
        greeting: 'Bonjour, {name}',
        stops_one: '{count} arrêt',
        stops_other: '{count} arrêts',
      },
    },
    () => locale
  );
}

describe('interpolate', () => {
  it('fills named placeholders', () => {
    assert.equal(
      interpolate('{a} and {b}', { a: 'x', b: 'y' }, 'en'),
      'x and y'
    );
  });

  it('leaves unknown placeholders alone', () => {
    assert.equal(interpolate('{a} {missing}', { a: 'x' }, 'en'), 'x {missing}');
  });

  it('formats numbers for the locale', () => {
    assert.equal(interpolate('{n}', { n: 12345 }, 'en'), '12,345');
    assert.equal(interpolate('{n}', { n: 12345 }, 'fr'), '12 345');
  });
});

describe('defineCatalog', () => {
  it('translates and interpolates', () => {
    assert.equal(translator('en')('greeting', { name: 'Max' }), 'Hello, Max');
    assert.equal(translator('fr')('greeting', { name: 'Max' }), 'Bonjour, Max');
  });

  it('falls back to English for a missing key', () => {
    assert.equal(translator('fr')('onlyEnglish'), 'Only in English');
  });

  it('picks the plural form for the locale', () => {
    const tEn = translator('en');
    assert.equal(tEn('stops', { count: 0 }), '0 stops');
    assert.equal(tEn('stops', { count: 1 }), '1 stop');
    assert.equal(tEn('stops', { count: 2 }), '2 stops');

    // French treats 0 and 1 as singular.
    const tFr = translator('fr');
    assert.equal(tFr('stops', { count: 0 }), '0 arrêt');
    assert.equal(tFr('stops', { count: 1 }), '1 arrêt');
    assert.equal(tFr('stops', { count: 2 }), '2 arrêts');
  });

  it('falls back to _other for a plural category with no key', () => {
    // CLDR puts 1,000,000 in French "many", which the catalog does not define.
    assert.equal(
      translator('fr')('stops', { count: 1_000_000 }),
      '1 000 000 arrêts'
    );
  });
});

describe('resolveLocale', () => {
  it('prefers the cookie, then storage, then the browser', () => {
    assert.equal(
      resolveLocale({ cookie: 'fr', stored: 'en', languages: ['en-US'] }),
      'fr'
    );
    assert.equal(
      resolveLocale({ cookie: null, stored: 'fr', languages: ['en-US'] }),
      'fr'
    );
    assert.equal(resolveLocale({ languages: ['fr-CA', 'en'] }), 'fr');
  });

  it('matches a regional cookie or stored value by its language', () => {
    assert.equal(
      resolveLocale({ cookie: 'fr-CA', languages: ['en-US'] }),
      'fr'
    );
    assert.equal(
      resolveLocale({ stored: 'fr-CA', languages: ['en-US'] }),
      'fr'
    );
    assert.equal(
      resolveLocale({ cookie: 'de-CH', languages: ['fr-CH'] }),
      'fr'
    );
  });

  it('skips unsupported values', () => {
    assert.equal(
      resolveLocale({ cookie: 'de', stored: 'xx', languages: ['de-DE', 'fr'] }),
      'fr'
    );
  });

  it('defaults to English', () => {
    assert.equal(resolveLocale({}), 'en');
    assert.equal(resolveLocale({ languages: ['ja'] }), 'en');
  });
});

describe('fmt', () => {
  it('formats numbers and dates in the given locale', () => {
    assert.equal(formatNumber(1.5, {}, 'fr'), '1,5');
    const day = Date.UTC(2026, 9, 3);
    assert.equal(
      formatDate(
        day,
        { month: 'long', year: 'numeric', timeZone: 'UTC' },
        'fr'
      ),
      'octobre 2026'
    );
  });

  it('names weekdays from Sunday', () => {
    assert.equal(weekdayName(0, 'long', 'en'), 'Sunday');
    assert.equal(weekdayName(1, 'long', 'fr'), 'lundi');
  });
});
