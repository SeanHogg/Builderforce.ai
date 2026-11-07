// @vitest-environment jsdom
/** The review as a run you can watch (PRD 41 A8): Review opens the Run drawer; the sync pill and the review card's Details reopen it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { FIXTURE_PLAN, docsFixture, fixtureSource, openList } from './testing';
import { pressMore } from './testMenu';
import { liveRun } from './surface/run/runFixture';
import type { KnowledgeReviewEvent, ReviewControl, ReviewRunsPort, StoredReviewRun } from './types';

vi.mock('./scene/GraphScene', () => ({ default: () => null }));

afterEach(cleanup);

/** A review that plans, waits for Confirm, reports one progress and then waits for Stop. */
function runSource(withRuns = true) {
    const listeners = new Set<(run: StoredReviewRun) => void>();
    const runs: ReviewRunsPort = {
        subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        stop: vi.fn(async () => undefined),
    };
    const review = (_req: unknown, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> => (async function* () {
        const plan = { ...FIXTURE_PLAN };
        yield { type: 'plan', plan };
        if (!(await ctl.confirm(plan))) { yield { type: 'cancelled' }; return; }
        yield { type: 'progress', progress: { phase: 'extract', done: 1, total: 4, path: 'lease.md' } };
        await new Promise<void>((resolve) => ctl.signal.addEventListener('abort', () => resolve()));
    })();
    const source = Object.assign(fixtureSource([docsFixture()]), { review }, withRuns ? { runs } : {});
    return { source, push: (run: StoredReviewRun) => act(() => listeners.forEach((l) => l(run))) };
}

const drawer = () => screen.queryByRole('dialog', { name: L.panelRun });
const pill = () => screen.findByRole('button', { name: /^Reviewing/ });

async function mount(source: ReturnType<typeof runSource>['source']) {
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} /></div>);
    await openList({ screen, fireEvent });
}

/** Review → Confirm: the drawer is open (it opened with the review) and the review is running. */
async function reviewRunning(source: ReturnType<typeof runSource>['source']) {
    await mount(source);
    await pressMore({ screen, fireEvent }, L.reviewFolder);
    fireEvent.click(await screen.findByRole('button', { name: L.reviewConfirm }));
    await pill();
}

describe('the Run drawer from the review controls', () => {
    it('opens when the run starts after the plan is confirmed, never over the confirm card, as a slide-out and not a modal', async () => {
        const { source } = runSource();
        await mount(source);
        expect(drawer()).toBeNull();

        await pressMore({ screen, fireEvent }, L.reviewFolder);
        const confirm = await screen.findByRole('button', { name: L.reviewConfirm });
        expect(drawer()).toBeNull();

        fireEvent.click(confirm);
        const open = await screen.findByRole('dialog', { name: L.panelRun });
        expect(open.getAttribute('aria-modal')).toBe('false');
    });

    it('opens on Re-review this folder too, once it is confirmed', async () => {
        const { source } = runSource();
        await mount(source);
        await pressMore({ screen, fireEvent }, L.surface.header.reReview);
        fireEvent.click(await screen.findByRole('button', { name: L.reviewConfirm }));
        expect(await screen.findByRole('dialog', { name: L.panelRun })).toBeTruthy();
    });

    it('does not open when the plan is cancelled', async () => {
        const { source } = runSource();
        await mount(source);
        await pressMore({ screen, fireEvent }, L.reviewFolder);
        fireEvent.click(await screen.findByRole('button', { name: L.reviewCancel }));
        await screen.findByText(L.reviewCancelled);
        expect(drawer()).toBeNull();
    });

    it('shows the run the host reports, as soon as the plan is confirmed', async () => {
        const { source, push } = runSource();
        await reviewRunning(source);
        push(liveRun());
        // Another folder\'s run is not this panel\'s.
        push(liveRun({ id: 'run-elsewhere', root: 'elsewhere' }));
        push(liveRun());
        const open = await screen.findByRole('dialog', { name: L.panelRun });
        expect(within(open).getByTestId('kg-run-timeline')).toBeTruthy();
        expect(within(open).getByTestId('kg-run-lanes')).toBeTruthy();
    });

    it("is reopened by the sync pill while reviewing", async () => {
        const { source } = runSource();
        await reviewRunning(source);
        fireEvent.click(within(await screen.findByRole('dialog', { name: L.panelRun })).getByRole('button', { name: L.close }));
        await waitFor(() => expect(drawer()).toBeNull());

        fireEvent.click(await pill());
        expect(await screen.findByRole('dialog', { name: L.panelRun })).toBeTruthy();
    });

    it("is reopened by the review card's Details", async () => {
        const { source } = runSource();
        await reviewRunning(source);
        fireEvent.click(within(await screen.findByRole('dialog', { name: L.panelRun })).getByRole('button', { name: L.close }));
        await waitFor(() => expect(drawer()).toBeNull());

        fireEvent.click(await screen.findByRole('button', { name: L.surface.run.details }));
        expect(await screen.findByRole('dialog', { name: L.panelRun })).toBeTruthy();
    });

    it('changes nothing for a host that records no runs: no drawer, no Details', async () => {
        const { source } = runSource(false);
        await reviewRunning(source);
        expect(drawer()).toBeNull();
        expect(screen.queryByRole('button', { name: L.surface.run.details })).toBeNull();
    });
});
