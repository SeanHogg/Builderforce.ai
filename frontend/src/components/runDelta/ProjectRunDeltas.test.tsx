import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunDelta } from '@builderforce/run-delta';
import en from '@/i18n/messages/en.json';
import { ApiRequestError } from '@/lib/apiClient';
import { getRunDeltas, listProjectRunDeltas, type RunDeltaSummary } from '@/lib/runDeltasApi';
import { ProjectRunDeltas } from './ProjectRunDeltas';

vi.mock('@/lib/runDeltasApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/runDeltasApi')>()),
  listProjectRunDeltas: vi.fn(),
  getRunDeltas: vi.fn(),
}));
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    (open ? <aside aria-label={title}>{children}</aside> : null),
}));

const list = vi.mocked(listProjectRunDeltas);
const get = vi.mocked(getRunDeltas);

const summary = (runId: string, computedAt: string, headline: RunDeltaSummary['headline']): RunDeltaSummary => ({
  runId, repoKey: 'https://example.test/repo.git', surface: 'cloud', mode: 'interactive', computedAt, headline,
  summary: { verdict: headline, clauses: [], unchanged: [], notMeasured: [] }, verdicts: { security: headline },
  counts: { introduced: 1, resolved: 0 }, blastRadius: { score: 3, band: 'low' }, blocking: [], digest: `d-${runId}`,
});

const delta = (runId: string) => ({
  version: 1, runId, headline: 'worse', digest: 'd', blocking: [], excluded: [],
  summary: { verdict: 'worse', clauses: [], unchanged: [], notMeasured: [] },
  blastRadius: { score: 3, band: 'low', formula: 'v1', reasons: [] }, dimensions: [],
}) as unknown as RunDelta;

const FIRST = [summary('r2', '2026-11-02T10:00:00Z', 'worse'), summary('r1', '2026-11-01T10:00:00Z', 'better')];

const renderProject = (projectId = 42) => render(
  <NextIntlClientProvider locale="en" messages={en}>
    <ProjectRunDeltas projectId={projectId} />
  </NextIntlClientProvider>,
);

const rows = () => document.querySelectorAll('li[data-run]');

describe('ProjectRunDeltas', () => {
  beforeEach(() => { list.mockReset(); get.mockReset(); });

  it('renders nothing when the project has no run delta surface for this reader', async () => {
    list.mockImplementation(async () => { throw new ApiRequestError('not found', 404); });
    const { container } = renderProject();
    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-run-delta-history-section]')).toBeNull());
  });

  it('shows the trend and the runs, pages older runs, and opens a run in the panel', async () => {
    list.mockImplementationOnce(async () => ({ items: FIRST, nextCursor: 'c1' }));
    renderProject();
    expect(await screen.findByRole('img', { name: '2 runs: 1 worse, 1 better' })).toBeTruthy();
    expect(list).toHaveBeenCalledWith(42, expect.objectContaining({ limit: 50 }));

    list.mockImplementationOnce(async () => ({ items: [summary('r0', '2026-10-31T10:00:00Z', 'same')] }));
    fireEvent.click(screen.getByRole('button', { name: 'Show older runs' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(list).toHaveBeenLastCalledWith(42, expect.objectContaining({ limit: 50, cursor: 'c1' }));

    get.mockImplementation(async () => [{ ...summary('r2', '2026-11-02T10:00:00Z', 'worse'), delta: delta('r2') }]);
    fireEvent.click(document.querySelector('li[data-run="r2"] button')!);
    expect(await screen.findByRole('complementary', { name: 'What this run changed' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('r2', expect.anything());
  });

  it('keeps the rows when "show older runs" fails, and retries that same page', async () => {
    list.mockImplementationOnce(async () => ({ items: FIRST, nextCursor: 'c1' }));
    renderProject();
    await waitFor(() => expect(rows()).toHaveLength(2));

    list.mockImplementationOnce(async () => { throw new ApiRequestError('boom', 500); });
    fireEvent.click(screen.getByRole('button', { name: 'Show older runs' }));
    expect(await screen.findByText('Run deltas could not be loaded.')).toBeTruthy();
    expect(rows()).toHaveLength(2);

    list.mockImplementationOnce(async () => ({ items: [summary('r0', '2026-10-31T10:00:00Z', 'same')] }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(list).toHaveBeenLastCalledWith(42, expect.objectContaining({ cursor: 'c1' }));
  });

  it('reports a run that could not be opened, and never opens a stale selection', async () => {
    list.mockImplementationOnce(async () => ({ items: FIRST }));
    renderProject();
    await waitFor(() => expect(rows()).toHaveLength(2));

    get.mockImplementationOnce(async () => { throw new ApiRequestError('boom', 500); });
    fireEvent.click(document.querySelector('li[data-run="r2"] button')!);
    expect(await screen.findByText('This run delta could not be opened.')).toBeTruthy();

    // r1's answer is slow; r2 is selected after it and answers first — the late r1 answer must not replace it.
    let answerR1: (v: Awaited<ReturnType<typeof getRunDeltas>>) => void = () => {};
    get.mockImplementationOnce(() => new Promise((resolve) => { answerR1 = resolve; }));
    get.mockImplementationOnce(async () => [{ ...summary('r2', '2026-11-02T10:00:00Z', 'worse'), delta: delta('r2') }]);
    fireEvent.click(document.querySelector('li[data-run="r1"] button')!);
    fireEvent.click(document.querySelector('li[data-run="r2"] button')!);
    await screen.findByRole('complementary', { name: 'What this run changed' });
    answerR1([{ ...summary('r1', '2026-11-01T10:00:00Z', 'better'), delta: delta('r1') }]);
    await waitFor(() => expect(document.querySelector('li[data-run="r2"] button')!.getAttribute('aria-current')).toBe('true'));
  });

  it('starts over for a different project', async () => {
    list.mockImplementationOnce(async () => ({ items: FIRST }));
    const { rerender } = renderProject(42);
    await waitFor(() => expect(rows()).toHaveLength(2));
    list.mockImplementationOnce(async () => ({ items: [] }));
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProjectRunDeltas projectId={7} />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(7, expect.objectContaining({ limit: 50 })));
    await waitFor(() => expect(rows()).toHaveLength(0));
  });
});
