import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import en from './messages/en.json';
import zh from './messages/zh.json';
import es from './messages/es.json';
import fr from './messages/fr.json';
import de from './messages/de.json';
import { LOCALES, DEFAULT_LOCALE, type Locale } from './config';

/**
 * Catalog guard for the five message files.
 *
 * Two failure modes had no test and both render the same way in the product —
 * as the raw dotted key, in the middle of the UI:
 *
 *  1. A key added to `en.json` and not to the other four. The localize-in-the-
 *     same-pass rule says every string ships translated; nothing enforced it.
 *  2. A message whose ICU syntax is malformed (an unclosed `{`, a plural with no
 *     `other` arm). next-intl swallows the format error and falls back to the key,
 *     so a broken message looks exactly like a missing one and passes every other
 *     test in the suite.
 *
 * This asserts BOTH across every catalog: identical key sets, and every message
 * actually formatting to something that is not its own key.
 */

const CATALOGS: Record<Locale, Record<string, unknown>> = { en, zh, es, fr, de } as never;

type Leaf = { path: string; message: string };

/** Flatten a catalog to dotted leaf paths, ignoring non-string leaves. */
function leaves(obj: Record<string, unknown>, prefix = ''): Leaf[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) return leaves(v as Record<string, unknown>, path);
    return typeof v === 'string' ? [{ path, message: v }] : [];
  });
}

/**
 * The arguments a SPECIFIC message needs, read off its own placeholders.
 *
 * A generic catch-all bag does not work — next-intl throws on a missing argument,
 * so a message's values have to be derived from the message itself. Every argument
 * gets the number 2: valid for plain interpolation and for `plural`/`selectordinal`
 * alike (a `select` with no matching arm falls back to its `other`).
 */
function argsFor(message: string): Record<string, number> {
  const args: Record<string, number> = {};
  for (const [, name] of message.matchAll(/\{\s*([a-zA-Z_]\w*)\s*[,}]/g)) args[name] = 2;
  return args;
}

/** Rich messages carry `<tag>` markup and must be formatted through `t.rich`. */
const hasTags = (message: string): boolean => /<[a-zA-Z]\w*>/.test(message);

const QUICK_START_KEYS = [
  'sectionTitle',
  'modeOneliner',
  'modeHackable',
  'change',
  'beta',
  'copyCommandAria',
  'macosTagline',
  'macosSubtitle',
  'macosDownload',
  'macosMeta',
  'note',
] as const;

/** Tag handlers for `t.rich` — every tag renders its chunks unchanged. */
const tagsFor = (message: string): Record<string, (chunks: unknown) => unknown> =>
  Object.fromEntries(
    [...message.matchAll(/<([a-zA-Z]\w*)>/g)].map(([, tag]) => [tag, (chunks: unknown) => chunks]),
  );

describe('message catalogs', () => {
  const enPaths = leaves(en as Record<string, unknown>).map((l) => l.path);

  it.each(LOCALES)('%s has every QuickStart message', (locale) => {
    const quickStart = CATALOGS[locale].quickStart as Record<string, unknown> | undefined;
    expect(quickStart).toBeDefined();
    expect(Object.keys(quickStart ?? {}).sort()).toEqual([...QUICK_START_KEYS].sort());
  });

  it.each(LOCALES)('%s has the managed-no-role stall label in the manager namespace', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    expect(t('manager.stalls.cause.managed_no_role' as never)).not.toBe(
      'manager.stalls.cause.managed_no_role',
    );
  });

  it.each(LOCALES.filter((l) => l !== DEFAULT_LOCALE))('%s has exactly the keys en has', (locale) => {
    const paths = new Set(leaves(CATALOGS[locale]).map((l) => l.path));
    const missing = enPaths.filter((p) => !paths.has(p));
    const extra = [...paths].filter((p) => !enPaths.includes(p));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(LOCALES)('%s: every message formats instead of falling back to its key', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    const broken: string[] = [];
    for (const { path, message } of leaves(CATALOGS[locale])) {
      let out: string;
      try {
        out = hasTags(message)
          ? String(t.rich(path as never, { ...argsFor(message), ...tagsFor(message) } as never))
          : String(t(path as never, argsFor(message) as never));
      } catch {
        broken.push(path);
        continue;
      }
      // next-intl returns the key path verbatim when a message is missing or its
      // ICU fails to parse — the exact symptom this guards against.
      if (out === path) broken.push(path);
    }
    expect(broken).toEqual([]);
  });
});
