import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiRequestError } from '@/lib/apiClient';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { InsightsScopeProvider } from '../insightsScope';
import { InsightsPanelProvider, usePanel } from '../usePanel';
import { DoNext, HOME_FIX_ROWS } from './DoNext';

/**
 * Do next (PRD 33 §4.1, D13): the open fixes for the filter, the goal's areas
 * first, bounded to the rows that fit, each THE fix card (compact); "Find fixes
 * now" says the hourly limit in place; "View all" opens the `fixes` kind.
 */

vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));

function LevelProbe() {
  const { levels } = usePanel();
  return <output data-testid="levels">{JSON.stringify(levels)}</output>;
}

function renderBand() {
  render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <DoNext />
        <LevelProbe />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
}

const levels = () => JSON.parse(screen.getByTestId('levels').textContent ?? '[]');

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  vi.spyOn(replayApi, 'listPrescriptions').mockResolvedValue([]);
  vi.spyOn(replayApi, 'sweepPrescriptions').mockResolvedValue({ found: 4, created: 2, refreshed: 2, prescribed: 1 });
  vi.spyOn(replayApi, 'pagePrompt').mockImplementation(async (_site, path, audience, ids) => ({
    audience, prompt: `one prompt for ${path}: ${(ids ?? []).join('+')}`, selectors: [], prescriptionIds: [...(ids ?? [])],
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DoNext', () => {
  it('lists the open fixes, bounded, in rank order within the goal', async () => {
    vi.mocked(replayApi.listPrescriptions).mockResolvedValue([
      ...Array.from({ length: HOME_FIX_ROWS + 2 }, (_, i) => prescription({ id: `rx-${i}`, rank: i + 1 })),
      prescription({ id: 'rx-dismissed', rank: 99, status: 'dismissed', next: [] }),
    ]);
    renderBand();
    const cards = await screen.findAllByTestId('prescription-card');
    expect(cards).toHaveLength(HOME_FIX_ROWS);
    cards.forEach((card) => expect(card).toHaveAttribute('data-compact', 'true'));
    expect(replayApi.listPrescriptions).toHaveBeenCalledWith('site-1', { filter: null });
  });

  it('says so honestly when there is nothing to do', async () => {
    renderBand();
    expect(await screen.findByText('insights.overview.doNextEmpty')).toBeInTheDocument();
  });

  it('"Find fixes now" runs the sweep and reports what it found', async () => {
    renderBand();
    fireEvent.click(await screen.findByRole('button', { name: 'insights.fixes.findNow' }));
    await waitFor(() => expect(replayApi.sweepPrescriptions).toHaveBeenCalledWith('site-1'));
    expect(await screen.findByText('insights.fixes.sweepResult 4 2')).toBeInTheDocument();
  });

  it('says the hourly limit in place when the sweep ran within the hour', async () => {
    vi.mocked(replayApi.sweepPrescriptions).mockRejectedValue(new ApiRequestError('Too soon', 429));
    renderBand();
    fireEvent.click(await screen.findByRole('button', { name: 'insights.fixes.findNow' }));
    expect(await screen.findByText('insights.fixes.sweepLimited')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"View all" opens the fixes kind; a card opens the fix kind', async () => {
    vi.mocked(replayApi.listPrescriptions).mockResolvedValue([prescription()]);
    renderBand();
    fireEvent.click(screen.getByRole('button', { name: 'insights.fixes.viewAll' }));
    expect(levels()).toEqual([{ kind: 'fixes', id: '' }]);
    fireEvent.click(await screen.findByRole('button', { name: /^replay\.prescription\.openAria / }));
    expect(levels()).toEqual([{ kind: 'fixes', id: '' }, { kind: 'fix', id: 'rx-1', tab: 'change' }]);
  });

  it('"Pages" opens the pages kind', async () => {
    renderBand();
    fireEvent.click(await screen.findByRole('button', { name: 'insights.pages.open' }));
    expect(levels()).toEqual([{ kind: 'pages', id: '' }]);
  });

  it('"Apply all" bundles the visible open fixes on the page into ONE prompt', async () => {
    vi.mocked(replayApi.listPrescriptions).mockResolvedValue([
      prescription({ id: 'rx-a', rank: 1 }),
      prescription({ id: 'rx-b', rank: 2 }),
      prescription({ id: 'rx-other', rank: 3, pagePath: '/signup', subjectKey: '/signup|form' }),
    ]);
    renderBand();
    await screen.findAllByTestId('prescription-card');
    const applyAll = screen.getByRole('button', { name: 'insights.fixes.applyAll' });
    expect(applyAll).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(applyAll);
    // No Page-stage route yet: the top fix's page, and only the fixes shown for it.
    await waitFor(() => expect(replayApi.pagePrompt).toHaveBeenCalledWith('site-1', '/pricing', 'coding_agent', ['rx-a', 'rx-b']));
    expect(screen.getByRole('region', { name: 'insights.fixes.applyAllTitle /pricing' })).toBeInTheDocument();
    expect(await screen.findByDisplayValue('one prompt for /pricing: rx-a+rx-b')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replay\.prompt\.copy$/ })).toBeInTheDocument();
  });

  it('"Apply all" is disabled with no fix on a page', async () => {
    vi.mocked(replayApi.listPrescriptions).mockResolvedValue([prescription({ pagePath: null })]);
    renderBand();
    await screen.findAllByTestId('prescription-card');
    expect(screen.getByRole('button', { name: 'insights.fixes.applyAll' })).toBeDisabled();
  });
});
