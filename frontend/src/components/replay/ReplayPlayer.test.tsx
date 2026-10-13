import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReplayExportDto, ReplayRecordingDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { ReplayPlayer } from './ReplayPlayer';

/**
 * The ONE player: chunks stream through replayApi into a lazily created rrweb
 * Replayer (the loader module is the seam — rrweb itself is never imported
 * here), and play / pause / scrub / marker / copy-link drive it.
 */

const fake = vi.hoisted(() => {
  const state = { current: 0 };
  const replayer = {
    play: vi.fn((offset?: number) => { state.current = offset ?? state.current; }),
    pause: vi.fn((offset?: number) => { if (offset != null) state.current = offset; }),
    setConfig: vi.fn(),
    getCurrentTime: vi.fn(() => state.current),
    getMetaData: vi.fn(() => ({ startTime: 0, endTime: 60_000, totalTime: 60_000 })),
    addEvent: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  };
  return { state, replayer, createReplayer: vi.fn(async (events: unknown[]) => { void events; return replayer; }) };
});

vi.mock('./rrwebLoader', () => ({ createReplayer: fake.createReplayer }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));

const recording: ReplayRecordingDto = {
  id: 'rec-1',
  visitId: 'visit-1',
  visitorId: 'visitor-1',
  startedAt: '2026-10-12T10:00:00.000Z',
  durationMs: 60_000,
  activeMs: 40_000,
  entryPath: '/',
  exitPath: '/pricing',
  pageCount: 2,
  releaseKey: 'rel-abcdef123456789',
  deviceClass: 'phone',
  browser: 'Safari',
  os: 'iOS',
  country: 'NZ',
  referrerHost: 'news.example.com',
  counts: { clicks: 4, rage: 1, dead: 0, errors: 0, quickbacks: 0, excessiveScrolls: 0 },
  converted: false,
  keepReason: 'frustration',
  sampleWeight: 1,
  identifiedId: null,
  tags: {},
  recorderVersion: '1.0.0',
  viewport: { w: 390, h: 844 },
  variant: null,
  traits: null,
  chunkCount: 2,
  chunkSeqs: [0, 1],
  marks: [
    { kind: 'page', key: '/', atMs: 0 },
    { kind: 'rage', key: 'button.buy', label: 'Buy', atMs: 12_000 },
  ],
};

const writeText = vi.fn(async (text: string) => { void text; });

beforeEach(() => {
  fake.state.current = 0;
  for (const fn of Object.values(fake.replayer)) fn.mockClear();
  fake.createReplayer.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.history.replaceState({}, '', '/apps/insights?site=site-1');
  vi.spyOn(replayApi, 'getRecording').mockResolvedValue(recording);
  vi.spyOn(replayApi, 'getRecordingChunk')
    .mockResolvedValueOnce([{ type: 4, timestamp: 1 }, { type: 2, timestamp: 2 }])
    .mockResolvedValueOnce([{ type: 3, timestamp: 3 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function ready() {
  const play = await screen.findByRole('button', { name: 'replay.player.play' });
  await waitFor(() => expect(play).not.toBeDisabled());
  return play;
}

describe('ReplayPlayer', () => {
  it('streams the chunks in order into one lazily created replayer', async () => {
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();
    expect(replayApi.getRecordingChunk).toHaveBeenNthCalledWith(1, 'site-1', 'rec-1', 0);
    expect(replayApi.getRecordingChunk).toHaveBeenNthCalledWith(2, 'site-1', 'rec-1', 1);
    expect(fake.createReplayer).toHaveBeenCalledTimes(1);
    expect(fake.createReplayer.mock.calls[0]![0]).toHaveLength(2);
    await waitFor(() => expect(fake.replayer.addEvent).toHaveBeenCalledWith({ type: 3, timestamp: 3 }));
    // Header facts.
    expect(screen.getByText('replay.player.deviceClass.phone')).toBeInTheDocument();
    expect(screen.getByText('news.example.com')).toBeInTheDocument();
  });

  it('plays, pauses and scrubs', async () => {
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    fireEvent.click(await ready());
    expect(fake.replayer.play).toHaveBeenCalledWith(0);
    const pause = screen.getByRole('button', { name: 'replay.player.pause' });
    fireEvent.click(pause);
    expect(fake.replayer.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'replay.player.play' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: 'replay.player.scrubber' }), { target: { value: '30000' } });
    expect(fake.replayer.pause).toHaveBeenLastCalledWith(30_000);
  });

  it('seeks from a timeline marker and from the event list', async () => {
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();
    const [marker, listRow] = screen.getAllByRole('button', { name: 'replay.player.markerAria 0:12 Buy' });
    fireEvent.click(marker!);
    expect(fake.replayer.pause).toHaveBeenLastCalledWith(12_000);
    fireEvent.click(screen.getAllByRole('button', { name: 'replay.player.markerAria 0:00 replay.player.mark.page' })[0]!);
    expect(fake.replayer.pause).toHaveBeenLastCalledWith(0);
    fireEvent.click(listRow!);
    expect(fake.replayer.pause).toHaveBeenLastCalledWith(12_000);
  });

  it('applies speed and skip-inactivity to the replayer', async () => {
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '4' } });
    expect(fake.replayer.setConfig).toHaveBeenCalledWith({ speed: 4 });
    const skip = screen.getByRole('checkbox', { name: 'replay.player.skipInactive' });
    expect(skip).toBeChecked();
    fireEvent.click(skip);
    expect(fake.replayer.setConfig).toHaveBeenCalledWith({ skipInactive: false });
  });

  it('copies a shareable link at the current moment', async () => {
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: 'replay.player.markerAria 0:12 Buy' })[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /replay\.player\.copyLink 0:12/ }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const href = new URL(writeText.mock.calls[0]![0]);
    expect(href.pathname).toBe('/apps/insights');
    expect(href.searchParams.get('site')).toBe('site-1');
    expect(href.searchParams.get('panel')).toBe('recording:rec-1:replay');
    expect(href.searchParams.get('t')).toBe('12');
    expect(toast.success).toHaveBeenCalledWith('replay.player.copied');
  });

  it('starts at a linked time', async () => {
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" startAtSeconds={20} />);
    await ready();
    expect(fake.replayer.pause).toHaveBeenCalledWith(20_000);
    expect(screen.getByRole('slider', { name: 'replay.player.scrubber' })).toHaveValue('20000');
  });

  it('streams the STORED chunk seqs — a trigger-kept recording starts mid-visit, above seq 0', async () => {
    vi.mocked(replayApi.getRecording).mockResolvedValue({ ...recording, chunkCount: 2, chunkSeqs: [3, 4] });
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();
    expect(replayApi.getRecordingChunk).toHaveBeenNthCalledWith(1, 'site-1', 'rec-1', 3);
    expect(replayApi.getRecordingChunk).toHaveBeenNthCalledWith(2, 'site-1', 'rec-1', 4);
    expect(replayApi.getRecordingChunk).not.toHaveBeenCalledWith('site-1', 'rec-1', 0);
  });

  it('draws the current page click heat over the replay when the overlay is on', async () => {
    const heatGrid = vi.spyOn(replayApi, 'heatGrid').mockResolvedValue({
      route: '/', releaseKey: null, deviceClass: 'phone', kind: 'click', cells: [{ gx: 1, gy: 1, n: 3 }], total: 3,
    });
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();
    expect(screen.queryByTestId('player-heat')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'replay.heat.playerToggle' }));
    expect(await screen.findByTestId('player-heat')).toHaveAttribute('data-route', '/');
    await waitFor(() => expect(heatGrid).toHaveBeenCalledWith('site-1', expect.objectContaining({ route: '/', device: 'phone', kind: 'click' })));
    expect(screen.getByText('replay.heat.legendCold')).toBeInTheDocument();
  });

  it('exports a video: request, poll every 5 s while open, then download', async () => {
    const job = (status: ReplayExportDto['status'], error: string | null = null): ReplayExportDto => ({
      id: 'exp-1', recordingId: 'rec-1', status, format: status === 'done' ? 'mp4' : null,
      downloadUrl: null, error, createdAt: '2026-10-13T10:00:00.000Z',
    });
    vi.spyOn(replayApi, 'requestExport').mockResolvedValue(job('queued'));
    vi.spyOn(replayApi, 'exportStatus').mockResolvedValue(job('done'));
    vi.spyOn(replayApi, 'downloadExport').mockResolvedValue(undefined);
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /replay\.export\.button/ }));
      });
      expect(replayApi.requestExport).toHaveBeenCalledWith('site-1', 'rec-1');
      expect(await screen.findByText('replay.export.status.queued')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /replay\.export\.button/ })).toBeDisabled();
      expect(replayApi.exportStatus).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(replayApi.exportStatus).toHaveBeenCalledWith('site-1', 'exp-1');
      fireEvent.click(await screen.findByRole('button', { name: 'replay.export.download' }));
      expect(replayApi.downloadExport).toHaveBeenCalledWith('site-1', 'exp-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says plainly when an export cannot run', async () => {
    vi.spyOn(replayApi, 'requestExport').mockResolvedValue({
      id: 'exp-2', recordingId: 'rec-1', status: 'failed', format: null, downloadUrl: null,
      error: 'insufficient_units', createdAt: '2026-10-13T10:00:00.000Z',
    });
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /replay\.export\.button/ }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('replay.export.error.insufficient_units');
  });

  it('says when the recording cannot be loaded', async () => {
    vi.mocked(replayApi.getRecording).mockRejectedValue(new Error('gone'));
    render(<ReplayPlayer siteId="site-1" recordingId="rec-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('replay.player.error');
    expect(fake.createReplayer).not.toHaveBeenCalled();
  });
});
