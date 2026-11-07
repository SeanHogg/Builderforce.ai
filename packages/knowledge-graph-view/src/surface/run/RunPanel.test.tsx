// @vitest-environment jsdom
/** The Run drawer (PRD 41 A8): phases, lanes that update live, the step feed and its filter, failures with Retry, history, Stop. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { KnowledgeGraphSource, ReviewRunsPort, StoredReviewRun } from '../../types';
import type { ReviewRun as ReviewMachine } from '../../useReviewRun';
import type { PanelProps } from '../registry';
import { RunPanel } from './RunPanel';
import { finishedRun, liveRun, RUN_AT, summaryOf } from './runFixture';
import { useReviewRunRecord } from './useReviewRunRecord';

const t = L.surface.run;

function machine(status: ReviewMachine['state']['status'] = 'running'): ReviewMachine {
    return { state: { status } as ReviewMachine['state'], available: true, start: vi.fn(), answer: vi.fn(), rereviewAll: vi.fn(), stop: vi.fn(), dismiss: vi.fn() };
}

function portOf(over: Partial<ReviewRunsPort> = {}) {
    const listeners = new Set<(run: StoredReviewRun) => void>();
    const port: ReviewRunsPort = {
        subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        stop: vi.fn(async () => undefined),
        ...over,
    };
    return { port, push: (run: StoredReviewRun) => act(() => listeners.forEach((l) => l(run))) };
}

function Harness({ port, review, rootId = 'docs', canReview = true }: { port: ReviewRunsPort; review: ReviewMachine; rootId?: string; canReview?: boolean }) {
    const source = { runs: port, ...(canReview ? { review: () => (async function* () { /* never started here */ })() } : {}) } as unknown as KnowledgeGraphSource;
    const read = useReviewRunRecord(source, rootId, true);
    return <RunPanel {...({ labels: L, source, rootId, runs: { read, review }, sync: null } as unknown as PanelProps)} />;
}

describe('the Run panel', () => {
    it('draws only the phases the run reached, the active one highlighted, with done of total, rate and ETA', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine()} />);
        push(liveRun());

        const rows = within(screen.getByTestId('kg-run-timeline')).getAllByRole('listitem');
        expect(rows.map((r) => r.dataset.phase)).toEqual(['plan', 'extract', 'judge']);
        const extract = rows[1]!;
        expect(extract.dataset.state).toBe('active');
        expect(rows[0]!.dataset.state).toBe('done');
        expect(within(extract).getByText('6 of 10')).toBeTruthy();
        expect(within(extract).getByText(/\/s$/)).toBeTruthy();
        expect(within(extract).getByText(/^about .* left$/)).toBeTruthy();
        // No phase was invented: nothing for write or index.
        expect(screen.queryByText(L.phases.write)).toBeNull();
    });

    it('shows "Map complete" after index and judge as its own pass, with the files still waiting to be judged and no judge ETA on other rows (PRD 41 A10)', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine()} />);
        push(liveRun({
            phases: [
                { phase: 'plan', startedAt: RUN_AT, endedAt: RUN_AT + 500, done: 1, total: 1 },
                { phase: 'index', startedAt: RUN_AT + 500, endedAt: RUN_AT + 4000, done: 10, total: 10 },
                { phase: 'mapped', startedAt: RUN_AT + 4000, endedAt: RUN_AT + 4000, done: 1, total: 1 },
                { phase: 'judge', startedAt: RUN_AT + 4000, done: 1, total: 4 },
            ],
        }));
        const rows = within(screen.getByTestId('kg-run-timeline')).getAllByRole('listitem');
        expect(rows.map((r) => r.dataset.phase)).toEqual(['plan', 'index', 'mapped', 'judge']);
        expect(within(rows[2]!).getByText(L.phases.mapped)).toBeTruthy();
        expect(rows[3]!.dataset.state).toBe('active');
        expect(within(rows[1]!).queryByText(/^about .* left$/)).toBeNull();
        expect(screen.getByTestId('kg-run-awaiting-judge').textContent).toBe('3 files waiting to be judged');
    });

    it('lists the five slowest steps, longest first, with their reason and the read / lookup / pool split', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine()} />);
        const mk = (n: number, ms: number, extra: Partial<StoredReviewRun['steps'][number]> = {}) => ({ path: `src/f${n}.ts`, phase: 'extract' as const, ms, outcome: 'ok' as const, ...extra });
        push(liveRun({
            steps: [
                mk(1, 10), mk(2, 240_000, { outcome: 'failed', reason: 'timed out', parts: { readMs: 5, lookupMs: 230_000, poolMs: 10 } }),
                mk(3, 300), mk(4, 20), mk(5, 90), mk(6, 40), mk(7, 50),
            ],
        }));
        const rows = within(screen.getByTestId('kg-run-slowest')).getAllByRole('listitem');
        expect(rows).toHaveLength(5);
        expect(within(rows[0]!).getByText('f2.ts')).toBeTruthy();
        expect(within(rows[0]!).getByText(t.reasons.timeout)).toBeTruthy();
        expect(within(rows[0]!).getByTestId('kg-run-slowest-parts').textContent).toContain('lookup');
        expect(within(rows[1]!).getByText('f3.ts')).toBeTruthy();
    });

    it('shows one lane per worker of the current phase and follows the run live', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine()} />);
        push(liveRun());

        const lanes = within(screen.getByTestId('kg-run-lanes')).getAllByRole('listitem');
        expect(lanes).toHaveLength(2);
        expect(lanes[0]!.textContent).toContain('bad.ts');
        expect(lanes[1]!.textContent).toContain('c.md');

        push(liveRun({ lanes: [
            { phase: 'extract', id: 0, path: 'src/next.ts', done: 4, busyMs: 1200 },
            { phase: 'extract', id: 1, path: 'docs/c.md', done: 2, busyMs: 700 },
        ] }));
        const after = within(screen.getByTestId('kg-run-lanes')).getAllByRole('listitem');
        expect(after[0]!.textContent).toContain('next.ts');
        expect(after[0]!.textContent).toContain('4 files');
    });

    it('shows only this folder\'s run: another folder\'s review is not this panel\'s run', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine()} />);
        push(liveRun({ root: 'other-folder' }));
        expect(screen.queryByTestId('kg-run-timeline')).toBeNull();
        push(liveRun({ root: 'docs' }));
        expect(screen.getByTestId('kg-run-timeline')).toBeTruthy();
    });

    it('lists the steps newest first and filters them by outcome', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine()} />);
        push(liveRun());

        const items = () => within(screen.getByTestId('kg-run-steps')).getAllByRole('listitem');
        expect(items().map((i) => i.dataset.outcome)).toEqual(['failed', 'skipped', 'cached', 'ok']);

        fireEvent.click(screen.getByRole('radio', { name: t.filters.failed }));
        expect(items().map((i) => i.dataset.outcome)).toEqual(['failed']);
        fireEvent.click(screen.getByRole('radio', { name: t.filters.cached }));
        expect(items().map((i) => i.dataset.outcome)).toEqual(['cached']);
        fireEvent.click(screen.getByRole('radio', { name: t.filters.skipped }));
        expect(items().map((i) => i.dataset.outcome)).toEqual(['skipped']);
    });

    it('says a failure in words with the raw text in the tooltip', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine('done')} />);
        push(finishedRun());

        const failures = within(screen.getByTestId('kg-run-failures')).getAllByRole('listitem');
        expect(failures).toHaveLength(2);
        expect(within(failures[0]!).getByText(t.reasons.other).getAttribute('title')).toBe('Unexpected token }');
        expect(within(failures[1]!).getByText(t.reasons.timeout)).toBeTruthy();
    });

    it('Retry starts a normal review of the root for those files (the plan and confirm follow), keeping a seed run a seed', () => {
        const { port, push } = portOf();
        const review = machine('done');
        render(<Harness port={port} review={review} />);
        push(finishedRun());

        fireEvent.click(screen.getByRole('button', { name: 'Retry src/slow.ts' }));
        expect(review.start).toHaveBeenLastCalledWith({ rootId: 'docs', retry: ['src/slow.ts'] });
        fireEvent.click(screen.getByRole('button', { name: 'Retry all 2 files' }));
        expect(review.start).toHaveBeenLastCalledWith({ rootId: 'docs', retry: ['src/bad.ts', 'src/slow.ts'] });

        push(finishedRun({ id: 'run-seed', kind: 'seed' }));
        fireEvent.click(screen.getByRole('button', { name: 'Retry src/slow.ts' }));
        expect(review.start).toHaveBeenLastCalledWith({ rootId: 'docs', retry: ['src/slow.ts'], seed: true });
    });

    it('does not enable Retry while the run goes on or while any review of the folder is in flight', () => {
        const live = portOf();
        const first = render(<Harness port={live.port} review={machine()} />);
        live.push(liveRun());
        expect((screen.getByRole('button', { name: 'Retry src/bad.ts' }) as HTMLButtonElement).disabled).toBe(true);
        first.unmount();

        for (const status of ['planning', 'confirm', 'running'] as const) {
            const busy = portOf();
            const view = render(<Harness port={busy.port} review={machine(status)} />);
            busy.push(finishedRun());
            expect((screen.getByRole('button', { name: 'Retry src/bad.ts' }) as HTMLButtonElement).disabled, status).toBe(true);
            view.unmount();
        }

        const idle = portOf();
        render(<Harness port={idle.port} review={machine('done')} />);
        idle.push(finishedRun());
        expect((screen.getByRole('button', { name: 'Retry src/bad.ts' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('offers no Retry at all for a host that cannot review', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine('done')} canReview={false} />);
        push(finishedRun());
        expect(screen.queryByRole('button', { name: 'Retry src/bad.ts' })).toBeNull();
    });

    it('fetches the whole record once a run ends with more failures than the event carried', async () => {
        const full = finishedRun({ id: 'run-big', failures: Array.from({ length: 70 }, (_v, i) => ({ path: `f${i}.ts`, phase: 'extract' as const, reason: 'boom' })) });
        const { port, push } = portOf({ get: vi.fn(async () => full) });
        render(<Harness port={port} review={machine('done')} />);
        push({ ...full, failures: full.failures.slice(-50), failureCount: 70 });

        await waitFor(() => expect(within(screen.getByTestId('kg-run-failures')).getAllByRole('listitem')).toHaveLength(70));
        expect(port.get).toHaveBeenCalledWith('run-big');
        expect(screen.getByRole('button', { name: 'Retry all 70 files' })).toBeTruthy();
    });

    it('says only the latest failures are listed (and Retry all retries only those) when the whole record cannot be fetched', async () => {
        const full = finishedRun({ id: 'run-big', failures: Array.from({ length: 70 }, (_v, i) => ({ path: `f${i}.ts`, phase: 'extract' as const, reason: 'boom' })) });
        const { port, push } = portOf({ get: vi.fn(async () => { throw new Error('gone'); }) });
        render(<Harness port={port} review={machine('done')} />);
        push({ ...full, failures: full.failures.slice(-50), failureCount: 70 });

        const note = await screen.findByTestId('kg-run-failures-truncated');
        expect(note.textContent).toBe('Only the latest 50 of 70 failures are listed, and Retry all retries only those.');
        await waitFor(() => expect(port.get).toHaveBeenCalled());
    });

    it('shows no truncation note once the whole record is held', async () => {
        const full = finishedRun({ id: 'run-big', failures: Array.from({ length: 70 }, (_v, i) => ({ path: `f${i}.ts`, phase: 'extract' as const, reason: 'boom' })) });
        const { port, push } = portOf({ get: vi.fn(async () => full) });
        render(<Harness port={port} review={machine('done')} />);
        push({ ...full, failures: full.failures.slice(-50), failureCount: 70 });
        await waitFor(() => expect(within(screen.getByTestId('kg-run-failures')).getAllByRole('listitem')).toHaveLength(70));
        expect(screen.queryByTestId('kg-run-failures-truncated')).toBeNull();
    });

    it('does not fetch while the run is still going', async () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine()} />);
        push({ ...liveRun(), failureCount: 90 });
        await act(async () => { await Promise.resolve(); });
        expect(port.get).not.toHaveBeenCalled();
    });

    it('says once that parallel extraction was unavailable', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine('done')} />);
        push(finishedRun({ poolDown: 'The extraction worker crashed: boom' }));
        expect(screen.getByTestId('kg-run-pool-down').textContent).toBe(
            'Parallel extraction unavailable · The extraction worker crashed: boom · extracting on one thread',
        );
    });

    it('names an interrupted run, and a summary row shows its outcome', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine('done')} />);
        push(finishedRun({ outcome: 'interrupted' }));
        expect(screen.getByText(new RegExp(`${t.outcomes.interrupted}$`))).toBeTruthy();
    });

    it('shows the replica row from a finished run', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine('done')} />);
        push(finishedRun());
        expect(screen.getByTestId('kg-sync-replica').dataset.queued).toBe('3');
    });

    it('lists past runs; opening one shows it frozen in the same panel, and Back returns to the live run', async () => {
        const old = finishedRun({ id: 'run-old', kind: 'review', startedAt: Date.UTC(2026, 9, 1), failures: [] });
        const { port, push } = portOf({ list: vi.fn(async () => [summaryOf(old)]), get: vi.fn(async (id) => (id === 'run-old' ? old : null)) });
        render(<Harness port={port} review={machine('done')} />);
        push(liveRun({ id: 'run-new', endedAt: liveRun().updatedAt, outcome: 'done' }));

        const history = await screen.findByTestId('kg-run-history');
        fireEvent.click(within(history).getByRole('button'));
        expect(await screen.findByText(/^A finished run from /)).toBeTruthy();
        expect(port.get).toHaveBeenCalledWith('run-old');
        // The frozen run has no failures: the live one's list is gone.
        expect(screen.queryByTestId('kg-run-failures')).toBeNull();
        expect(screen.getByText(t.failuresNone)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: t.backToLive }));
        await waitFor(() => expect(screen.queryByText(/^A finished run from /)).toBeNull());
        expect(screen.getByTestId('kg-run-failures')).toBeTruthy();
    });

    it('offers Retry on the latest run only, not on an older run opened from the history', async () => {
        const older = finishedRun({ id: 'run-older' });
        const newest = finishedRun({ id: 'run-newest' });
        const { port, push } = portOf({
            list: vi.fn(async () => [summaryOf(newest), summaryOf(older)]),
            get: vi.fn(async (id) => (id === 'run-older' ? older : newest)),
        });
        render(<Harness port={port} review={machine('done')} />);
        push(newest);
        const history = await screen.findByTestId('kg-run-history');
        expect((screen.getByRole('button', { name: 'Retry src/bad.ts' }) as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(within(history).getAllByRole('button')[1]!);
        await screen.findByText(/^A finished run from /);
        expect((screen.getByRole('button', { name: 'Retry src/bad.ts' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('says so when a past run is no longer held', async () => {
        const old = finishedRun({ id: 'run-old' });
        const { port, push } = portOf({ list: vi.fn(async () => [summaryOf(old)]) });
        render(<Harness port={port} review={machine('done')} />);
        push(liveRun({ id: 'run-new', endedAt: 1, outcome: 'done' }));
        fireEvent.click(within(await screen.findByTestId('kg-run-history')).getByRole('button'));
        expect(await screen.findByText(t.runUnavailable)).toBeTruthy();
    });

    it('Stop ends the run through the review while the view owns it, and by run id otherwise', async () => {
        const mine = portOf();
        const review = machine('running');
        const first = render(<Harness port={mine.port} review={review} />);
        mine.push(liveRun());
        fireEvent.click(screen.getByRole('button', { name: L.reviewStop }));
        expect(review.stop).toHaveBeenCalledTimes(1);
        first.unmount();

        const other = portOf();
        render(<Harness port={other.port} review={machine('idle')} />);
        other.push(liveRun({ id: 'run-other' }));
        fireEvent.click(screen.getByRole('button', { name: L.reviewStop }));
        await waitFor(() => expect(other.port.stop).toHaveBeenCalledWith('run-other'));
    });
});
