import { vi } from 'vitest';

/**
 * THE DOM HALF OF SETUP, LOADED ONLY WHERE THERE IS A DOM.
 *
 * This file is the `setupFiles` entry for BOTH projects, and it runs per test
 * FILE — so every eager import here is paid 157 times by the `lib` project
 * alone, 134 of whose files run in `node` and have no document to match
 * against. `@testing-library/jest-dom` and `@testing-library/react` (which
 * drags in react-dom) were both at the top of this file unconditionally.
 *
 * Measured 2026-08-15 on the `lib` project: 815s of cumulative setup and 404s
 * of environment against 44s of actual tests. That cost is also what made the
 * suite's one intermittent failure possible — vitest's worker START_TIMEOUT is
 * a HARD-CODED 60s constant (`START_TIMEOUT` in the pool runner; there is no
 * config lever for it), and starting a worker means loading this file. A
 * jsdom-overriding file at the tail of a contended run has to build a document
 * AND pay this, and `lib/brain/platformActions.test.ts` went over the 60s cliff
 * — reported as `Failed to start threads worker`, which reads exactly like a
 * hang in the code under test.
 *
 * So the DOM half is behind a document check. The 23 `src/lib` files that carry
 * their own `@vitest-environment jsdom` docblock still get the matchers,
 * because they genuinely have a document; the 134 that do not, do not — and none
 * of them uses a jest-dom matcher, which `setupEnvironment.test.ts` asserts by
 * reading them, so the gate cannot rot into a confusing "not a function".
 */
if (typeof document !== 'undefined') {
  // The `/vitest` entry, not the bare package: it registers the matchers against
  // vitest's own `expect`, and its types are a MODULE, which a dynamic import
  // needs — the bare package's `types/index.d.ts` is a global augmentation, so
  // `await import('@testing-library/jest-dom')` typechecks as TS2306 even though
  // it runs fine. A side-effect `import` at the top of the file did not care;
  // moving it behind this check is what surfaced the difference.
  await import('@testing-library/jest-dom/vitest');
  const { configure } = await import('@testing-library/react');
  /**
   * `findBy*` / `waitFor` ceiling, raised from the 1s default.
   *
   * These queries POLL until the condition holds, so a longer ceiling cannot make a
   * wrong assertion pass — it only stops a correct one from being cut off. Under the
   * full suite (100+ jsdom files on a shared thread pool) a component whose first
   * paint is "loading…" can genuinely take more than a second of wall-clock to reach
   * its resolved state, which produced failures that vanished when the same file was
   * run alone. A test that fails for that reason is telling you about the scheduler,
   * not the code, and it trains people to re-run rather than read failures.
   *
   * Raised again (5s → 15s) on 2026-08-07: with the canvas suite finally able to
   * run to completion, two of its heaviest mounts were still being cut off inside
   * a 56-file `src/components` run while passing comfortably in a directory run of
   * their own — the same scheduler story, one level further up.
   */
  configure({ asyncUtilTimeout: 20_000 });
}

/**
 * Global next-intl mock for the test environment.
 *
 * Components migrated to next-intl call `useTranslations()` (or render under
 * `NextIntlClientProvider`). Under vitest there is no provider in the tree, so the
 * real hook throws "context from NextIntlClientProvider was not found" and fails
 * any test that renders such a component — even transitively (e.g. a project panel
 * embedding the PMO initiative picker). Rather than wrap every render in a provider
 * (not DRY, and easy to forget for the next i18n component), mock the module once
 * here so `t('key')` is a deterministic passthrough and the provider is inert. No
 * test asserts on translated copy, so returning the key is safe and stable.
 *
 * Interpolation values ARE appended after the key (`ns.key $0.42`), because the
 * value is often the whole point of the assertion — a spend readout, a count, an
 * agent name. Dropping them would silently turn "shows $0.42 spent" into "shows
 * a spend element". Assert with a regex over key + value.
 */
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const makeT = (namespace?: string) => {
    const key = (k: string, values?: Record<string, unknown>) => {
      const base = namespace ? `${namespace}.${k}` : k;
      const params = values ? Object.values(values).filter((v) => v != null) : [];
      return params.length > 0 ? `${base} ${params.join(' ')}` : base;
    };
    const t = (k: string, values?: Record<string, unknown>) => key(k, values);
    // Mirror the callable extras the real `t` carries so consumers don't crash.
    t.rich = (k: string) => key(k);
    t.markup = (k: string) => key(k);
    t.raw = (k: string) => key(k);
    t.has = () => true;
    return t;
  };
  /**
   * ONE `t` per namespace, because referential stability is part of the contract
   * this stands in for — the real hook memoizes per (locale, namespace), and a
   * fresh function per render invalidates every `useMemo`/`useCallback` that
   * lists `t` as a dependency. See `realCatalogTranslations.ts` for the hang that
   * cost: an unstable `t` there spun the 3D scene's publish→re-render→rebuild
   * cycle forever, with no test ever timing out.
   */
  const cache = new Map<string, ReturnType<typeof makeT>>();
  const cachedT = (namespace?: string) => {
    const key = namespace ?? '';
    const existing = cache.get(key);
    if (existing) return existing;
    const t = makeT(namespace);
    cache.set(key, t);
    return t;
  };
  return {
    ...actual,
    useTranslations: cachedT,
    useLocale: () => 'en',
    useMessages: () => ({}),
    useFormatter: () => ({
      dateTime: (v: unknown) => String(v),
      number: (v: unknown) => String(v),
      relativeTime: (v: unknown) => String(v),
      list: (v: unknown) => String(v),
    }),
    // Inert provider: render children directly (no context needed in tests).
    NextIntlClientProvider: ({ children }: { children: unknown }) => children,
  };
});

/**
 * Global Next.js navigation mock for the test environment.
 *
 * `useRouter()` throws "invariant expected app router to be mounted" outside a
 * real Next app, and `useSearchParams()` needs the same context — so any client
 * component that reads the URL or navigates (deep-linkable boards, panels with
 * `?tab=`) fails a plain `render()`. Mocked once here for the same reason as the
 * mocks below: the alternative is wrapping every render in an app-router
 * harness, which is neither DRY nor discoverable.
 *
 * Navigation is INERT: the router methods record calls without moving anywhere,
 * and the URL reads empty. A test asserting on navigation should assert against
 * these spies (or override per-file with its own `vi.mock`) — not assume a real
 * route change happened.
 */
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  };
  return {
    ...actual,
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({}),
  };
});

/**
 * Global confirm-dialog default for the test environment.
 *
 * `useConfirm()` throws "must be used within a ConfirmProvider" with no provider
 * in the tree, so any component that can delete/disconnect something (task
 * boards, agent capability rows, execution panels) fails a test that renders it
 * unwrapped — even when the test never triggers a confirmation. Same reasoning
 * as the mocks above: wrap once here rather than in every render call site.
 *
 * The stub RESOLVES TRUE, i.e. "the user pressed Confirm". A test that asserts
 * the cancel path should override this with its own per-file `vi.mock`, and a
 * test asserting that a destructive action was blocked must do so explicitly
 * rather than relying on the absence of a provider to throw.
 */
vi.mock('@/components/ConfirmProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ConfirmProvider')>();
  return {
    ...actual,
    useConfirm: () => async () => true,
  };
});

/**
 * Global toast default for the test environment.
 *
 * `useToast()` throws "must be used within a ToastProvider" with no provider in the tree,
 * exactly as `useConfirm()` above does — so any component that reports a failure to the
 * user (a connect/disconnect control, a probe button, a save) fails a test that renders it
 * unwrapped, even when the test never triggers a toast. Same reasoning as the mocks above:
 * stub it once here rather than at every render call site.
 *
 * The stub is INERT and records calls: a test asserting that something was reported should
 * assert against these spies (or override per-file), not infer it from a thrown error.
 */
vi.mock('@/components/ToastProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ToastProvider')>();
  const api = {
    show: vi.fn(() => 'toast'),
    success: vi.fn(() => 'toast'),
    error: vi.fn(() => 'toast'),
    info: vi.fn(() => 'toast'),
    warning: vi.fn(() => 'toast'),
    dismiss: vi.fn(),
  };
  return { ...actual, useToast: () => api };
});

/**
 * jsdom implements no ResizeObserver, so any component that measures itself to
 * fit its container (charts, the terminal, the mobile device simulator) throws
 * on mount under test while working fine in every real browser. Provide an inert
 * stub: it records nothing and never fires, which leaves those components at
 * their initial layout — enough to assert what they render.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * Global auth context default for the test environment.
 *
 * `useAuth()` throws "must be used within an AuthProvider" with no provider in the
 * tree — so any component embedding a {@link RoleGate}/`usePermission` (e.g. the PMO
 * initiative picker inside the project details panel) fails a test that renders it
 * without wrapping AuthProvider. Mirroring the existing per-file precedent
 * (FloatingBrain.test.tsx), default `useAuth` here to an owner-scoped workspace so
 * the REAL rbac logic runs and capability gates resolve `allowed` (controls stay
 * interactive, not disabled). Preserves every other export (AuthProvider, etc.);
 * a test needing different auth still overrides with its own per-file `vi.mock`.
 */
vi.mock('@/lib/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/AuthContext')>();
  const value = {
    user: null,
    tenant: { role: 'owner' },
    webToken: null,
    tenantToken: null,
    isAuthenticated: true,
    hasTenant: true,
    // The stored session is "already read" for tests. Omitting this leaves it
    // `undefined`, and anything that correctly waits for `authReady` before
    // acting on a signed-out session would then wait forever under test.
    authReady: true,
    login: async () => {},
    register: async () => {},
    selectTenant: async () => {},
    fetchTenants: async () => [],
    logout: () => {},
  };
  return {
    ...actual,
    useAuth: () => value,
    // `useOptionalAuth` must return the SAME identity, not the real (null)
    // context: `useRole` — and therefore every `usePermission`/`<RoleGate>` —
    // reads the optional hook. Mocking only `useAuth` left the role undefined,
    // so gated controls rendered disabled ("Requires Developer role") in tests
    // while working fine in the app, and the failure looked like a broken
    // control rather than a missing mock.
    useOptionalAuth: () => value,
  };
});
