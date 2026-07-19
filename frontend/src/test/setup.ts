import '@testing-library/jest-dom';
import { vi } from 'vitest';

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
  return {
    ...actual,
    useTranslations: (namespace?: string) => makeT(namespace),
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
  return {
    ...actual,
    useAuth: () => ({
      user: null,
      tenant: { role: 'owner' },
      webToken: null,
      tenantToken: null,
      isAuthenticated: true,
      hasTenant: true,
      login: async () => {},
      register: async () => {},
      selectTenant: async () => {},
      fetchTenants: async () => [],
      logout: () => {},
    }),
  };
});
