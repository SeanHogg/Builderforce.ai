import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `src/test/setup.ts` stubs `useAuth` globally so any component can render
// without a provider. This file is testing the provider ITSELF, so it opts back
// into the real module — the per-file override the setup comment describes.
vi.mock('@/lib/AuthContext', async (importOriginal) => await importOriginal<typeof import('./AuthContext')>());

const { AuthProvider, useAuth } = await import('./AuthContext');

/**
 * The server render is the product surface here, not an implementation detail.
 *
 * `AuthProvider` used to return `null` until it had read the stored session off
 * localStorage. localStorage does not exist on the server, so that read could
 * only ever happen after hydration — which made the SERVER render of every route
 * an empty document. The delivered HTML for the marketing home page contained
 * exactly one piece of text, the skip link: no product name, no description,
 * nothing a crawler, a link unfurler or an OAuth branding review could read. It
 * presented as "the home page is behind a login".
 *
 * These tests pin the two halves of the fix: children render on the server, and
 * `authReady` is false there so that anything which would ACT on being signed out
 * (a redirect to /login, opening a guest board) can tell "signed out" apart from
 * "not known yet". See `useRequireAuth`, which is where that rule now lives.
 */
describe('AuthProvider server render', () => {
  function Probe() {
    const { authReady, isAuthenticated } = useAuth();
    return (
      <p data-ready={String(authReady)} data-authed={String(isAuthenticated)}>
        hello from the server
      </p>
    );
  }

  it('renders its children instead of blanking the tree', () => {
    const html = renderToStaticMarkup(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(html).toContain('hello from the server');
  });

  it('reports authReady false on the server, so guards can wait rather than bounce', () => {
    const html = renderToStaticMarkup(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(html).toContain('data-ready="false"');
    expect(html).toContain('data-authed="false"');
  });

  it('still provides a usable context to consumers', () => {
    const spy = vi.fn();
    function CallsLogout() {
      const { logout } = useAuth();
      spy(typeof logout);
      return null;
    }
    renderToStaticMarkup(
      <AuthProvider>
        <CallsLogout />
      </AuthProvider>,
    );

    expect(spy).toHaveBeenCalledWith('function');
  });
});
