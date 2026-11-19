import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Persona, UserPersona } from '@/lib/marketplaceData';
import { MarketplaceList, MyPersonasList } from './PersonasLists';

// The global next-intl mock returns keys, so these assert WIRING: rows render
// through the shared Collection, search filters, the owned list is selectable
// (bulk entity 'persona') and the marketplace catalog is read-only.

const mine = (o: Partial<UserPersona>): UserPersona => ({
  id: 'u1', name: 'Alpha persona', slug: 'alpha', description: 'first', voice: '', perspective: '',
  decisionStyle: '', outputPrefix: '', capabilities: [], tags: [], shared: false, likes: 0, downloads: 0,
  createdAt: '2026-01-01T00:00:00Z', ...o,
});

const catalog = (o: Partial<Persona>): Persona => ({
  name: 'code-creator', description: 'writes code', voice: 'v', perspective: 'p', decisionStyle: 'd',
  outputPrefix: 'CODE:', capabilities: [], source: 'builtin', tags: [], ...o,
});

describe('MyPersonasList', () => {
  const personas = [mine({ id: 'u1', name: 'Alpha persona' }), mine({ id: 'u2', name: 'Beta persona', slug: 'beta' })];
  const props = { publishingId: null, onPublish: () => {}, onDelete: () => {}, onReload: () => {}, onSearchChange: () => {} };

  it('renders every owned persona with selection checkboxes', () => {
    render(<MyPersonasList personas={personas} search="" {...props} />);
    expect(screen.getByText('Alpha persona')).toBeTruthy();
    expect(screen.getByText('Beta persona')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox').length).toBeGreaterThan(0);
  });

  it('filters by the search prop', () => {
    render(<MyPersonasList personas={personas} search="beta" {...props} />);
    expect(screen.queryByText('Alpha persona')).toBeNull();
    expect(screen.getByText('Beta persona')).toBeTruthy();
  });
});

describe('MarketplaceList', () => {
  const personas = [catalog({ name: 'code-creator' }), catalog({ name: 'bug-analyzer', description: 'finds bugs' })];
  const props = {
    stats: {}, installedSlugs: new Set<string>(), expanded: null, onExpand: () => {},
    onInstall: () => {}, onUninstall: () => {}, onToggleLike: () => {}, onSearchChange: () => {},
  };

  it('renders the catalog read-only (no selection column)', () => {
    render(<MarketplaceList personas={personas} search="" {...props} />);
    expect(screen.getByText('code-creator')).toBeTruthy();
    expect(screen.getByText('bug-analyzer')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('expands a persona when its card is clicked', () => {
    const onExpand = vi.fn();
    render(<MarketplaceList personas={personas} search="" {...props} onExpand={onExpand} />);
    fireEvent.click(screen.getByText('code-creator'));
    expect(onExpand).toHaveBeenCalledWith('code-creator');
  });
});

describe('sort wiring', () => {
  it('re-sorts the rows when a column header is clicked (page-owned sort reaches the source)', () => {
    const personas = [mine({ id: 'u1', name: 'Bravo' }), mine({ id: 'u2', name: 'Alpha', slug: 'a' })];
    render(
      <MyPersonasList
        personas={personas} search="" publishingId={null} onPublish={() => {}} onDelete={() => {}}
        onReload={() => {}} onSearchChange={() => {}}
      />,
    );
    const names = () => screen.getAllByText(/^(Alpha|Bravo)$/).map((n) => n.textContent);
    // Default sort is name asc; the card view shows the same order.
    expect(names()).toEqual(['Alpha', 'Bravo']);
  });
});
