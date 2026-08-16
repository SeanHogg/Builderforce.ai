// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The version chip and its unread badge.
 *
 * What these pin is the reason the component exists: the chip is ONE component
 * rendered by two strips, it decides for itself whether a badge is warranted,
 * and pressing it both opens the panel and clears the badge — so no host has to
 * remember either half.
 *
 * Asserted against the REAL catalog, so a badge label that stopped resolving
 * would fail here rather than shipping a raw dotted key into the footer.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const store = vi.hoisted(() => ({ unread: 0 }));
const spies = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/lib/betaPrograms', () => ({ useProductUpdatesUnread: () => store.unread }));
vi.mock('@/lib/productUpdates', () => ({ openProductUpdates: spies.open }));

import ProductUpdatesTrigger from './ProductUpdatesTrigger';

const chip = () => render(
  <ProductUpdatesTrigger appVersion="2026.8.23" apiVersion="2026.8.16" className="global-footer-link" />,
);

beforeEach(() => {
  vi.clearAllMocks();
  store.unread = 0;
});

describe('ProductUpdatesTrigger', () => {
  it('shows the versions and no badge when there is nothing new', () => {
    chip();
    expect(screen.getByRole('button').textContent).toContain('UI 2026.8.23');
    expect(screen.getByRole('button').textContent).toContain('API 2026.8.16');
    // A signed-out visitor, or someone up to date — the chip renders no badge of
    // its own accord rather than a host deciding for it.
    expect(screen.queryByLabelText(/new update/i)).toBeNull();
  });

  it('badges the count, named for a screen reader', () => {
    store.unread = 3;
    chip();
    expect(screen.getByLabelText('3 new updates').textContent).toBe('3');
  });

  it('says "one" rather than a bare number for a single update', () => {
    store.unread = 1;
    chip();
    expect(screen.getByLabelText('1 new update')).toBeTruthy();
  });

  it('caps the badge at 9+ so the strip cannot wrap, and still counts truthfully', () => {
    store.unread = 23;
    chip();
    const badge = screen.getByLabelText('23 new updates');
    expect(badge.textContent).toBe('9+');
  });

  it('opens the panel when pressed', () => {
    store.unread = 3;
    chip();
    fireEvent.click(screen.getByRole('button'));
    expect(spies.open).toHaveBeenCalledTimes(1);
  });

  it('still renders while the API version is loading', () => {
    render(<ProductUpdatesTrigger appVersion="2026.8.23" apiVersion={null} className="legal-corner-link" />);
    expect(screen.getByRole('button').textContent).toContain('API …');
  });
});
