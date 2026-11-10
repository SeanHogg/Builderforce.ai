// @vitest-environment jsdom
/** The Reviews panel from the view (PRD 41 A8): the review action's button and chip (ask-bar row) open it; it counts nothing until Start review; closing it cancels a plan but never stops a run. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { FIXTURE_PLAN, docsFixture, fixtureSource, openList } from './testing';
import { openReviews } from './testReviews';
import { liveRun } from './surface/run/runFixture';
import type { KnowledgeReviewEvent, ReviewControl, ReviewRunsPort, StoredReviewRun } from './types';


afterEach(cleanup);

/** A review that plans, waits for the answer, reports one progress and then waits for Stop. */
function runSource(withRuns = true, graphs = [docsFixture()]) {
    const listeners = new Set<(run: StoredReviewRun) => void>();
    const runs: ReviewRunsPort = {
        subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        stop: vi.fn(async () => undefined),
    };
    const answers: boolean[] = [];
    const review = (_req: unknown, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> => (async function* () {
        const plan = { ...FIXTURE_PLAN };
        yield { type: 'plan', plan };
        const ok = await ctl.confirm(plan);
        answers.push(ok);
        if (!ok) { yield { type: 'cancelled' }; return; }
        yield { type: 'progress', progress: { phase: 'extract', done: 1, total: 4, path: 'lease.md' } };
        await new Promise<void>((resolve) => ctl.signal.addEventListener('abort', () => resolve()));
    })();
    const source = Object.assign(fixtureSource(graphs), { review }, withRuns ? { runs } : {});
    return { source, answers, push: (run: StoredReviewRun) => act(() => listeners.forEach((l) => l(run))) };
}

// The panel is titled by the folder's name.
const drawer = () => screen.queryByRole('dialog', { name: 'docs' });
const chip = () => screen.getByTestId('kg-status-chip');

async function mount(source: ReturnType<typeof runSource>['source']) {
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} /></div>);
    await openList({ screen, fireEvent });
}

/** The review action's button → nothing planned → Start review counts and starts in one press: the review is running. */
async function reviewRunning(source: ReturnType<typeof runSource>['source']) {
    await mount(source);
    await openReviews({ screen, fireEvent });
    await screen.findByTestId('kg-review-idle');
    fireEvent.click(screen.getByTestId('kg-footer-action'));
    await waitFor(() => expect(chip().getAttribute('data-kind')).toBe('running'));
}

describe('the Reviews panel from the strip', () => {
    it('opens from the action button as a slide-out and not a modal, and counts nothing until Start review', async () => {
        const { source, answers } = runSource();
        await mount(source);
        expect(drawer()).toBeNull();

        await openReviews({ screen, fireEvent });
        const open = await screen.findByRole('dialog', { name: 'docs' });
        expect(open.getAttribute('aria-modal')).toBe('false');
        // Opening does not plan (RunPanel.tsx): planning walks and hashes every file, which opening the panel did not ask for.
        expect(await within(open).findByTestId('kg-review-idle')).toBeTruthy();
        expect(within(open).queryByTestId('kg-review-planning')).toBeNull();
        expect(answers).toEqual([]);
    });

    it('cancels the plan when the panel is closed on it, and writes nothing', async () => {
        // A plan the person reads first comes from Review a folder (the panel opens by itself on it); the panel's own Start counts and starts in one press.
        const { source, answers } = runSource(true, []);
        render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} /></div>);
        fireEvent.click(await screen.findByRole('button', { name: L.reviewFolder }));
        await screen.findByTestId('kg-review-start');
        const open = screen.getByRole('dialog');
        fireEvent.click(within(open).getByRole('button', { name: L.close }));
        await waitFor(() => expect(answers).toEqual([false]));
        expect(open.isConnected).toBe(false);
    });

    it('shows the run the host reports, and only this folder\'s', async () => {
        const { source, push } = runSource();
        await reviewRunning(source);
        push(liveRun());
        push(liveRun({ id: 'run-elsewhere', root: 'elsewhere' }));
        push(liveRun());
        const open = await screen.findByRole('dialog', { name: 'docs' });
        expect(within(open).getByTestId('kg-review-steps')).toBeTruthy();
    });

    it('does not stop a running review when it is closed, and the chip reopens it', async () => {
        const { source } = runSource();
        await reviewRunning(source);
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'docs' })).getByRole('button', { name: L.close }));
        await waitFor(() => expect(drawer()).toBeNull());
        expect(chip().getAttribute('data-kind')).toBe('running');

        fireEvent.click(chip());
        expect(await screen.findByRole('dialog', { name: 'docs' })).toBeTruthy();
    });

    it('works for a host that reviews but records no runs: the panel opens and the review runs', async () => {
        const { source } = runSource(false);
        await reviewRunning(source);
        expect(drawer()).not.toBeNull();
    });
});
