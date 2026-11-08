// @vitest-environment jsdom
/** The review state machine: a failed review keeps its detail, Stop lands in two steps, Resume's plan is answered by itself, and Everything again keeps its force. */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ReviewFailure } from './reviewFailure';
import { FIXTURE_PLAN, FIXTURE_REPORT, docsFixture, fixtureSource } from './testing';
import type { KnowledgeGraphSource, KnowledgeReviewEvent, ReviewRequest } from './types';
import { useReviewRun, type ReviewErrorState } from './useReviewRun';

const base = () => fixtureSource([docsFixture()]);

describe('useReviewRun on a failed review', () => {
    it('keeps the last phase, the root and the thrown failure detail in the error state', async () => {
        const source: KnowledgeGraphSource = {
            ...base(),
            review: () => (async function* (): AsyncGenerator<KnowledgeReviewEvent> {
                yield { type: 'progress', progress: { phase: 'extract', done: 1, total: 3, path: 'a.md' } };
                yield { type: 'progress', progress: { phase: 'judge', done: 2, total: 3, path: 'b.md' } };
                throw new ReviewFailure('model refused', { detail: 'Error: model refused\n    at judge', host: 'BuilderForce for VS Code 1.2.3', rootPath: '/work/docs' });
            })(),
        };
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({ rootId: 'vscode:ws' }));
        await waitFor(() => expect(result.current.state.status).toBe('error'));
        expect(result.current.state).toMatchObject({
            status: 'error', message: 'model refused', rootId: 'vscode:ws', lastPhase: 'judge',
            detail: 'Error: model refused\n    at judge', host: 'BuilderForce for VS Code 1.2.3', rootPath: '/work/docs',
        });
        expect((result.current.state as ReviewErrorState).at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('has no phase when it failed before any progress, and uses the error stack as the detail', async () => {
        const source: KnowledgeGraphSource = { ...base(), review: () => (async function* (): AsyncGenerator<KnowledgeReviewEvent> { throw new Error('no folder'); })() };
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({}));
        await waitFor(() => expect(result.current.state.status).toBe('error'));
        const state = result.current.state as ReviewErrorState;
        expect(state.lastPhase).toBeUndefined();
        expect(state.message).toBe('no folder');
        expect(state.detail).toContain('no folder');
    });
});

describe('Stop', () => {
    const slow = (finalEvent: boolean) => {
        let finish!: () => void;
        const over = new Promise<void>((r) => { finish = r; });
        const source: KnowledgeGraphSource = {
            ...base(),
            review: () => (async function* (): AsyncGenerator<KnowledgeReviewEvent> {
                yield { type: 'progress', progress: { phase: 'extract', done: 1, total: 3, path: 'a.md' } };
                await over;
                if (finalEvent) yield { type: 'done', rootId: 'r', report: { aborted: true } as never };
            })(),
        };
        return { source, finish };
    };

    it('goes to stopping at once, and lands aborted only when the host reports the run over', async () => {
        const { source, finish } = slow(true);
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({}));
        await waitFor(() => expect(result.current.state.status).toBe('running'));
        act(() => result.current.stop());
        expect(result.current.state.status).toBe('stopping');
        finish();
        await waitFor(() => expect(result.current.state.status).toBe('aborted'));
    });

    it('lands aborted when the stream ends with no terminal event after Stop', async () => {
        const { source, finish } = slow(false);
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({}));
        await waitFor(() => expect(result.current.state.status).toBe('running'));
        act(() => result.current.stop());
        expect(result.current.state.status).toBe('stopping');
        finish();
        await waitFor(() => expect(result.current.state.status).toBe('aborted'));
    });
});

/** A review that plans, waits for the answer and finishes, recording what it was asked and answered. */
function planning() {
    const requests: ReviewRequest[] = [];
    const answers: boolean[] = [];
    const source: KnowledgeGraphSource = {
        ...base(),
        review: (req, ctl) => {
            requests.push(req);
            return (async function* (): AsyncGenerator<KnowledgeReviewEvent> {
                const plan = { ...FIXTURE_PLAN, judgeFiles: 7 };
                yield { type: 'plan', plan };
                const ok = await ctl.confirm(plan);
                answers.push(ok);
                if (!ok) { yield { type: 'cancelled' }; return; }
                yield { type: 'done', rootId: plan.rootId, report: FIXTURE_REPORT };
            })();
        },
    };
    return { source, requests, answers };
}

describe('start with autoConfirm (Resume)', () => {
    it('answers the plan yes as soon as it lands: no confirm state is shown, and the review runs to its end', async () => {
        const { source, answers } = planning();
        const seen: string[] = [];
        const { result } = renderHook(() => { const run = useReviewRun(source, () => undefined); seen.push(run.state.status); return run; });
        act(() => result.current.start({ rootId: 'docs' }, { autoConfirm: true }));
        await waitFor(() => expect(result.current.state.status).toBe('done'));
        expect(answers).toEqual([true]);
        expect(seen).not.toContain('confirm');
    });

    it('still waits for the person without autoConfirm', async () => {
        const { source, answers } = planning();
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({ rootId: 'docs' }));
        await waitFor(() => expect(result.current.state.status).toBe('confirm'));
        expect(answers).toEqual([]);
        act(() => result.current.answer(true));
        await waitFor(() => expect(result.current.state.status).toBe('done'));
        expect(answers).toEqual([true]);
    });
});

describe('Everything again', () => {
    it('re-plans with force and keeps the force on the confirm state; a plain plan carries none', async () => {
        const { source, requests } = planning();
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({ rootId: 'docs' }));
        await waitFor(() => expect(result.current.state.status).toBe('confirm'));
        expect(result.current.state).not.toHaveProperty('force');

        act(() => result.current.rereviewAll());
        expect(result.current.state.status).toBe('planning');
        await waitFor(() => expect(result.current.state.status).toBe('confirm'));
        expect(result.current.state).toMatchObject({ status: 'confirm', force: true });
        expect(requests.at(-1)).toEqual({ rootId: 'docs', force: true });

        act(() => result.current.start({ rootId: 'docs' }));
        await waitFor(() => expect(result.current.state).toMatchObject({ status: 'confirm' }));
        expect(result.current.state).not.toHaveProperty('force');
    });

    it('remembers the plan\'s judge budget for the running view', async () => {
        const { source } = planning();
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({ rootId: 'docs' }));
        await waitFor(() => expect(result.current.state.status).toBe('confirm'));
        expect(result.current.judgeFiles).toBe(7);
    });
});

describe('Force stop', () => {
    /** A host that never answers Stop: its stream hangs, then (much later) reports the run done. */
    function silentHost() {
        let late!: () => void;
        const later = new Promise<void>((r) => { late = r; });
        const source: KnowledgeGraphSource = {
            ...base(),
            review: () => (async function* (): AsyncGenerator<KnowledgeReviewEvent> {
                yield { type: 'progress', progress: { phase: 'extract', done: 1, total: 3, path: 'a.md' } };
                await later;
                yield { type: 'progress', progress: { phase: 'extract', done: 2, total: 3, path: 'b.md' } };
                yield { type: 'done', rootId: 'r', report: FIXTURE_REPORT };
            })(),
        };
        return { source, late };
    }

    it('records when Stop was pressed, stays "stopping" while the host is silent, and Force stop lets go at once', async () => {
        const { source } = silentHost();
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({}));
        await waitFor(() => expect(result.current.state.status).toBe('running'));
        const before = Date.now();
        act(() => result.current.stop());
        expect(result.current.state).toMatchObject({ status: 'stopping' });
        expect((result.current.state as { stoppedAt: number }).stoppedAt).toBeGreaterThanOrEqual(before);

        act(() => result.current.forceStop());
        expect(result.current.state.status).toBe('aborted');
    });

    it('detaches the stream: what the host says afterwards cannot move the state or fire onDone', async () => {
        const { source, late } = silentHost();
        const onDone = vi.fn();
        const { result } = renderHook(() => useReviewRun(source, onDone));
        act(() => result.current.start({}));
        await waitFor(() => expect(result.current.state.status).toBe('running'));
        act(() => result.current.stop());
        act(() => result.current.forceStop());
        late();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(result.current.state.status).toBe('aborted');
        expect(onDone).not.toHaveBeenCalled();
    });
});
