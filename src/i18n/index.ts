/**
 * A typed `t()` over plain key-to-string catalogs, with no dependency.
 *
 * The English catalog is the source of truth: its keys (declared `as const`)
 * are the only keys `t()` accepts, and every other locale is a `Translation`
 * of it, so an unknown key in either place is a type error. A key missing from
 * a translation falls back to English.
 *
 * Strings use ICU-style `{var}` placeholders. A plural is a pair of keys,
 * `name_one` and `name_other`, called as `t('name', { count })`; the suffix is
 * picked with `Intl.PluralRules` for the active locale.
 */

import { moduleState } from '../util/module-state';

export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'locale';
const COOKIE_DOMAIN = 'gtfs.zone';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type Catalog = Record<string, string>;
type Vars = Record<string, string | number>;

type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type PluralBase<K extends string> = K extends `${infer B}_${PluralSuffix}`
  ? B
  : never;

/** The keys `t()` accepts: plain keys, and plural pairs by their base name. */
export type MessageKey<C extends Catalog> =
  | Exclude<keyof C & string, `${string}_${PluralSuffix}`>
  | PluralBase<keyof C & string>;

/** Another locale's strings for the English catalog `C`. */
export type Translation<C extends Catalog> = Partial<Record<keyof C, string>>;

export type Translator<C extends Catalog> = (
  key: MessageKey<C>,
  vars?: Vars
) => string;

const shared = moduleState('i18n', () => ({
  locale: null as Locale | null,
}));

function isLocale(value: string | null | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '');
}

/** First supported locale in a list of BCP 47 tags, by primary subtag. */
function matchLanguage(tags: readonly string[]): Locale | null {
  for (const tag of tags) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) {
      return primary;
    }
  }
  return null;
}

/**
 * The locale for a set of inputs, in priority order: the `locale` cookie, the
 * localStorage value, the browser's languages, then English.
 */
export function resolveLocale(inputs: {
  cookie?: string | null;
  stored?: string | null;
  languages?: readonly string[];
}): Locale {
  if (isLocale(inputs.cookie)) {
    return inputs.cookie;
  }
  if (isLocale(inputs.stored)) {
    return inputs.stored;
  }
  return matchLanguage(inputs.languages ?? []) ?? DEFAULT_LOCALE;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Whether this page shares the `.gtfs.zone` cookie with the other apps. */
function onSharedDomain(): boolean {
  if (typeof location === 'undefined') {
    return false;
  }
  const host = location.hostname;
  return host === COOKIE_DOMAIN || host.endsWith(`.${COOKIE_DOMAIN}`);
}

function setHtmlLang(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

/** The active locale, resolved once per page load. Sets `<html lang>`. */
export function getLocale(): Locale {
  if (shared.locale) {
    return shared.locale;
  }
  const locale = resolveLocale({
    cookie: readCookie(STORAGE_KEY),
    stored: readStorage(),
    languages:
      typeof navigator === 'undefined'
        ? []
        : (navigator.languages ?? [navigator.language]),
  });
  shared.locale = locale;
  setHtmlLang(locale);
  return locale;
}

/**
 * Store a locale preference and make it active. On `*.gtfs.zone` it is a
 * cookie on the parent domain, so it carries across the apps; elsewhere
 * (localhost) it is localStorage.
 */
export function setLocale(locale: Locale): void {
  if (onSharedDomain()) {
    document.cookie = `${STORAGE_KEY}=${locale}; Domain=.${COOKIE_DOMAIN}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Not stored: the choice lasts until the next load.
    }
  }
  shared.locale = locale;
  setHtmlLang(locale);
}

/** Replace `{name}` placeholders; numbers are formatted for the locale. */
export function interpolate(
  template: string,
  vars: Vars | undefined,
  locale: Locale
): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      return match;
    }
    return typeof value === 'number'
      ? new Intl.NumberFormat(locale).format(value)
      : value;
  });
}

/**
 * A translator over the English catalog `en` and its translations. Pass
 * `locale` to pin one (tests, server-side rendering); otherwise each call reads
 * the active locale.
 */
export function defineCatalog<const C extends Catalog>(
  en: C,
  translations: { [L in Exclude<Locale, 'en'>]?: Translation<C> } = {},
  locale?: () => Locale
): Translator<C> {
  const catalogs: Record<Locale, Partial<Record<string, string>>> = {
    en,
    fr: translations.fr ?? {},
  };
  const lookup = (active: Locale, key: string): string | undefined =>
    catalogs[active][key] ?? en[key];

  return (key, vars) => {
    const active = locale ? locale() : getLocale();
    let message = lookup(active, key);
    if (message === undefined && vars && typeof vars.count === 'number') {
      const category = new Intl.PluralRules(active).select(vars.count);
      message =
        lookup(active, `${key}_${category}`) ?? lookup(active, `${key}_other`);
    }
    return interpolate(message ?? key, vars, active);
  };
}
