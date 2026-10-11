/**
 * @vitest-environment jsdom
 *
 * The search-box sections table. A new category is a row here; the page only
 * asks `hasSearchSection` and renders `MarketplaceSearchSection`. Jobs is the find-work board locked to `fte`, so the
 * one `listJobs()` read is what it fires — narrowed server-side, not filtered
 * from a second copy of the list.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { hasSearchSection, MarketplaceSearchSection } from './marketplaceSections';

const boardProps = vi.fn();
vi.mock('./MarketplaceGigsSection', () => ({
  default: (props: { search: string; engagement?: string }) => {
    boardProps(props);
    return <div data-testid="board" />;
  },
}));

describe('marketplace search sections', () => {
  it('has a row for every search-box section, jobs included', () => {
    for (const id of ['gigs', 'jobs', 'knowledge', 'templates']) {
      expect(hasSearchSection(id), id).toBe(true);
    }
  });

  it('renders nothing for a section the page owns', () => {
    const { container } = render(<MarketplaceSearchSection section="talent" search="" />);
    expect(container.innerHTML).toBe('');
  });

  it('leaves the sections the page renders itself to the page', () => {
    for (const id of ['all', 'workforce', 'talent', 'company', 'creations', 'publish', 'toString']) {
      expect(hasSearchSection(id), id).toBe(false);
    }
  });

  it('renders Jobs as the find-work board locked to full-time roles', async () => {
    const { findByTestId } = render(<MarketplaceSearchSection section="jobs" search="rust" />);
    await findByTestId('board');
    await waitFor(() => expect(boardProps).toHaveBeenCalledWith({ search: 'rust', engagement: 'fte' }));
  });
});
