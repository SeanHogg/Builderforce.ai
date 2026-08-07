/**
 * The REAL message catalogs, resolved the way next-intl resolves them.
 *
 * The global mock in `setup.ts` returns the key, which is right for a test that
 * only needs a component to render. A test that asserts on the copy a person
 * actually reads — "3 of 6 answered", "2 slides", "Ready to submit" — needs the
 * catalog, and five canvas test files had each grown their own hand-rolled copy
 * of that resolver. They drifted: only one handled `plural` forms, and NONE
 * carried `t.has`, so a component that probes for an optional key crashed under
 * test while working perfectly in the app.
 *
 * One resolver, so a translator the tests build cannot quietly be less capable
 * than the one the app uses.
 *
 * Use inside a hoisted `vi.mock` factory, which may not close over imports:
 *
 * ```ts
 * vi.mock('next-intl', async (importOriginal) => ({
 *   ...(await importOriginal<typeof import('next-intl')>()),
 *   useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
 *     (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
 *   ),
 * }));
 * ```
 */

type Messages = Record<string, unknown>;
type Values = Record<string, unknown>;

const PLURAL = /\{(\w+),\s*plural,\s*one \{([^}]*)\} other \{([^}]*)\}\}/g;

function lookup(messages: Messages, namespace: string | undefined, key: string): unknown {
  return (namespace ? `${namespace}.${key}` : key)
    .split('.')
    .reduce<unknown>((current, segment) => (
      current && typeof current === 'object' ? (current as Messages)[segment] : undefined
    ), messages);
}

export interface RealCatalogTranslator {
  (key: string, values?: Values): string;
  has: (key: string) => boolean;
}

/** A `useTranslations` stand-in bound to a real catalog. */
export function realCatalogTranslator(messages: Messages) {
  return (namespace?: string): RealCatalogTranslator => {
    const translate = (key: string, values?: Values) => {
      const value = lookup(messages, namespace, key);
      const copy = typeof value === 'string' ? value : namespace ? `${namespace}.${key}` : key;
      const pluralized = copy.replace(PLURAL, (_match, name: string, one: string, other: string) => {
        const count = Number(values?.[name]);
        return (count === 1 ? one : other).replace('#', String(count));
      });
      return Object.entries(values ?? {}).reduce(
        (result, [name, replacement]) => result.replaceAll(`{${name}}`, String(replacement)),
        pluralized,
      );
    };
    translate.has = (key: string) => typeof lookup(messages, namespace, key) === 'string';
    return translate;
  };
}
