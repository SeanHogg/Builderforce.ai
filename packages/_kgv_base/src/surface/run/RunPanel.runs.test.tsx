// @vitest-environment jsdom
/** The Runs tab: pace bars and past runs, a run's detail with Back, failures grouped by reason (Retry on timeouts, Stop's leftovers read as cancelled). */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { groupFailures, STOPPED_REASON } from './FailuresByReason';
import { finishedRun, RUN_AT, summaryOf } from './runFixture';
import { createKit, r } from './runPanelKit';

const { machine, portOf, Harness, tab } = createKit({ fn: vi.fn as never, act, screen });

afterEach(cleanup);

describe('the Runs tab', () => {
    const history = () => portOf({ list: vi.fn(async () => [summaryOf(finishedRun())]), get: vi.fn(async () => finishedRun()) });

    it('lists the past runs with their read of plan, rate and failures; a row opens the run\'s detail with Back', async () => {
        const { port } = history();
        render(<Harness port={port} review={machine({ status: 'idle' })} />);
        fireEvent.click(tab(r.tabRuns));
        const list = await screen.findByTestId('kg-run-history');
        const row = within(list).getByRole('button');
        expect(row.textContent).toContain(fillTemplate(r.rowRead, { read: '10', total: '10' }));
        expect(row.textContent).toContain(fillTemplate(r.rowFailures, { count: 2 }));
        fireEvent.click(row);
        const detail = await screen.findByTestId('kg-run-detail');
        expect(within(detail).getByTestId('kg-run-axis')).toBeTruthy();
        expect(within(detail).getByText(r.paceTitle)).toBeTruthy();
        expect(within(detail).getByTestId('kg-run-slowest')).toBeTruthy();
        expect(within(detail).getByTestId('kg-run-left').textContent).toContain(fillTemplate(r.leftUpload, { count: 3 }));
        // No Copy diagnostics here: a quiet link goes to the Diagnostics tab, where the one button is.
        expect(within(detail).queryByRole('button', { name: /copy diagnostics/i })).toBeNull();
        fireEvent.click(within(detail).getByTestId('kg-run-diagnostics'));
        expect(tab(r.tabDiagnostics).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(tab(r.tabRuns));
        fireEvent.click(within(await screen.findByTestId('kg-run-detail')).getByRole('button', { name: new RegExp(r.back) }));
        expect(await screen.findByTestId('kg-run-history')).toBeTruthy();
    });

    it('groups a run\'s failures by reason and offers Retry on the timeout group, starting a normal review of those files', async () => {
        const { port } = history();
        const review = machine({ status: 'idle' });
        render(<Harness port={port} review={review} />);
        fireEvent.click(tab(r.tabRuns));
        fireEvent.click(within(await screen.findByTestId('kg-run-history')).getByRole('button'));
        const groups = await screen.findByTestId('kg-run-failure-groups');
        expect(within(groups).getAllByRole('listitem').map((li) => li.dataset.reason).sort()).toEqual(['other', 'timeout']);
        fireEvent.click(within(groups).getByRole('button', { name: new RegExp(L.surface.run.retry) }));
        expect(review.start).toHaveBeenCalledWith({ rootId: 'docs', retry: ['src/slow.ts'] });
    });

    it('says so when a past run is no longer held', async () => {
        const { port } = portOf({ list: vi.fn(async () => [summaryOf(finishedRun())]), get: vi.fn(async () => null) });
        render(<Harness port={port} review={machine({ status: 'idle' })} />);
        fireEvent.click(tab(r.tabRuns));
        fireEvent.click(within(await screen.findByTestId('kg-run-history')).getByRole('button'));
        expect(await screen.findByText(L.surface.run.runUnavailable)).toBeTruthy();
    });

    it('draws a pace bar per run, scaled to the fastest', async () => {
        const fast = finishedRun({ id: 'fast', phases: [{ phase: 'extract', startedAt: RUN_AT, endedAt: RUN_AT + 10_000, done: 100, total: 100 }] });
        const slow = finishedRun({ id: 'slow', phases: [{ phase: 'extract', startedAt: RUN_AT, endedAt: RUN_AT + 20_000, done: 100, total: 100 }] });
        const { port } = portOf({ list: vi.fn(async () => [summaryOf(fast), summaryOf(slow)]) });
        render(<Harness port={port} review={machine({ status: 'idle' })} />);
        fireEvent.click(tab(r.tabRuns));
        const bars = await screen.findByTestId('kg-run-pace');
        expect(within(bars).getAllByRole('meter').map((m) => m.getAttribute('aria-valuenow'))).toEqual(['100', '50']);
    });
});

describe('groupFailures', () => {
    it('counts each reason, largest first, and reads Stop\'s own leftovers as cancelled, not as errors', () => {
        const groups = groupFailures([
            { path: 'a', phase: 'extract', reason: STOPPED_REASON }, { path: 'b', phase: 'extract', reason: STOPPED_REASON }, { path: 'c', phase: 'extract', reason: 'request timed out' },
        ]);
        expect(groups.map((g) => [g.id, g.count])).toEqual([['cancelled', 2], ['timeout', 1]]);
    });

    it('shows the cancelled group in words in the detail', async () => {
        const stopped = finishedRun({ failures: [{ path: 'a', phase: 'extract', reason: STOPPED_REASON }] });
        const { port } = portOf({ list: vi.fn(async () => [summaryOf(stopped)]), get: vi.fn(async () => stopped) });
        render(<Harness port={port} review={machine({ status: 'idle' })} />);
        fireEvent.click(tab(r.tabRuns));
        fireEvent.click(within(await screen.findByTestId('kg-run-history')).getByRole('button'));
        expect(within(await screen.findByTestId('kg-run-failure-groups')).getByText(r.cancelledByStop)).toBeTruthy();
    });
});
