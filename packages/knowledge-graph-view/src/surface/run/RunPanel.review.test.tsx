// @vitest-environment jsdom
/** The Review tab by state: counting, the plan (tiles, choice, three steps, the pace estimate), running (steps, where the time goes, links, reading now), stopping, stopped, finished. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillTemplate } from '../../labels';
import { FIXTURE_PLAN } from '../../testing';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { finishedRun, liveRun, RUN_AT, summaryOf } from './runFixture';
import { createKit, r } from './runPanelKit';

const { machine, portOf, Harness, tab, footer } = createKit({ fn: vi.fn as never, act, screen });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the Review tab', () => {
    it('counts the files at once when opened with nothing planned, and not again over a plan', () => {
        const idle = machine({ status: 'idle' });
        render(<Harness port={portOf().port} review={idle} />);
        expect(idle.start).toHaveBeenCalledWith({ rootId: 'docs' });
        cleanup();
        const planned = machine({ status: 'confirm', plan: { ...FIXTURE_PLAN } });
        render(<Harness port={portOf().port} review={planned} />);
        expect(planned.start).not.toHaveBeenCalled();
    });

    it('shows the plan: three tiles, two choices with what changed chosen, the three steps; Start review answers yes', () => {
        const review = machine({ status: 'confirm', plan: { ...FIXTURE_PLAN, judgeFiles: 5 }, estimate: { modelCalls: 4, costUsd: 0.08 } });
        render(<Harness port={portOf().port} review={review} />);
        const start = screen.getByTestId('kg-review-start');
        expect(within(start).getByText(r.tileUnchanged)).toBeTruthy();
        const [changed, everything] = within(start).getAllByRole('radio');
        expect(changed!.getAttribute('aria-checked')).toBe('true');
        expect(within(changed!).getByText('3 files')).toBeTruthy();
        expect(within(everything!).getByText('4 files')).toBeTruthy();
        const steps = within(screen.getByTestId('kg-review-will')).getAllByRole('listitem');
        expect(steps).toHaveLength(3);
        expect(steps[0]!.textContent).toContain(r.estimateNone);
        expect(steps[1]!.textContent).toContain(fillTemplate(r.willJudge, { count: 5 }));
        expect(steps[1]!.textContent).toContain('≈ 4 model calls');
        expect(footer().textContent).toBe(r.actionStart);
        fireEvent.click(footer());
        expect(review.answer).toHaveBeenCalledWith(true);
    });

    it('estimates the read from the last earlier run\'s pace when it read enough files', async () => {
        const big = finishedRun({
            id: 'run-big', phases: [{ phase: 'extract', startedAt: RUN_AT, endedAt: RUN_AT + 60_000, done: 600, total: 600 }], endedAt: RUN_AT + 65_000, updatedAt: RUN_AT + 65_000,
        });
        const { port } = portOf({ list: vi.fn(async () => [summaryOf(big)]) });
        render(<Harness port={port} review={machine({ status: 'confirm', plan: { ...FIXTURE_PLAN, files: 100 } })} />);
        // 100 files at 10 files/s
        await waitFor(() => expect(within(screen.getByTestId('kg-review-will')).getAllByRole('listitem')[0]!.textContent).toContain(fillTemplate(r.estimate, { duration: '10 s', rate: '10' })));
    });

    it('Everything again re-plans with force and stays chosen while force is set; What changed goes back', () => {
        const review = machine({ status: 'confirm', plan: { ...FIXTURE_PLAN }, force: true });
        render(<Harness port={portOf().port} review={review} />);
        const [changed, everything] = within(screen.getByTestId('kg-review-start')).getAllByRole('radio');
        expect(everything!.getAttribute('aria-checked')).toBe('true');
        fireEvent.click(changed!);
        expect(review.start).toHaveBeenCalledWith({ rootId: 'docs' });
        cleanup();
        const plain = machine({ status: 'confirm', plan: { ...FIXTURE_PLAN } });
        render(<Harness port={portOf().port} review={plain} />);
        fireEvent.click(within(screen.getByTestId('kg-review-start')).getAllByRole('radio')[1]!);
        expect(plain.rereviewAll).toHaveBeenCalled();
    });

    it('says it is counting while planning', () => {
        render(<Harness port={portOf().port} review={machine({ status: 'planning' })} />);
        expect(screen.getByTestId('kg-review-planning').textContent).toContain('Docs');
        expect(footer().disabled).toBe(true);
    });

    it('while running shows the steps with the current one marked, and the where-the-time-goes lines only for data that exists', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine({ status: 'running' })} />);
        push(liveRun());
        const steps = within(screen.getByTestId('kg-review-steps')).getAllByRole('listitem');
        expect(steps.map((s) => s.dataset.state)).toEqual(['done', 'done', 'active', 'active', 'pending']);
        expect(screen.getByTestId('kg-review-count').textContent).toBe(fillTemplate(r.filesRead, { done: '6', total: '10' }));
        expect(screen.queryByTestId('kg-review-where')).toBeNull();

        push(liveRun({
            failures: [{ path: 'a.ts', phase: 'extract', reason: 'request timed out' }],
            steps: [{ path: 'a.ts', phase: 'extract', ms: 60_000, outcome: 'failed', reason: 'request timed out', parts: { poolMs: 12_000 } }],
            hostLag: { maxMs: 31_000, p99Ms: 900, meanMs: 12 },
        }));
        const lines = within(screen.getByTestId('kg-review-where')).getAllByRole('listitem').map((li) => li.textContent);
        expect(lines).toEqual([
            fillTemplate(r.whereTimeouts, { files: '1 file', seconds: '60' }),
            fillTemplate(r.whereWait, { seconds: '12' }),
            fillTemplate(r.whereStall, { seconds: '31' }),
        ]);

        // Only the lines with data: a stall alone shows one line, and no "see them" link (nothing timed out).
        push(liveRun({ hostLag: { maxMs: 4_000, p99Ms: 1, meanMs: 1 } }));
        expect(within(screen.getByTestId('kg-review-where')).getAllByRole('listitem')).toHaveLength(1);
        expect(screen.queryByTestId('kg-see-failures')).toBeNull();
    });

    it('under where the time goes, "see them" and "slowest files" open the run in the Runs tab', async () => {
        const run = liveRun({ failures: [{ path: 'a.ts', phase: 'extract', reason: 'request timed out' }], steps: [{ path: 'a.ts', phase: 'extract', ms: 60_000, outcome: 'failed', reason: 'request timed out' }] });
        const { port, push } = portOf({ get: vi.fn(async () => run) });
        render(<Harness port={port} review={machine({ status: 'running' })} />);
        push(run);
        fireEvent.click(screen.getByTestId('kg-see-failures'));
        expect(port.get).toHaveBeenCalledWith('run-live');
        expect(tab(r.tabRuns).getAttribute('aria-selected')).toBe('true');
        expect(await screen.findByTestId('kg-run-detail')).toBeTruthy();
    });

    it('names the files being read (three at most, then a count that opens every step)', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine({ status: 'running' })} />);
        const lane = (id: number) => ({ phase: 'extract' as const, id, path: `src/f${id}.ts`, done: 1, busyMs: 10 });
        push(liveRun({ lanes: [0, 1, 2, 3, 4].map(lane) }));
        expect(within(screen.getByTestId('kg-review-reading')).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.queryByTestId('kg-run-steps')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(r.moreEvery, { count: 2 }) }));
        expect(screen.getByTestId('kg-run-steps')).toBeTruthy(); // the step feed (its heading is the count of steps)
    });

    it('stopping: the card says what is happening and how long it has waited since Stop was pressed, and after 10 s that the host has not confirmed', () => {
        vi.useFakeTimers();
        const stoppedAt = Date.now();
        render(<Harness port={portOf().port} review={machine({ status: 'stopping', stoppedAt, progress: { phase: 'extract', done: 5, total: 10 } })} />);
        const card = screen.getByTestId('kg-review-stopping');
        expect(card.textContent).toContain(r.stoppingBody);
        expect(card.textContent).toContain(fillTemplate(r.stoppingWait, { seconds: 0 }));
        expect(screen.queryByText(r.stoppingStuck)).toBeNull();
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(screen.getByText(r.stoppingStuck)).toBeTruthy();
        expect(screen.getByTestId('kg-review-stopping').textContent).toContain(fillTemplate(r.stoppingWait, { seconds: 10 }));
    });

    it('stopped: says where it stopped and what is left', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine({ status: 'aborted' })} />);
        push(liveRun({ endedAt: RUN_AT + 10_000, updatedAt: RUN_AT + 10_000, outcome: 'stopped' }));
        expect(screen.getByTestId('kg-review-stopped').textContent).toContain(fillTemplate(r.stoppedTitle, { pct: 60 }));
    });

    it('a finished review shows its summary; a failed one its reason', () => {
        render(<Harness port={portOf().port} review={machine({ status: 'done', rootId: 'docs', report: { extracted: 2, judged: 4, factsWritten: 3, unjudged: 0 } as never })} />);
        expect(screen.getByTestId('kg-review-done').textContent).toContain(L.reviewDoneTitle);
        cleanup();
        render(<Harness port={portOf().port} review={machine({ status: 'error', message: 'disk full', at: '2026-10-30T12:00:00.000Z' })} />);
        expect(screen.getByText('Reason: disk full')).toBeTruthy();
    });
});
