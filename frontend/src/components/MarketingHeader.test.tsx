import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const routing = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => routing.pathname }));

vi.mock('./HeaderCartButton', () => ({ HeaderCartButton: () => <span>Cart</span> }));
vi.mock('@/app/ThemeProvider', () => ({ ThemeToggleButton: () => <span>Theme</span> }));

const localWork = vi.hoisted(() => ({ sessions: [] as Array<{ sessionId: string }> }));
vi.mock('@/domains/canvas/infrastructure/localCanvasStore', () => ({ listLocalCreationSessions: () => localWork.sessions }));

const { default: MarketingHeader } = await import('./MarketingHeader');

describe('the marketing header CTA on a canvas route', () => {
  beforeEach(() => {
    routing.pathname = '/create/local-session-1';
    localWork.sessions = [];
  });

  it('offers "Get Started" while the guest board is still empty', () => {
    render(<MarketingHeader />);
    expect(screen.getAllByRole('link', { name: /get started/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Keep your work' })).toBeNull();
  });

  it('switches to "Keep your work" once this browser holds real local canvas work', () => {
    localWork.sessions = [{ sessionId: 'local-session-1' }];
    render(<MarketingHeader />);
    const ctas = screen.getAllByRole('link', { name: 'Keep your work' });
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      // It carries the board back. This CTA is now the ONLY offer to keep a guest
      // board — the canvas dropped its own "Save & collaborate" so one screen stopped
      // holding two bars saying the same word — so landing back on the canvas after
      // sign-up is this link's job, not a nicety.
      expect(cta.getAttribute('href')).toBe('/register?next=%2Fcreate%2Flocal-session-1');
      // Never the same visual language as the plain invitation — the offer only
      // exists once there is something to lose.
      expect(cta.className).toContain('mh-cta-keep');
    }
  });

  it('never shows the "keep" CTA on a plain marketing page, whatever this browser holds', () => {
    routing.pathname = '/';
    localWork.sessions = [{ sessionId: 'local-session-1' }];
    render(<MarketingHeader />);
    expect(screen.queryByRole('link', { name: 'Keep your work' })).toBeNull();
    expect(screen.getAllByRole('link', { name: /open the canvas/i }).length).toBeGreaterThan(0);
  });
});
