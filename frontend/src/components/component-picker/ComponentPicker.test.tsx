import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '@/i18n/messages/en.json';
import { ComponentPicker } from './ComponentPicker';
import { listComponentsForMount } from '@/lib/components/registry';

/**
 * ONE PANEL, TWO ERRANDS.
 *
 * What is pinned here is the property that made the extraction worth doing: the
 * picker offers what a MOUNT can render and nothing else, and the errand is
 * supplied by the caller rather than chosen by a branch inside the panel. Before
 * this, the dashboard's picker was the only one, the canvas had no picker at all,
 * and the id was typed by hand.
 *
 * The search assertion is the one that would rot quietly. It matches on the
 * rendered LABEL, so a future refactor that filters on `titleKey` instead would
 * still pass a naive "it filters" test while silently breaking search for every
 * component whose key and label differ — which is most of them.
 */

// `usePermission` reaches for tenant/session context this test does not stand up.
// The gate itself is the ACTION's concern and is asserted where the action lives;
// here it must simply not stop the panel rendering.
vi.mock('@/lib/rbac', () => ({
  usePermission: () => ({ allowed: true, reason: null }),
  RoleGate: ({ children }: { children: React.ReactNode }) => children,
}));

// The global mock in `test/setup.ts` returns the KEY, which is right for a test
// that only needs a component to render. This one asserts that search matches the
// words a reader can SEE, so it needs the real catalog — through the one shared
// resolver rather than a sixth hand-rolled copy of it.
vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
    (await import('@/i18n/messages/en.json')).default as unknown as Record<string, unknown>,
  ),
}));

function renderPicker(props: Partial<React.ComponentProps<typeof ComponentPicker>> = {}) {
  return render(
    <ComponentPicker
      open
      onClose={() => {}}
      mount="canvas"
      title="Add a component"
      action={(def) => <button type="button" data-testid={`use-${def.id}`}>Use</button>}
      {...props}
    />,
  );
}

const search = () => screen.getByPlaceholderText(en.components.searchPlaceholder);

describe('ComponentPicker', () => {
  it('offers only what the requested mount can render', () => {
    renderPicker();
    // A dashboard-only tile must not be offered as a board card: it was never
    // designed for one, and `getComponentForMount` would refuse it on render.
    const canvasIds = new Set(listComponentsForMount('canvas').map((c) => c.id));
    const dashboardOnly = listComponentsForMount('dashboard').find((c) => !canvasIds.has(c.id));
    expect(dashboardOnly, 'expected at least one dashboard-only component to exist').toBeDefined();
    expect(screen.queryByTestId(`use-${dashboardOnly!.id}`)).toBeNull();
    // And something the canvas CAN render is offered.
    const [first] = listComponentsForMount('canvas');
    expect(screen.getByTestId(`use-${first!.id}`)).toBeTruthy();
  });

  it('renders the caller-supplied errand for every row', () => {
    renderPicker();
    const offered = screen.getAllByText('Use');
    expect(offered.length).toBe(listComponentsForMount('canvas').length);
  });

  it('searches on the visible label, not the translation key', () => {
    renderPicker();
    // 'Vendor Register' is the LABEL of the component whose titleKey is
    // `app.vendors` — typing the label must find it.
    fireEvent.change(search(), { target: { value: 'vendor register' } });
    expect(screen.getByTestId('use-vendors')).toBeTruthy();
    expect(screen.queryByTestId('use-kanban')).toBeNull();
  });

  it('finds a component by the id a board card actually stores', () => {
    renderPicker();
    fireEvent.change(search(), { target: { value: 'rice-matrix' } });
    expect(screen.getByTestId('use-rice-matrix')).toBeTruthy();
  });

  it('says so when nothing matches, rather than showing bare headings', () => {
    renderPicker();
    fireEvent.change(search(), { target: { value: 'zzzznothing' } });
    expect(screen.getByText(en.components.noMatches)).toBeTruthy();
  });
});
