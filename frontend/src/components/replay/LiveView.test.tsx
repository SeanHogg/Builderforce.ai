import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReplayLiveDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { LIVE_POLL_MS, LiveView } from './LiveView';

/** Live (PRD 33 S5, D6): polls about every 5 s, pauses while the tab is hidden, tiles open follow mode. */

const live: ReplayLiveDto = {
  active: 2,
  byRoute: [{ route: '/pricing', n: 1 }, { route: '/docs', n: 1 }],
  visitors: [
    { visitId: 'v1', route: '/pricing', deviceClass: 'phone', x: null, y: null, lastSeenAt: '2026-10-13T10:00:00.000Z', recordingId: 'rec-9' },
    { visitId: 'v2', route: '/docs', deviceClass: 'desktop', x: null, y: null, lastSeenAt: '2026-10-13T10:00:00.000Z', recordingId: null },
  ],
};

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(replayApi, 'getLive').mockResolvedValue(live);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LiveView', () => {
  it('shows the active count, the routes and one tile per visitor', async () => {
    render(<LiveView siteId="site-1" onOpenRecording={() => {}} />);
    await flush();
    expect(screen.getByText('replay.live.active 2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'replay.live.byRoute' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'replay.live.watchAria /pricing' })).toBeInTheDocument();
    // An unrecorded visitor is a tile, not a button.
    expect(screen.getByText('replay.live.notRecorded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'replay.live.watchAria /docs' })).toBeNull();
  });

  it('opens a recorded visitor (the host follows it live)', async () => {
    const onOpen = vi.fn();
    render(<LiveView siteId="site-1" onOpenRecording={onOpen} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'replay.live.watchAria /pricing' }));
    expect(onOpen).toHaveBeenCalledWith('rec-9');
  });

  it('narrows to one route for the Page stage lens', async () => {
    render(<LiveView siteId="site-1" route="/docs" compact onOpenRecording={() => {}} />);
    await flush();
    expect(screen.getByText('replay.live.active 1')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'replay.live.byRoute' })).toBeNull();
    expect(screen.queryByText('/pricing')).toBeNull();
  });

  it('polls every 5 s and pauses while the tab is hidden', async () => {
    render(<LiveView siteId="site-1" onOpenRecording={() => {}} />);
    await flush();
    expect(replayApi.getLive).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS); });
    expect(replayApi.getLive).toHaveBeenCalledTimes(2);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 4); });
    expect(replayApi.getLive).toHaveBeenCalledTimes(2);

    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(replayApi.getLive).toHaveBeenCalledTimes(3);
    visibility.mockRestore();
  });

  it('keeps the last answer and names a failed poll', async () => {
    render(<LiveView siteId="site-1" onOpenRecording={() => {}} />);
    await flush();
    vi.mocked(replayApi.getLive).mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS); });
    expect(screen.getByText('replay.live.active 2')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('offline');
  });
});
