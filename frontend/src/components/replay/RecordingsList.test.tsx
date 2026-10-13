import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReplayRecordingSummaryDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { RecordingsList } from './RecordingsList';

/** Kept recordings: registry columns, shared sort, signals named for a screen reader, cursor paging. */

const row = (over: Partial<ReplayRecordingSummaryDto> = {}): ReplayRecordingSummaryDto => ({
  id: 'rec-1',
  visitId: 'visit-1',
  visitorId: 'visitor-1',
  startedAt: '2026-10-12T10:00:00.000Z',
  durationMs: 65_000,
  activeMs: 30_000,
  entryPath: '/',
  exitPath: '/pricing',
  pageCount: 3,
  releaseKey: 'rel-aaaaaaaaaaaaaaaa',
  deviceClass: 'desktop',
  browser: 'Chrome',
  os: 'macOS',
  country: 'NZ',
  referrerHost: null,
  counts: { clicks: 9, rage: 3, dead: 0, errors: 1, quickbacks: 0, excessiveScrolls: 0 },
  converted: false,
  keepReason: 'frustration',
  sampleWeight: 1,
  identifiedId: null,
  tags: {},
  ...over,
});

const filter = { all: [{ field: 'visitedPath' as const, op: 'eq' as const, value: '/pricing' }] };

beforeEach(() => {
  vi.spyOn(replayApi, 'listRecordings');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecordingsList', () => {
  it('fetches with the window and filter, and draws every registry column', async () => {
    vi.mocked(replayApi.listRecordings).mockResolvedValue({
      items: [row(), row({ id: 'rec-2', entryPath: '/blog', exitPath: '/blog', durationMs: 5_000, counts: { clicks: 0, rage: 0, dead: 0, errors: 0, quickbacks: 0, excessiveScrolls: 0 }, keepReason: 'sample', sampleWeight: 4 })],
      nextCursor: null,
    });
    render(<RecordingsList siteId="site-1" days={30} filter={filter} onOpen={() => {}} />);

    expect(await screen.findByText('replay.list.route / /pricing')).toBeInTheDocument();
    expect(replayApi.listRecordings).toHaveBeenCalledWith('site-1', { days: 30, cursor: null, filter });
    for (const column of ['when', 'where', 'release', 'pages', 'duration', 'signals', 'keep']) {
      expect(screen.getByRole('button', { name: `replay.list.sortBy replay.list.${column}` })).toBeInTheDocument();
    }
    // Signals are icons with names; a quiet recording says so.
    expect(screen.getByRole('img', { name: 'replay.list.signal.rage 3' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'replay.list.signal.errors 1' })).toBeInTheDocument();
    expect(screen.getByText('replay.list.noSignals')).toBeInTheDocument();
    // A sampled keep is weighted, and says it is an estimate.
    expect(screen.getByText(/replay\.list\.weighted 4/)).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();
  });

  it('sorts by a column through the shared sort', async () => {
    vi.mocked(replayApi.listRecordings).mockResolvedValue({
      items: [row({ id: 'short', entryPath: '/a', exitPath: '/a', durationMs: 1_000 }), row({ id: 'long', entryPath: '/b', exitPath: '/b', durationMs: 90_000 })],
      nextCursor: null,
    });
    render(<RecordingsList siteId="site-1" days={7} onOpen={() => {}} />);
    await screen.findByText('/a');
    fireEvent.click(screen.getByRole('button', { name: 'replay.list.sortBy replay.list.duration' }));
    const body = screen.getAllByRole('rowgroup')[1]!;
    const order = within(body).getAllByRole('row').map((tr) => tr.textContent ?? '');
    expect(order[0]).toContain('/b');
    fireEvent.click(screen.getByRole('button', { name: 'replay.list.sortBy replay.list.duration' }));
    const flipped = within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row').map((tr) => tr.textContent ?? '');
    expect(flipped[0]).toContain('/a');
  });

  it('opens a recording from its row and from its Watch button', async () => {
    vi.mocked(replayApi.listRecordings).mockResolvedValue({ items: [row()], nextCursor: null });
    const onOpen = vi.fn();
    render(<RecordingsList siteId="site-1" days={30} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'replay.list.openAria /' }));
    expect(onOpen).toHaveBeenCalledWith('rec-1');
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('replay.list.route / /pricing'));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('pages with the cursor and appends', async () => {
    vi.mocked(replayApi.listRecordings)
      .mockResolvedValueOnce({ items: [row({ id: 'rec-1', entryPath: '/first', exitPath: '/first' })], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [row({ id: 'rec-2', entryPath: '/second', exitPath: '/second' })], nextCursor: null });
    render(<RecordingsList siteId="site-1" days={30} onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'replay.list.loadMore' }));
    expect(await screen.findByText('/second')).toBeInTheDocument();
    expect(screen.getByText('/first')).toBeInTheDocument();
    expect(replayApi.listRecordings).toHaveBeenLastCalledWith('site-1', { days: 30, cursor: 'c2', filter: null });
    expect(screen.queryByRole('button', { name: 'replay.list.loadMore' })).toBeNull();
  });

  it('says so when nothing was kept', async () => {
    vi.mocked(replayApi.listRecordings).mockResolvedValue({ items: [], nextCursor: null });
    render(<RecordingsList siteId="site-1" days={30} onOpen={() => {}} />);
    expect(await screen.findByText('replay.list.empty')).toBeInTheDocument();
  });

  it('shows a failure with a retry that refetches', async () => {
    vi.mocked(replayApi.listRecordings)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ items: [row({ entryPath: '/back', exitPath: '/back' })], nextCursor: null });
    render(<RecordingsList siteId="site-1" days={30} onOpen={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('replay.list.error');
    fireEvent.click(within(alert).getByRole('button', { name: 'replay.list.retry' }));
    expect(await screen.findByText('/back')).toBeInTheDocument();
  });
});
