// @vitest-environment jsdom
/** Stop and Force stop, against the REAL review state machine: a host that never confirms the stop leaves the view "stopping" until Force stop lets go of it (and Resume is offered). */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { ABORT_GRACE_MS, STUCK_AFTER_MS } from '../../reviewTimings';
import { FIXTURE_PLAN, docsFixture, fixtureSource } from '../../testing';
import type { KnowledgeGraphSource, KnowledgeReviewEvent, ReviewControl } from '../../types';
import { useReviewRun } from '../../useReviewRun';
import type { PanelProps } from '../registry';
import { liveRun } from './runFixture';
import { createKit, diagnosticsOf, r } from './runPanelKit';
import { RunPanel } from './RunPanel';
import { useReviewRunRecord } from './useReviewRunRecord';
import { useReviewsTab } from './useReviewsTab';

const { machine, portOf, Harness, footer } = createKit({ fn: vi.fn as never, act, screen });

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** A host that plans, runs, and never answers Stop: its stream hangs for ever, whatever the signal says. */
function hangingSource(): KnowledgeGraphSource {
    const review = (_req: unknown, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> => (async function* () {
        const plan = { ...FIXTURE_PLAN };
        yield { type: 'plan', plan };
        if (!(await ctl.confirm(plan))) { yield { type: 'cancelled' }; return; }
        yield { type: 'progress', progress: { phase: 'extract', done: 1, total: 4, path: 'lease.md' } };
        await new Promise<never>(() => undefined);
    })();
    const runs = { subscribe: () => () => undefined, list: async () => [], get: async () => null, stop: vi.fn(async () => undefined) };
    return Object.assign(fixtureSource([docsFixture()]), { review, runs });
}

function App({ source }: { source: KnowledgeGraphSource }) {
    const review = useReviewRun(source, () => undefined);
    const read = useReviewRunRecord(source, 'docs', true);
    const reviews = useReviewsTab('docs');
    return <RunPanel {...({ labels: L, source, rootId: 'docs', rootTitle: 'Docs', runs: { read, review }, reviews, sync: null, diagnostics: diagnosticsOf(), surface: { openPanel: vi.fn() } } as unknown as PanelProps)} />;
}

describe('the two waits of Stop', () => {
    it('offer Force stop well before the grace runs out, from one module', () => {
        expect(STUCK_AFTER_MS).toBe(10_000);
        expect(STUCK_AFTER_MS).toBeLessThan(ABORT_GRACE_MS / 2);
    });
});

describe('Stop, then Force stop, on the real state machine', () => {
    it('stays "stopping" while the host is silent; after the threshold Force stop lets go: the view is stopped and offers Resume', async () => {
        const source = hangingSource();
        render(<App source={source} />);
        // Nothing is planned on open: the footer's Start review counts and starts in one press.
        await screen.findByTestId('kg-review-idle');
        fireEvent.click(footer());
        await waitFor(() => expect(footer().textContent).toBe(L.reviewStop));

        vi.useFakeTimers();
        fireEvent.click(footer()); // Stop
        expect(footer().textContent).toBe(r.stoppingTitle);
        expect(footer().disabled).toBe(true);
        expect(screen.getByTestId('kg-review-stopping')).toBeTruthy();

        act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS - 1000); });
        expect(footer().textContent).toBe(r.stoppingTitle); // not yet
        act(() => { vi.advanceTimersByTime(1000); });
        expect(footer().textContent).toBe(r.forceStop);
        expect(footer().disabled).toBe(false);

        fireEvent.click(footer()); // Force stop
        expect(screen.queryByTestId('kg-review-stopping')).toBeNull();
        expect(screen.getByTestId('kg-review-stopped')).toBeTruthy();
        expect(footer().textContent).toBe(r.actionResume);
        // The stream is let go: the hung host cannot move the state again.
        act(() => { vi.advanceTimersByTime(ABORT_GRACE_MS * 2); });
        expect(footer().textContent).toBe(r.actionResume);
    });
});

describe('Stop on a review the host runs on its own', () => {
    it('shows "Stopping…" at once, then Force stop after the same threshold, asking the host by run id again', () => {
        vi.useFakeTimers();
        const { port, push } = portOf();
        render(<Harness port={port} review={machine({ status: 'idle' })} />);
        push(liveRun());
        fireEvent.click(footer());
        expect(port.stop).toHaveBeenCalledWith('run-live');
        expect(footer().textContent).toBe(r.stoppingTitle);
        expect(screen.getByTestId('kg-review-stopping')).toBeTruthy();

        act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS); });
        expect(footer().textContent).toBe(r.forceStop);
        fireEvent.click(footer());
        expect(port.stop).toHaveBeenCalledTimes(2);
    });
});
