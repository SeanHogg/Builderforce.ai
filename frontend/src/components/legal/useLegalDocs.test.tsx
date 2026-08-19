/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/legalDocs', () => ({ fetchLegalCurrent: async () => null }));
vi.mock('@/lib/appVersions', () => ({
  APP_VERSION: '2026.8.99',
  fetchApiVersion: async () => null,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/betaPrograms', () => ({ useProductUpdatesUnread: () => 0 }));
vi.mock('@/lib/productUpdates', () => ({ openProductUpdates: () => {} }));

import { useLegalDocs } from './useLegalDocs';
import ProductUpdatesTrigger from '../releaseNotes/ProductUpdatesTrigger';

/**
 * THE BUILD STAMP MUST NOT BE IN THE FIRST RENDER.
 *
 * `NEXT_PUBLIC_APP_VERSION` is inlined at compile time — into the server bundle when
 * it is built, and into the client chunks when THEY are built. It is the one string in
 * the app whose entire purpose is to differ between builds, so the moment the running
 * server and the chunk in the browser come from different ones, the same text node
 * renders two different values and React throws the whole server tree away and
 * re-renders the app on the client (#418). That was observed on the canvas route:
 * server `2026.8.60`, client `2026.8.56`, one `<button>` in the sidebar's legal strip.
 *
 * The invariant that prevents it is small and testable: the FIRST render — the one the
 * server also performs — must not contain the version at all.
 */
describe('the version stamp and hydration', () => {
  it('withholds the build version from the first render, then supplies it', async () => {
    // Every render's value, in order — `renderHook().result` only ever shows the
    // latest, and the render under test is the FIRST one, before effects.
    const seen: (string | null)[] = [];
    function Chip() {
      const { appVersion, apiVersion } = useLegalDocs();
      seen.push(appVersion);
      return <ProductUpdatesTrigger appVersion={appVersion} apiVersion={apiVersion} className="strip" />;
    }

    // THE SERVER HALF: what SSR puts in the HTML. Effects do not run here, which is
    // exactly the render the browser is about to be asked to match.
    const server = renderToString(<Chip />);
    expect(server).not.toMatch(/\d{4}\.\d+\.\d+/);

    seen.length = 0;
    await act(async () => { render(<Chip />); });

    // THE CLIENT HALF: the first client render — the one compared against the HTML
    // above — agrees with it, and the real version arrives on a later commit.
    expect(seen[0]).toBeNull();
    await waitFor(() => expect(screen.getByRole('button').textContent).toContain('2026.8.99'));
  });

  /** And the chip renders that absence the same way it already renders an API version
   *  it does not have yet — a version not known YET and one not known AT ALL look
   *  alike, which is what they are. */
  it('renders an ellipsis rather than a version it must not commit to', async () => {
    await act(async () => {
      render(<ProductUpdatesTrigger appVersion={null} apiVersion={null} className="strip" />);
    });
    expect(screen.getByRole('button').textContent).toContain('UI … · API …');
    expect(screen.getByRole('button').textContent).not.toMatch(/\d{4}\.\d+\.\d+/);
  });
});
