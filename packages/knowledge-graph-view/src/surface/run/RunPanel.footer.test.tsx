// @vitest-environment jsdom
/** The pinned footer: ONE button that follows the state, the same on every tab, and its note. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { FIXTURE_PLAN } from '../../testing';
import type { ReviewRun as ReviewMachine } from '../../useReviewRun';
import { liveRun, RUN_AT } from './runFixture';
import { createKit, r } from './runPanelKit';

const { machine, portOf, Harness, tab, footer } = createKit({ fn: vi.fn as never, act, screen });

afterEach(cleanup);

describe('the pinned footer: one button that follows the state', () => {
    it.each<[string, ReviewMachine['state'], string, boolean]>([
        ['nothing planned', { status: 'idle' }, r.actionStart, false],
        ['counting', { status: 'planning' }, r.actionStart, true],
        ['the plan', { status: 'confirm', plan: { ...FIXTURE_PLAN } }, r.actionStart, false],
        ['running', { status: 'running' }, L.reviewStop, false],
        ['stopping', { status: 'stopping', stoppedAt: Date.now() }, r.stoppingTitle, true],
        ['stopped', { status: 'aborted' }, r.actionResume, false],
        ['finished', { status: 'done', rootId: 'docs', report: { unjudged: 0 } as never }, r.actionAgain, false],
        ['failed', { status: 'error', message: 'x', at: '2026-10-30T12:00:00.000Z' }, r.actionAgain, false],
    ])('%s', (_name, state, label, disabled) => {
        render(<Harness port={portOf().port} review={machine(state)} />);
        expect(footer().textContent).toBe(label);
        expect(footer().disabled).toBe(disabled);
    });

    it('is the same button on every tab, and Stop stops the review through its state machine', () => {
        const review = machine({ status: 'running' });
        render(<Harness port={portOf().port} review={review} />);
        for (const name of [r.tabRuns, r.tabServer, r.tabDiagnostics, r.tabReview]) {
            fireEvent.click(tab(name));
            expect(footer().textContent).toBe(L.reviewStop);
        }
        fireEvent.click(footer());
        expect(review.stop).toHaveBeenCalled();
    });

    it('adds Copy diagnostics beside the button on the Server tab only', () => {
        render(<Harness port={portOf().port} review={machine({ status: 'idle' })} />);
        expect(screen.queryByRole('button', { name: L.copyDiagnostics })).toBeNull();
        fireEvent.click(tab(r.tabServer));
        expect(screen.getByTestId('kg-reviews-footer').contains(screen.getByRole('button', { name: L.copyDiagnostics }))).toBe(true);
    });

    it('with nothing planned, Start counts the files and starts in one press', () => {
        const review = machine({ status: 'cancelled' });
        render(<Harness port={portOf().port} review={review} />);
        fireEvent.click(footer());
        expect(review.start).toHaveBeenLastCalledWith({ rootId: 'docs' }, { autoConfirm: true });
    });

    it('says closing does not stop a running review, and that nothing is spent before Start', () => {
        render(<Harness port={portOf().port} review={machine({ status: 'running' })} />);
        expect(screen.getByTestId('kg-footer-note').textContent).toBe(r.noteRunning);
        cleanup();
        render(<Harness port={portOf().port} review={machine({ status: 'confirm', plan: { ...FIXTURE_PLAN } })} />);
        expect(screen.getByTestId('kg-footer-note').textContent).toBe(r.noteIdle);
    });

    it('stopped: Resume says what is left and starts a plan that is confirmed by itself', () => {
        const { port, push } = portOf();
        const review = machine({ status: 'aborted' });
        render(<Harness port={port} review={review} />);
        push(liveRun({ endedAt: RUN_AT + 10_000, updatedAt: RUN_AT + 10_000, outcome: 'stopped' }));
        expect(footer().textContent).toBe(r.resume.replace('{left}', '4'));
        expect(screen.getByTestId('kg-footer-note').textContent).toContain('4 files still to review');
        fireEvent.click(footer());
        expect(review.start).toHaveBeenCalledWith({ rootId: 'docs' }, { autoConfirm: true });
    });

    it('a review the host runs on its own is stopped by its run id, and the footer then waits ("Stopping…", disabled)', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine({ status: 'idle' })} />);
        push(liveRun());
        expect(footer().textContent).toBe(L.reviewStop);
        fireEvent.click(footer());
        expect(port.stop).toHaveBeenCalledWith('run-live');
        expect(footer().textContent).toBe(r.stoppingTitle);
        expect(footer().disabled).toBe(true);
    });
});
