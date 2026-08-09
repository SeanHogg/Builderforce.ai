import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import { PUBLIC_DESTINATIONS, columnOf, destTitleKey, footerColumns } from '@/lib/navGroups';
import MarketingHeader from './MarketingHeader';
import AppFooter from './AppFooter';

/**
 * The public menus, RENDERED (PRD 21 §11.4.6–7).
 *
 * `unifiedMenu.test.ts` proves the registry's shape and `check-destinations`
 * proves there is one of it. Neither could see the failure that actually
 * shipped: the menus and the footer rendering the wrong thing on screen — a
 * flat Learn list where a three-column menu was designed, the storefront called
 * "Talent / Workforce" in the bar and "Workforce Registry" in the footer, an
 * `/agents` link outliving its destination, and a raw `marketplace.family.company`
 * where a label belonged.
 *
 * A missing message renders as its own dotted key, so asserting that no visible
 * text looks like one catches every un-translated string in a menu at once.
 */

// The global setup mock returns the KEY, which is exactly what this file needs
// to distinguish from a real label — so it reads the real catalog instead.
vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
    (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
  ),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('./HeaderCartButton', () => ({ HeaderCartButton: () => null }));
vi.mock('@/app/ThemeProvider', () => ({ ThemeToggleButton: () => null }));
vi.mock('./legal/useLegalDocs', () => ({
  useLegalDocs: () => ({ appVersion: '0', apiVersion: '0', legal: null, termsVersion: '1', privacyVersion: '1' }),
}));
vi.mock('./legal/LegalDocModal', () => ({ default: () => null }));

const renderWithCopy = (ui: React.ReactElement) => render(ui);

/** Walk the English catalog to the string a registry key names. */
const copyAt = (key: string): string =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en) as string;

/** Anything that still looks like `namespace.key.path` never got translated. */
const RAW_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){2,}$/;

describe('the marketing header renders the registry, not a raw key', () => {
  it('shows every Product and Learn row under its column heading', () => {
    renderWithCopy(<MarketingHeader />);

    for (const column of ['idea', 'make', 'run', 'read', 'prove', 'buildWith'] as const) {
      const heading = en.marketingNav.column[column];
      expect(screen.getAllByText(heading).length, `${column} has no heading`).toBeGreaterThan(0);

      for (const entry of columnOf(column)) {
        const title = copyAt(destTitleKey(entry));
        expect(screen.getAllByText(title).length, `${entry.id} is missing from the ${column} column`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves no untranslated key anywhere in the header', () => {
    const { container } = renderWithCopy(<MarketingHeader />);
    const raw = [...container.querySelectorAll('a, button, strong, small, h4, div')]
      .map((node) => node.textContent?.trim() ?? '')
      .filter((text) => RAW_KEY.test(text));
    expect(raw).toEqual([]);
  });

  it('calls the storefront Marketplace, and offers no /agents destination', () => {
    const { container } = renderWithCopy(<MarketingHeader />);
    expect(screen.getAllByText('Marketplace').length).toBeGreaterThan(0);
    expect(screen.queryByText('Talent / Workforce')).toBeNull();
    expect(container.querySelector('a[href="/agents"]')).toBeNull();
  });

  it('opens the canvas rather than a signup form', () => {
    const { container } = renderWithCopy(<MarketingHeader />);
    expect(container.querySelector('a.mh-cta')?.getAttribute('href')).toBe('/create/new');
  });
});

describe('the footer is the same registry, one column deeper', () => {
  it('renders each column with the destination’s own name', () => {
    renderWithCopy(<AppFooter variant="full" />);
    const nav = screen.getByRole('navigation', { name: en.footer.navLabel });

    for (const column of footerColumns()) {
      for (const link of column.links) {
        const title = copyAt(destTitleKey(link));
        expect(within(nav).getAllByText(title).length, `${link.id} is missing from the footer`).toBeGreaterThan(0);
      }
    }
  });

  it('no longer says "Workforce Registry" or links to /agents', () => {
    const { container } = renderWithCopy(<AppFooter variant="full" />);
    expect(screen.queryByText('Workforce Registry')).toBeNull();
    expect(container.querySelector('a[href="/agents"]')).toBeNull();
  });

  it('leaves no untranslated key in the footer either', () => {
    const nav = renderWithCopy(<AppFooter variant="full" />).container.querySelector('.global-footer-cols');
    const raw = [...(nav?.querySelectorAll('a, h3') ?? [])]
      .map((node) => node.textContent?.trim() ?? '')
      .filter((text) => RAW_KEY.test(text));
    expect(raw).toEqual([]);
  });
});

describe('every public destination can actually be named', () => {
  it('resolves a title for every row in the English catalog', () => {
    const missing = PUBLIC_DESTINATIONS.filter((entry) => {
      const value = copyAt(destTitleKey(entry));
      return typeof value !== 'string' || value.length === 0;
    });
    expect(missing.map((entry) => entry.id)).toEqual([]);
  });
});
