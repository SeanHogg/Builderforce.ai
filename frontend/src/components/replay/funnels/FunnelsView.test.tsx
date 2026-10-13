import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReplayFunnelDto, ReplayFunnelEvalDto, ReplayRecordingDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider } from '@/components/insights/insightsScope';
import { FunnelsView } from './FunnelsView';

/**
 * The Steps tab: the funnel evaluated over the window and the ONE filter, every
 * number marked ≈, conversion and median time per step, and "Watch the N who
 * dropped" listing those recordings — a row opens the `recording` kind.
 */

const funnel: ReplayFunnelDto = {
  id: 'fun-1',
  name: 'Checkout',
  windowMinutes: 60,
  steps: [
    { ord: 0, stepKind: 'page', match: '/pricing', matchMode: 'equals', label: '/pricing' },
    { ord: 1, stepKind: 'event', match: 'purchase', matchMode: 'equals', label: 'purchase' },
  ],
};

const evaluation: ReplayFunnelEvalDto = {
  funnelId: 'fun-1',
  steps: [
    { ord: 0, label: '/pricing', visits: 200, conversionFromPrevPct: null, medianTimeFromPrevMs: null, droppedRecordingIds: [] },
    { ord: 1, label: 'purchase', visits: 50, conversionFromPrevPct: 25, medianTimeFromPrevMs: 90_000, droppedRecordingIds: ['rec-9', 'rec-gone'] },
  ],
  truncated: false,
  estimated: true,
};

const recording = (id: string): ReplayRecordingDto => ({
  id,
  visitId: `visit-${id}`,
  visitorId: 'visitor-1',
  startedAt: '2026-10-12T10:00:00.000Z',
  durationMs: 65_000,
  activeMs: 40_000,
  entryPath: '/pricing',
  exitPath: '/checkout',
  pageCount: 2,
  releaseKey: 'rel-abc',
  deviceClass: 'desktop',
  browser: 'Chrome',
  os: 'macOS',
  country: 'NZ',
  referrerHost: null,
  counts: { clicks: 4, rage: 0, dead: 0, errors: 0, quickbacks: 0, excessiveScrolls: 0 },
  converted: false,
  keepReason: 'sample',
  sampleWeight: 1,
  identifiedId: null,
  tags: {},
  recorderVersion: '1.0.0',
  viewport: { w: 1280, h: 800 },
  variant: null,
  traits: null,
  chunkCount: 1,
  chunkSeqs: [0],
  marks: [],
});

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights?f.device.eq=phone');
  vi.spyOn(replayApi, 'listFunnels').mockResolvedValue([funnel]);
  vi.spyOn(replayApi, 'evaluateFunnel').mockResolvedValue(evaluation);
  vi.spyOn(replayApi, 'getRecording').mockImplementation(async (_siteId, id) => {
    if (id === 'rec-gone') throw new Error('gone');
    return recording(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderView(push = vi.fn()) {
  render(
    <InsightsScopeProvider siteId="site-1">
      <FunnelsView siteId="site-1" push={push} />
    </InsightsScopeProvider>,
  );
  return push;
}

describe('FunnelsView', () => {
  it('evaluates the first funnel with the filter, every number ≈', async () => {
    renderView();
    expect(await screen.findByText('replay.funnels.visits replay.funnels.approx 200')).toBeInTheDocument();
    expect(replayApi.evaluateFunnel).toHaveBeenCalledWith('site-1', 'fun-1', {
      days: 30,
      filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] },
    });
    expect(screen.getByText('replay.funnels.conversion 25.0%')).toBeInTheDocument();
    expect(screen.getByText('replay.funnels.medianTime replay.funnels.approx 1:30')).toBeInTheDocument();
    expect(screen.getByText('replay.funnels.estimatedNote')).toBeInTheDocument();
    // The first step has no one to have dropped.
    expect(screen.getAllByRole('button', { name: /replay\.funnels\.watchDropped/ })).toHaveLength(1);
  });

  it('lists who dropped at a step, and a row opens the recording', async () => {
    const push = renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'replay.funnels.watchDropped 2' }));
    const watch = await screen.findByRole('button', { name: 'replay.list.openAria /pricing' });
    // A recording that aged out is skipped, not an error.
    await waitFor(() => expect(replayApi.getRecording).toHaveBeenCalledWith('site-1', 'rec-gone'));
    expect(screen.getAllByRole('button', { name: 'replay.list.openAria /pricing' })).toHaveLength(1);
    fireEvent.click(watch);
    expect(push).toHaveBeenCalledWith({ kind: 'recording', id: 'rec-9', tab: 'replay' });
  });

  it('offers to create a funnel when the site has none', async () => {
    vi.mocked(replayApi.listFunnels).mockResolvedValue([]);
    renderView();
    expect(await screen.findByText('replay.funnels.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'replay.funnels.new' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
