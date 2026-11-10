import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunDelta } from '@builderforce/run-delta';
import en from '@/i18n/messages/en.json';
import { ApiRequestError } from '@/lib/apiClient';
import { getRunDeltas, type StoredRunDelta } from '@/lib/runDeltasApi';
import { RunDeltaForRun } from './RunDeltaForRun';
import { deltaReadBudget, settledRunStatus } from '@/lib/runDeltaSettle';

describe('settledRunStatus', () => {
  it('names only the terminal statuses as settled', () => {
    for (const s of ['completed', 'failed', 'cancelled']) expect(settledRunStatus(s)).toBe(s);
    for (const s of ['pending', 'submitted', 'running', 'paused', 'awaiting_approval', 'something-new', null, undefined]) expect(settledRunStatus(s)).toBeNull();
    expect(deltaReadBudget('cancelled')).toBeLessThan(deltaReadBudget('completed'));
  });
});

vi.mock('@/lib/runDeltasApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/runDeltasApi')>()),
  getRunDeltas: vi.fn(),
}));
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    (open ? <aside aria-label={title}>{children}</aside> : null),
}));

const mocked = vi.mocked(getRunDeltas);

function stored(runId: string, repoKey: string, headline: RunDelta['headline'] = 'worse'): StoredRunDelta {
  const delta = {
    version: 1, runId, headline, digest: 'd', blocking: [], excluded: [],
    summary: { verdict: headline, clauses: [], unchanged: [], notMeasured: [] },
    blastRadius: { score: 4, band: 'medium', formula: 'v1', reasons: [] },
    dimensions: [{ id: 'security', verdict: headline, reasons: [], findings: [], metrics: [], measuredBy: [] }],
  } as unknown as RunDelta;
  return {
    runId, repoKey, surface: 'cloud', mode: 'autonomous', computedAt: '2026-11-03T10:00:00Z', headline, summary: delta.summary,
    verdicts: { security: headline }, counts: { introduced: 0, resolved: 0 }, blastRadius: { score: 4, band: 'medium' }, blocking: [], digest: 'd', delta,
  };
}

const view = (runId: string, settled: string | null) => (
  <NextIntlClientProvider locale="en" messages={en}>
    <RunDeltaForRun runId={runId} settled={settled} />
  </NextIntlClientProvider>
);

/** Let the poll's immediate read and its state updates land. */
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe('RunDeltaForRun', () => {
  beforeEach(() => {
    mocked.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('does not read while the run is still going, and reads once it settles', async () => {
    mocked.mockImplementation(async () => []);
    const { rerender, container } = render(view('cloud:9', null));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocked).not.toHaveBeenCalled();
    rerender(view('cloud:9', 'completed'));
    await flush();
    expect(mocked).toHaveBeenCalledWith('cloud:9', expect.anything());
    expect(container.querySelector('[data-run-delta-for-run]')).toBeNull();
  });

  it('renders nothing for a reader who is not entitled, and stops asking', async () => {
    mocked.mockImplementation(async () => { throw new ApiRequestError('forbidden', 403); });
    const { container } = render(view('cloud:9', 'completed'));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-run-delta-for-run]')).toBeNull();
  });

  it('gives up quietly on a cancelled run after a short window', async () => {
    mocked.mockImplementation(async () => []);
    const { container } = render(view('cloud:9', 'cancelled'));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(mocked).toHaveBeenCalledTimes(1 + deltaReadBudget('cancelled'));
    expect(container.querySelector('[data-run-delta-for-run]')).toBeNull();
  });

  it('stops polling once every delta is final', async () => {
    mocked.mockImplementation(async () => [stored('cloud:9', 'https://example.test/api.git')]);
    render(view('cloud:9', 'completed'));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('shows one card per repository and opens the panel from Open details', async () => {
    mocked.mockImplementation(async () => [stored('cloud:9', 'https://example.test/api.git'), stored('cloud:9', 'https://example.test/web.git', 'same')]);
    render(view('cloud:9', 'completed'));
    await flush();
    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('web')).toBeTruthy();
    const open = screen.getAllByRole('button', { name: 'Open details' });
    expect(open).toHaveLength(2);
    fireEvent.click(open[0]!);
    expect(screen.getByRole('complementary', { name: 'What this run changed' })).toBeTruthy();
  });
});
