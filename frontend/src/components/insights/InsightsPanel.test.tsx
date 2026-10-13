import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReplayRecordingDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsPanel } from './InsightsPanel';
import { InsightsPanelProvider, usePanel } from './usePanel';
import { InsightsScopeProvider } from './insightsScope';
import { INSIGHT_PANEL_KINDS, type InsightPanelLevel } from './panelKinds';
import { formatPanelValue, parsePanelParams, withPanelParams } from './panelUrl';

/**
 * ONE panel, a stack of registered levels (PRD 33 D16): push adds a level and
 * a crumb, a crumb pops, close / Esc clear, tabs come from the kind's registry
 * row, and a data requirement (`identified`) hides a tab rather than a branch.
 */

vi.mock('@/components/insights/kinds/SitesKind', () => ({ SitesKind: () => <div>sites-kind</div> }));
vi.mock('@/components/insights/kinds/PlanKind', () => ({ PlanKind: () => <div>plan-kind</div> }));
vi.mock('@/components/replay/ReplayPlayer', () => ({
  ReplayPlayer: ({ recordingId, startAtSeconds }: { recordingId: string; startAtSeconds?: number }) => (
    <div>player {recordingId} at {startAtSeconds}</div>
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
  marks: [{ kind: 'page', key: '/', atMs: 0 }, { kind: 'rage', key: 'button.buy', label: 'Buy', atMs: 12_000 }],
  ...over,
});

function Opener({ levels }: { levels: InsightPanelLevel[] }) {
  const { push } = usePanel();
  return (
    <>
      {levels.map((level) => (
        <button key={`${level.kind}:${level.id}`} type="button" onClick={() => push(level)}>
          open {level.kind}
        </button>
      ))}
    </>
  );
}

function renderPanel(levels: InsightPanelLevel[]) {
  return render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <Opener levels={levels} />
        <InsightsPanel siteId="site-1" />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  vi.spyOn(replayApi, 'getIssue').mockResolvedValue({
    id: 'iss-1', fingerprint: 'fp', kind: 'rage', route: '/pricing', subject: 'button.buy', title: 'Rage on Buy',
    status: 'new', sessions: 9, share: 0.1, sparkline: [], firstRelease: null, lastRelease: null,
    firstSeenAt: '2026-10-01T00:00:00.000Z', lastSeenAt: '2026-10-12T00:00:00.000Z', prescriptionId: null,
    representatives: [], byRelease: [], byDevice: [],
  });
  vi.spyOn(replayApi, 'getRecording').mockResolvedValue(recording());
  vi.spyOn(replayApi, 'listRecordings').mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InsightsPanel', () => {
  it('renders nothing until a level is pushed', () => {
    renderPanel([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('push adds a level and a crumb; the crumb pops back to it', async () => {
    renderPanel([{ kind: 'issue', id: 'iss-1', tab: 'overview' }, { kind: 'recording', id: 'rec-1', tab: 'replay' }]);
    fireEvent.click(screen.getByRole('button', { name: 'open issue' }));
    let panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('insights.kinds.issue')).toBeInTheDocument();
    expect(within(panel).getByText('insights.panel.crumbRoot')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'open recording' }));
    panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('insights.kinds.recording')).toBeInTheDocument();
    expect(within(panel).getByText('player rec-1 at 0')).toBeInTheDocument();
    const crumb = within(panel).getByRole('button', { name: 'insights.panel.backTo insights.kinds.issue' });
    expect(new URLSearchParams(window.location.search).get('panel')).toBe('recording:rec-1:replay');

    fireEvent.click(crumb);
    panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('insights.kinds.issue')).toBeInTheDocument();
    expect(within(panel).queryByText('player rec-1 at 0')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('panel')).toBe('issue:iss-1:overview');
  });

  it('close clears the stack and the address', async () => {
    renderPanel([{ kind: 'issue', id: 'iss-1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'open issue' }));
    const panel = await screen.findByRole('dialog');
    fireEvent.click(within(panel).getByRole('button', { name: 'common.closePanel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(new URLSearchParams(window.location.search).has('panel')).toBe(false);
  });

  it('Esc closes', async () => {
    renderPanel([{ kind: 'issue', id: 'iss-1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'open issue' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('draws the tabs from the kind registry and switches them', async () => {
    renderPanel([{ kind: 'issue', id: 'iss-1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'open issue' }));
    const panel = await screen.findByRole('dialog');
    const issueRow = INSIGHT_PANEL_KINDS.find((row) => row.kind === 'issue')!;
    const tabs = within(panel).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(issueRow.tabs.map((tab) => `insights.${tab.labelKey}`));
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(panel).getByRole('tab', { name: 'insights.kinds.tabs.recordings' }));
    expect(await within(panel).findByText('insights.issues.recordingsOnRoute /pricing')).toBeInTheDocument();
    expect(replayApi.listRecordings).toHaveBeenCalledWith('site-1', expect.objectContaining({
      filter: { all: [{ field: 'visitedPath', op: 'eq', value: '/pricing' }] },
    }));
    expect(new URLSearchParams(window.location.search).get('panel')).toBe('issue:iss-1:recordings');
  });

  it('hides the lead tab when the recording has no identified visitor', async () => {
    renderPanel([{ kind: 'recording', id: 'rec-1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'open recording' }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByRole('tab', { name: 'insights.kinds.tabs.journey' });
    // Let the requirement probe settle, then the lead tab must still be absent.
    await vi.waitFor(() => expect(replayApi.getRecording).toHaveBeenCalled());
    await Promise.resolve();
    expect(within(panel).queryByRole('tab', { name: 'insights.kinds.tabs.lead' })).toBeNull();
  });

  it('offers the lead tab once the recording is identified', async () => {
    vi.mocked(replayApi.getRecording).mockResolvedValue(recording({ identifiedId: 'user-42', traits: { plan: 'pro' } }));
    renderPanel([{ kind: 'recording', id: 'rec-1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'open recording' }));
    const panel = await screen.findByRole('dialog');
    fireEvent.click(await within(panel).findByRole('tab', { name: 'insights.kinds.tabs.lead' }));
    expect(await within(panel).findByText('user-42')).toBeInTheDocument();
    expect(within(panel).getByText('pro')).toBeInTheDocument();
  });

  it('opens from ?panel=<kind>:<id>:<tab>&t= and hands the time to the player', async () => {
    window.history.replaceState({}, '', '/apps/insights?site=site-1&panel=recording:rec-1:replay&t=12');
    renderPanel([]);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('player rec-1 at 12')).toBeInTheDocument();
  });

  it('ignores a ?panel= naming an unregistered kind', async () => {
    window.history.replaceState({}, '', '/apps/insights?panel=funnel:f-1');
    renderPanel([]);
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('panel address', () => {
  it('round-trips a level, encoding colons inside the id', () => {
    const level: InsightPanelLevel = { kind: 'live', id: '/p/:id', tab: 'main' };
    const params = withPanelParams(new URLSearchParams('site=s&f.device.eq=phone'), { ...level, t: 30, follow: true });
    expect(params.get('site')).toBe('s');
    expect(params.get('f.device.eq')).toBe('phone');
    expect(params.get('panel')).toBe(formatPanelValue(level));
    expect(parsePanelParams(params)).toEqual({ kind: 'live', id: '/p/:id', tab: 'main', t: 30, follow: true });
    expect(withPanelParams(params, null).has('panel')).toBe(false);
    expect(withPanelParams(params, null).has('t')).toBe(false);
  });

  it('parses a bare kind', () => {
    expect(parsePanelParams('?panel=issues')).toEqual({ kind: 'issues', id: '' });
    expect(parsePanelParams('?panel=Bad-Kind:x')).toBeNull();
    expect(parsePanelParams('')).toBeNull();
  });
});
