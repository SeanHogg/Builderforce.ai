import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReplayRecordingDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { VISITOR_PANEL_TABS } from '@/components/visitors/visitorPanelTabs';
import { InsightsPanel } from '../InsightsPanel';
import { InsightsPanelProvider } from '../usePanel';
import { InsightsScopeProvider } from '../insightsScope';
import { panelKindDef } from '../panelKinds';

/**
 * The `recording` kind (PRD 33 §4.1, S0): its tabs are Replay followed by the ONE
 * visitor-panel registry (`VISITOR_PANEL_TABS`), a tab whose `requires` is not
 * established is not offered, and `?panel=recording:<id>&t=<s>` hands the start
 * time to the player. Copy is the passthrough key under the global next-intl mock.
 */

vi.mock('@/components/replay/ReplayPlayer', () => ({
  ReplayPlayer: ({ recordingId, startAtSeconds, follow }: { recordingId: string; startAtSeconds?: number; follow?: boolean }) => (
    <div>player {recordingId} at {startAtSeconds} follow {String(follow)}</div>
  ),
}));

const recording = (over: Partial<ReplayRecordingDto> = {}): ReplayRecordingDto => ({
  id: 'rec-1',
  visitId: 'visit-1',
  visitorId: 'visitor-1',
  startedAt: '2026-10-12T10:00:00.000Z',
  durationMs: 65_000,
  activeMs: 40_000,
  entryPath: '/',
  exitPath: '/pricing',
  pageCount: 2,
  releaseKey: 'rel-abc',
  deviceClass: 'desktop',
  browser: 'Chrome',
  os: 'macOS',
  country: 'NZ',
  referrerHost: null,
  counts: { clicks: 4, rage: 1, dead: 0, errors: 0, quickbacks: 0, excessiveScrolls: 0 },
  converted: false,
  keepReason: 'frustration',
  sampleWeight: 1,
  identifiedId: null,
  tags: {},
  recorderVersion: '1.0.0',
  viewport: { w: 1280, h: 800 },
  variant: null,
  traits: null,
  chunkCount: 1,
  chunkSeqs: [0],
  marks: [{ kind: 'page', key: '/', atMs: 0 }],
  ...over,
});

function renderRecording(search: string) {
  window.history.replaceState({}, '', `/apps/insights?site=site-1&${search}`);
  return render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <InsightsPanel siteId="site-1" />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(replayApi, 'getRecording').mockResolvedValue(recording());
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/apps/insights');
});

describe('recording kind', () => {
  it('registers Replay, then every row of the visitor-panel registry, carrying its `requires`', () => {
    const tabs = panelKindDef('recording')!.tabs;
    expect(tabs.map((tab) => tab.id)).toEqual(['replay', ...VISITOR_PANEL_TABS.map((row) => row.id)]);
    for (const row of VISITOR_PANEL_TABS) {
      expect(tabs.find((tab) => tab.id === row.id)?.requires).toBe(row.requires);
    }
  });

  it('renders the tabs it is offered from the registry, leaving out the one whose requirement is unmet', async () => {
    renderRecording('panel=recording:rec-1:replay');
    const panel = await screen.findByRole('dialog');
    await within(panel).findByRole('tab', { name: 'insights.kinds.tabs.journey' });
    await vi.waitFor(() => expect(replayApi.getRecording).toHaveBeenCalled());
    await Promise.resolve();
    expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'insights.kinds.tabs.replay',
      'insights.kinds.tabs.journey',
    ]);
    expect(within(panel).queryByRole('tab', { name: 'insights.kinds.tabs.lead' })).toBeNull();
  });

  it('offers the lead tab once the requirement holds (an identified visitor)', async () => {
    vi.mocked(replayApi.getRecording).mockResolvedValue(recording({ identifiedId: 'user-42' }));
    renderRecording('panel=recording:rec-1:replay');
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByRole('tab', { name: 'insights.kinds.tabs.lead' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('tab')).toHaveLength(1 + VISITOR_PANEL_TABS.length);
  });

  it('hands the &t= start time and the follow flag to the player', async () => {
    renderRecording('panel=recording:rec-1:replay&t=37&follow=1');
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('player rec-1 at 37 follow true')).toBeInTheDocument();
  });

  it('starts at zero when the address carries no time', async () => {
    renderRecording('panel=recording:rec-1:replay');
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('player rec-1 at 0 follow false')).toBeInTheDocument();
  });
});
