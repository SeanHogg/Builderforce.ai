import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReplayReleaseDto, ReplayReleaseReportDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider } from '../insightsScope';
import { InsightsPanelProvider, usePanel } from '../usePanel';
import { SCORE_STRIP_RELEASES, ScoreStrip } from './ScoreStrip';

/**
 * Score by release (PRD 33 §4.1): the latest releases newest first, each with
 * the fixes it shipped and a verdict dot per fix; a release opens the `release` kind.
 */

const release = (n: number, over: Partial<ReplayReleaseDto> = {}): ReplayReleaseDto => ({
  releaseKey: `rel-${n}`,
  label: null,
  ordinal: n,
  source: 'fingerprint',
  firstSeenAt: `2026-10-0${n}T00:00:00.000Z`,
  lastSeenAt: `2026-10-0${n}T12:00:00.000Z`,
  ...over,
});

const report = (releaseKey: string, verdicts: Array<'worked' | 'no_effect' | 'worse' | null>): ReplayReleaseReportDto => ({
  releaseKey,
  label: null,
  firstSeenAt: null,
  prescriptions: verdicts.map((verdict, i) => ({
    id: `${releaseKey}-rx-${i}`,
    ruleId: 'rage_on_element',
    area: 'ux',
    status: verdict ?? 'measuring',
    actionKind: 'fix',
    measured: verdict
      ? { before: 1, after: 2, delta: 1, verdict, source: 'ticket_effect', releaseKey, measuredAt: '2026-10-09T00:00:00.000Z' }
      : null,
  })),
});

function LevelProbe() {
  const { levels } = usePanel();
  return <output data-testid="levels">{JSON.stringify(levels)}</output>;
}

function renderStrip() {
  render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <ScoreStrip />
        <LevelProbe />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  vi.spyOn(replayApi, 'listReleases').mockResolvedValue([release(1), release(3, { label: 'Spring launch' }), release(2)]);
  vi.spyOn(replayApi, 'releaseReport').mockImplementation(async (_site, key) => (
    key === 'rel-3' ? report(key, ['worked', 'worse', null]) : key === 'rel-2' ? report(key, []) : report(key, ['no_effect'])
  ));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScoreStrip', () => {
  it('shows the releases newest first with the fixes each shipped and a verdict dot per fix', async () => {
    renderStrip();
    const rows = await screen.findAllByTestId('score-release');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Spring launch');
    expect(rows[1]).toHaveTextContent('insights.overview.releaseOrdinal 2');
    const dots = [...rows[0]!.querySelectorAll('[data-verdict]')].map((dot) => dot.getAttribute('data-verdict'));
    expect(dots).toEqual(['worked', 'worse', 'measuring']);
    expect(within(rows[0]!).getByRole('button')).toHaveAccessibleName('insights.release.strip.label Spring launch 3 1 1');
    expect(rows[1]!.querySelectorAll('[data-verdict]')).toHaveLength(0);
    expect(replayApi.releaseReport).toHaveBeenCalledWith('site-1', 'rel-3');
  });

  it('reads at most the strip’s releases', async () => {
    vi.mocked(replayApi.listReleases).mockResolvedValue(Array.from({ length: SCORE_STRIP_RELEASES + 3 }, (_, i) => release(i + 1, { firstSeenAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString() })));
    renderStrip();
    expect(await screen.findAllByTestId('score-release')).toHaveLength(SCORE_STRIP_RELEASES);
    expect(replayApi.releaseReport).toHaveBeenCalledTimes(SCORE_STRIP_RELEASES);
  });

  it('a release opens the release kind', async () => {
    renderStrip();
    const [newest] = await screen.findAllByTestId('score-release');
    fireEvent.click(within(newest!).getByRole('button'));
    expect(JSON.parse(screen.getByTestId('levels').textContent ?? '[]')).toEqual([{ kind: 'release', id: 'rel-3' }]);
  });

  it('draws nothing for a site with no release yet', async () => {
    vi.mocked(replayApi.listReleases).mockResolvedValue([]);
    renderStrip();
    await vi.waitFor(() => expect(replayApi.listReleases).toHaveBeenCalled());
    expect(screen.queryByTestId('score-release')).toBeNull();
  });
});
