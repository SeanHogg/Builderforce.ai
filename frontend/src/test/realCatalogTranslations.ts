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

function build(messages: Messages, namespace: string | undefined): RealCatalogTranslator {
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
}

/**
 * ONE `t` per namespace, for the lifetime of the catalog.
 *
 * Referential stability is part of `useTranslations`' contract — the real hook
 * memoizes per (locale, namespace), and components depend on that: a `t` in a
 * `useMemo`/`useCallback` dependency array is extremely common, and a fresh
 * function on every render invalidates the whole chain hanging off it.
 *
 * A mock that returned a new `t` per call is what made `CreationCanvas.test.tsx`
 * hang for hours with no test ever timing out. The 3D scene derives its scene
 * from `describe` (whose deps include `t`), derives `lifted` from that scene, and
 * publishes a `controls` object built from `lifted` into a context the canvas
 * itself consumes. With an unstable `t` every link in that chain was new on every
 * render, so publishing re-rendered the canvas, which rebuilt `t`, which rebuilt
 * `controls`, which published again — an unbounded effect loop that never yields
 * to the event loop, which is exactly why a `--testTimeout` never fired.
 *
 * The production code was never at fault; the mock simply did not honour the
 * contract it was standing in for.
 */
const CACHE = new WeakMap<Messages, Map<string, RealCatalogTranslator>>();

/** A `useTranslations` stand-in bound to a real catalog. */
export function realCatalogTranslator(messages: Messages) {
  return (namespace?: string): RealCatalogTranslator => {
    let byNamespace = CACHE.get(messages);
    if (!byNamespace) CACHE.set(messages, byNamespace = new Map());
    const key = namespace ?? '';
    const cached = byNamespace.get(key);
    if (cached) return cached;
    const translator = build(messages, namespace);
    byNamespace.set(key, translator);
    return translator;
  };
}

/**
 * The WHOLE `next-intl` module override for a real-catalog test.
 *
 * Twelve test files were each writing `{ ...(await importOriginal()), useTranslations: realCatalogTranslator(en) }`
 * by hand. Spreading the real module leaves every OTHER next-intl hook real, and
 * a real hook throws outside a provider — so the moment a component anywhere in
 * the rendered tree called `useLocale()` (a read-aloud control on the node
 * header), 152 tests across nine files failed at once with "No intl context
 * found", none of which had anything to do with what they were testing.
 *
 * The global mock in `src/test/setup.ts` already covers the whole surface; these
 * files only differ in wanting REAL catalog copy instead of key passthrough. So
 * this returns the same complete override with only `useTranslations` swapped —
 * one place to fix the next time next-intl grows a hook.
 */
export async function realCatalogIntlMock(messages: Messages) {
  const actual = await import('next-intl');
  return {
    ...actual,
    useTranslations: realCatalogTranslator(messages),
    useLocale: () => 'en',
    useMessages: () => messages,
    useFormatter: () => ({
      dateTime: (value: unknown) => String(value),
      number: (value: unknown) => String(value),
      relativeTime: (value: unknown) => String(value),
      list: (value: unknown) => String(value),
    }),
    NextIntlClientProvider: ({ children }: { children: unknown }) => children,
  };
}
