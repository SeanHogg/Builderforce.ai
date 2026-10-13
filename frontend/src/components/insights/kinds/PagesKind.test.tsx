import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { panelKindDef } from '../panelKinds';
import { PagesKind, rankPages } from './PagesKind';

/**
 * The `pages` kind (PRD 33 §4.1, D16): the key pages ranked by opportunity, each
 * with its fold thumbnail, score and top fix; a row opens `route:<path>:review`.
 */

const PAGES = [
  { path: '/about', score: 90, topPrescriptionId: null, foldThumbUrl: null, opportunity: 0 },
  { path: '/pricing', score: 48, topPrescriptionId: 'rx-1', foldThumbUrl: '/api/replay/pages/captures/cap-1/fold?site=site-1', opportunity: 38 },
  { path: '/', score: 71, topPrescriptionId: null, foldThumbUrl: null, opportunity: 12 },
];

beforeEach(() => {
  vi.spyOn(replayApi, 'listPages').mockResolvedValue(PAGES);
  vi.spyOn(replayApi, 'listPrescriptions').mockResolvedValue([prescription()]);
  vi.spyOn(replayApi, 'captureAssetUrl').mockImplementation(async (path: string) => `blob:${path}`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PagesKind', () => {
  it('is registered as a panel kind', () => {
    expect(panelKindDef('pages')?.tabs.map((tab) => tab.Component)).toEqual([PagesKind]);
  });

  it('ranks by opportunity, then by the lower score', () => {
    expect(rankPages([...PAGES, { path: '/b', score: 30, topPrescriptionId: null, foldThumbUrl: null, opportunity: 12 }]).map((p) => p.path))
      .toEqual(['/pricing', '/b', '/', '/about']);
  });

  it('lists each page with its score, top fix and thumbnail, and opens its review', async () => {
    const push = vi.fn();
    render(<PagesKind siteId="site-1" id="" push={push} />);
    const list = await screen.findByTestId('pages-list');
    const rows = within(list).getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('data-path'))).toEqual(['/pricing', '/', '/about']);
    expect(within(rows[0]!).getByTestId('page-score')).toHaveTextContent('insights.pages.score 48');
    expect(await within(rows[0]!).findByText(/^replay\.prescription\.rule\.rage_on_element\.title/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('insights.pages.noFix')).toBeInTheDocument();
    expect(await within(rows[0]!).findByAltText('insights.pages.thumbAlt /pricing')).toHaveAttribute('src', 'blob:/api/replay/pages/captures/cap-1/fold?site=site-1');

    fireEvent.click(rows[0]!);
    expect(push).toHaveBeenCalledWith({ kind: 'route', id: '/pricing', tab: 'review' });
  });

  it('says so when there are no key pages yet', async () => {
    vi.mocked(replayApi.listPages).mockResolvedValue([]);
    render(<PagesKind siteId="site-1" id="" push={vi.fn()} />);
    expect(await screen.findByText('insights.pages.empty')).toBeInTheDocument();
  });
});
