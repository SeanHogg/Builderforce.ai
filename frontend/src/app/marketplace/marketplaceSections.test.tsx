/**
 * @vitest-environment jsdom
 *
 * The search-box sections table. A new category is a row here; the page only
 * asks `searchSectionFor`. Jobs is the find-work board locked to `fte`, so the
 * one `listJobs()` read is what it fires — narrowed server-side, not filtered
 * from a second copy of the list.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { searchSectionFor } from './marketplaceSections';

const boardProps = vi.fn();
vi.mock('./MarketplaceGigsSection', () => ({
  default: (props: { search: string; engagement?: string }) => {
    boardProps(props);
    return <div data-testid="board" />;
  },
}));

describe('searchSectionFor', () => {
  it('has a row for every search-box section, jobs included', () => {
    for (const id of ['gigs', 'jobs', 'knowledge', 'templates']) {
      expect(searchSectionFor(id), id).not.toBeNull();
    }
  });

  it('leaves the sections the page renders itself to the page', () => {
    for (const id of ['all', 'workforce', 'talent', 'company', 'creations', 'publish', 'toString']) {
      expect(searchSectionFor(id), id).toBeNull();
    }
  });

  it('renders Jobs as the find-work board locked to full-time roles', async () => {
    const Jobs = searchSectionFor('jobs')!;
    const { findByTestId } = render(<Jobs search="rust" />);
    await findByTestId('board');
    await waitFor(() => expect(boardProps).toHaveBeenCalledWith({ search: 'rust', engagement: 'fte' }));
  });
});
