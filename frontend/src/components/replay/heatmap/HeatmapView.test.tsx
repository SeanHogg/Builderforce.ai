import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  filterFromQuery,
  type ReplayElementRowDto,
  type ReplayHeatGridDto,
  type ReplayReleaseDto,
} from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { HeatmapView } from './HeatmapView';

/**
 * THE heatmap: one release, side by side with a compare release, or the
 * difference — read through `replayApi` only; the page behind it is rebuilt by
 * the rrweb loader seam (replaced here by a same-origin iframe holding a
 * button), and an element-table row highlights that element's zone.
 */

const loader = vi.hoisted(() => ({
  createSnapshotReplayer: vi.fn(async (events: unknown[], root: HTMLElement) => {
    void events;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('width', '1280');
    root.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = '<main><button data-testid="buy">Buy now</button><p>Plain text</p></main>';
    return { iframe, destroy: vi.fn(), pause: vi.fn(), play: vi.fn() };
  }),
}));
vi.mock('../rrwebLoader', () => ({ createSnapshotReplayer: loader.createSnapshotReplayer }));

const grid = (over: Partial<ReplayHeatGridDto> = {}): ReplayHeatGridDto => ({
  route: '/pricing',
  releaseKey: null,
  deviceClass: null,
  kind: 'click',
  cells: [{ gx: 4, gy: 6, n: 8 }, { gx: 10, gy: 2, n: 2 }],
  total: 10,
  ...over,
});

const release = (key: string, ordinal: number, label: string | null): ReplayReleaseDto => ({
  releaseKey: key,
  label,
  ordinal,
  source: 'explicit',
  firstSeenAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-12T00:00:00.000Z',
});

const elements: ReplayElementRowDto[] = [
  { selector: 'getByTestId("buy")', label: 'Buy now', clicks: 40, rage: 3, dead: 0, compareClicks: 20, delta: 1, score: 9 },
  { selector: 'main > p', label: null, clicks: 5, rage: 0, dead: 4, compareClicks: 5, delta: 0, score: 2 },
];

beforeEach(() => {
  loader.createSnapshotReplayer.mockClear();
  vi.spyOn(replayApi, 'heatGrid').mockImplementation(async (_site, query) => grid({ releaseKey: query.release ?? null, kind: query.kind ?? 'click' }));
  vi.spyOn(replayApi, 'heatElements').mockResolvedValue(elements);
  vi.spyOn(replayApi, 'heatRoutes').mockResolvedValue([{ route: '/pricing', sessions: 30, pageviews: 90 }, { route: '/', sessions: 80, pageviews: 120 }]);
  vi.spyOn(replayApi, 'listReleases').mockResolvedValue([release('rel-b', 2, null), release('rel-a', 1, 'Spring')]);
  vi.spyOn(replayApi, 'heatSnapshot').mockResolvedValue({ recordingId: 'rec-9', seq: 3 });
  vi.spyOn(replayApi, 'getRecordingChunk').mockResolvedValue([{ type: 4, timestamp: 1 }, { type: 2, timestamp: 2 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HeatmapView', () => {
  it('reads the layer for the route and rebuilds the page behind it from the snapshot chunk', async () => {
    render(<HeatmapView siteId="site-1" route="/pricing" days={30} />);
    await waitFor(() => expect(replayApi.heatGrid).toHaveBeenCalledWith('site-1', expect.objectContaining({ route: '/pricing', release: null, kind: 'click', days: 30 })));
    await waitFor(() => expect(replayApi.getRecordingChunk).toHaveBeenCalledWith('site-1', 'rec-9', 3));
    expect(loader.createSnapshotReplayer).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/replay\.heat\.exactTotal 10/)).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'replay.heat.legendAria' })).toHaveTextContent('replay.heat.legendCold');

    fireEvent.click(screen.getByRole('tab', { name: 'replay.heat.layers.rage' }));
    await waitFor(() => expect(replayApi.heatGrid).toHaveBeenLastCalledWith('site-1', expect.objectContaining({ kind: 'rage' })));
  });

  it('offers the compare modes only once a compare release is chosen', async () => {
    render(<HeatmapView siteId="site-1" route="/pricing" />);
    await screen.findAllByRole('option', { name: 'Spring' });
    expect(screen.getByRole('tab', { name: 'replay.heat.modes.side' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'replay.heat.modes.difference' })).toBeDisabled();
    expect(screen.getByText('replay.heat.compareHint')).toBeInTheDocument();
    expect(screen.getAllByTestId('heat-stage')).toHaveLength(1);
  });

  it('switches between one release, side by side and the difference', async () => {
    render(<HeatmapView siteId="site-1" route="/pricing" />);
    await screen.findAllByRole('option', { name: 'Spring' });
    fireEvent.change(screen.getByLabelText('replay.heat.compare'), { target: { value: 'rel-a' } });

    fireEvent.click(screen.getByRole('tab', { name: 'replay.heat.modes.side' }));
    expect(screen.getByTestId('heatmap-view')).toHaveAttribute('data-mode', 'side');
    await waitFor(() => expect(screen.getAllByTestId('heat-stage')).toHaveLength(2));
    await waitFor(() => expect(replayApi.heatGrid).toHaveBeenCalledWith('site-1', expect.objectContaining({ release: 'rel-a', kind: 'click' })));
    expect(screen.getByText('replay.heat.sideCompare Spring')).toBeInTheDocument();
    // Both pages are rebuilt, each for its own release.
    await waitFor(() => expect(replayApi.heatSnapshot).toHaveBeenCalledWith('site-1', expect.objectContaining({ release: 'rel-a' })));

    fireEvent.click(screen.getByRole('tab', { name: 'replay.heat.modes.difference' }));
    expect(screen.getByTestId('heatmap-view')).toHaveAttribute('data-mode', 'difference');
    expect(screen.getAllByTestId('heat-stage')).toHaveLength(1);
    expect(screen.getByText('replay.heat.differenceCaption replay.heat.allReleases Spring')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'replay.heat.legendDiffAria' })).toHaveTextContent('replay.heat.legendMore');
    // The element table gains the change column once there is something to compare.
    expect(screen.getByRole('button', { name: 'replay.heat.elements.sortBy replay.heat.elements.delta' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'replay.heat.modes.single' }));
    expect(screen.getByTestId('heatmap-view')).toHaveAttribute('data-mode', 'single');
  });

  it('highlights an element-table row zone on the rebuilt page', async () => {
    render(<HeatmapView siteId="site-1" route="/pricing" />);
    const rows = await screen.findAllByTestId('heat-element-row');
    const buy = rows.find((row) => row.getAttribute('data-selector') === 'getByTestId("buy")')!;
    // Wait for the page to be rebuilt before hovering.
    await waitFor(() => expect(loader.createSnapshotReplayer).toHaveBeenCalled());

    fireEvent.mouseEnter(buy);
    const highlight = await screen.findByTestId('heat-highlight');
    expect(highlight).toHaveAttribute('data-selector', 'getByTestId("buy")');
    await waitFor(() => expect(screen.getByTestId('heat-highlight')).toHaveAttribute('data-located', 'true'));

    fireEvent.mouseLeave(buy.parentElement!);
    expect(screen.queryByTestId('heat-highlight')).toBeNull();
  });

  it('opens the issues kind for visits that clicked an element', async () => {
    const push = vi.fn();
    render(<HeatmapView siteId="site-1" route="/pricing" push={push} />);
    const rows = await screen.findAllByTestId('heat-element-row');
    const buy = rows.find((row) => row.getAttribute('data-selector') === 'getByTestId("buy")')!;
    fireEvent.click(within(buy).getByRole('button', { name: 'replay.heat.elements.openAria Buy now' }));

    expect(push).toHaveBeenCalledTimes(1);
    const level = push.mock.calls[0]![0] as { kind: string; id: string };
    expect(level.kind).toBe('issues');
    expect(filterFromQuery(level.id).all).toEqual([
      { field: 'visitedPath', op: 'eq', value: '/pricing' },
      { field: 'clickedSelector', op: 'eq', value: 'getByTestId("buy")' },
    ]);
  });

  it('draws Areas boxes from the rebuilt page instead of heat cells', async () => {
    render(<HeatmapView siteId="site-1" route="/pricing" />);
    await waitFor(() => expect(loader.createSnapshotReplayer).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'replay.heat.layers.areas' }));
    const areas = await screen.findByTestId('heat-areas');
    expect(screen.queryByTestId('heat-overlay')).toBeNull();
    await waitFor(() => expect(areas.querySelector('[data-selector=\'getByTestId("buy")\']')).not.toBeNull());
    // Areas always shows one release: the compare modes are off.
    expect(screen.getByRole('tab', { name: 'replay.heat.modes.side' })).toBeDisabled();
  });
});
