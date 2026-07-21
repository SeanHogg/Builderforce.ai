import { describe, it, expect } from 'vitest';
import {
  EMAIL_LOCALES,
  isEmailLocale,
  localeFromHeaders,
  normalizeLocale,
  parseAcceptLanguage,
} from './emailLocale';
import { EMAIL_MESSAGES, emailCopy } from './emailMessages';

describe('normalizeLocale', () => {
  it('accepts every supported locale', () => {
    for (const l of EMAIL_LOCALES) expect(normalizeLocale(l)).toBe(l);
  });

  it('narrows a regional tag to its base language', () => {
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh');
    expect(normalizeLocale('de_AT')).toBe('de');
    expect(normalizeLocale('ES-419')).toBe('es');
  });

  it('returns null — not English — for a language we cannot write', () => {
    // The distinction matters: null lets the resolver keep looking down its chain,
    // whereas 'en' would stop it and pin the recipient to English.
    expect(normalizeLocale('ja')).toBeNull();
    expect(normalizeLocale('pt-BR')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
  });
});

describe('parseAcceptLanguage', () => {
  it('honours q-weights rather than taking the first token', () => {
    expect(parseAcceptLanguage('de;q=0.2, zh;q=0.9')).toBe('zh');
  });

  it('treats a missing q as 1 (highest)', () => {
    expect(parseAcceptLanguage('fr, de;q=0.9')).toBe('fr');
  });

  it('skips unsupported languages and picks the best supported one', () => {
    expect(parseAcceptLanguage('ja;q=1.0, ko;q=0.9, es;q=0.5')).toBe('es');
  });

  it('drops q=0, which is an explicit refusal', () => {
    expect(parseAcceptLanguage('de;q=0, fr;q=0.3')).toBe('fr');
    expect(parseAcceptLanguage('de;q=0')).toBeNull();
  });

  it('returns null when nothing is supported', () => {
    expect(parseAcceptLanguage('ja, ko')).toBeNull();
    expect(parseAcceptLanguage('')).toBeNull();
  });
});

describe('localeFromHeaders', () => {
  it('prefers the explicit app header over the cookie and Accept-Language', () => {
    expect(localeFromHeaders({
      explicit: 'fr',
      cookie: 'NEXT_LOCALE=de; other=x',
      acceptLanguage: 'zh',
    })).toBe('fr');
  });

  it('falls back to the NEXT_LOCALE cookie when there is no explicit header', () => {
    expect(localeFromHeaders({ cookie: 'a=1; NEXT_LOCALE=de; b=2', acceptLanguage: 'zh' })).toBe('de');
  });

  it('falls back to Accept-Language when neither is present', () => {
    expect(localeFromHeaders({ acceptLanguage: 'es-MX,es;q=0.9' })).toBe('es');
  });

  it('ignores an unsupported cookie value and keeps looking', () => {
    expect(localeFromHeaders({ cookie: 'NEXT_LOCALE=ja', acceptLanguage: 'fr' })).toBe('fr');
  });

  it('returns null when a request expresses nothing usable', () => {
    expect(localeFromHeaders({})).toBeNull();
  });
});

describe('the email catalog', () => {
  it('covers every supported locale', () => {
    expect(Object.keys(EMAIL_MESSAGES).sort()).toEqual([...EMAIL_LOCALES].sort());
  });

  /** Walk a nested copy object into `a.b.c` leaf paths. */
  function leafPaths(node: unknown, prefix = ''): string[] {
    if (typeof node === 'string') return [prefix];
    if (Array.isArray(node)) return node.flatMap((v, i) => leafPaths(v, `${prefix}[${i}]`));
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
    }
    return [];
  }

  const enPaths = leafPaths(EMAIL_MESSAGES.en).sort();

  it.each(EMAIL_LOCALES)('%s has exactly the same keys as en', (locale) => {
    expect(leafPaths(EMAIL_MESSAGES[locale]).sort()).toEqual(enPaths);
  });

  it.each(EMAIL_LOCALES.filter((l) => l !== 'en'))(
    '%s is actually translated, not an English copy',
    (locale) => {
      // A handful of strings legitimately match English (brand names, "{{Ok}} /
      // {{Probed}} ok", "Status"/"Portfolio" in some languages). What must NOT
      // happen is the catalog being a wholesale copy, so assert the overwhelming
      // majority of leaves differ.
      const enLeaves = collect(EMAIL_MESSAGES.en);
      const leaves = collect(EMAIL_MESSAGES[locale]);
      const differing = enPaths.filter((p) => enLeaves[p] !== leaves[p]).length;
      expect(differing / enPaths.length).toBeGreaterThan(0.9);
    },
  );

  function collect(node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
    if (typeof node === 'string') { out[prefix] = node; return out; }
    if (Array.isArray(node)) { node.forEach((v, i) => collect(v, `${prefix}[${i}]`, out)); return out; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) collect(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }

  it.each(EMAIL_LOCALES)('%s leaves no placeholder unpaired with en', (locale) => {
    // A translator dropping `{{Code}}` would silently ship an email with no code
    // in it. Assert every string carries the same placeholder set as its English
    // counterpart.
    const enLeaves = collect(EMAIL_MESSAGES.en);
    const leaves = collect(EMAIL_MESSAGES[locale]);
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const path of enPaths) {
      expect(placeholders(leaves[path]!), `${locale} ${path}`).toEqual(placeholders(enLeaves[path]!));
    }
  });

  it('falls back to English for a locale outside the supported set', () => {
    expect(emailCopy('ja' as never)).toBe(EMAIL_MESSAGES.en);
  });
});

describe('isEmailLocale', () => {
  it('accepts supported locales and rejects everything else', () => {
    expect(isEmailLocale('zh')).toBe(true);
    expect(isEmailLocale('ja')).toBe(false);
    expect(isEmailLocale(null)).toBe(false);
    expect(isEmailLocale(5)).toBe(false);
  });
});
