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
 */
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const makeT = (namespace?: string) => {
    const key = (k: string) => (namespace ? `${namespace}.${k}` : k);
    const t = (k: string) => key(k);
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
