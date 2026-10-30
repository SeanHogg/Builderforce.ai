// @vitest-environment jsdom
/** A failed review (PRD 38 §4.3): the reason under the sentence, and Copy details for a report. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ReviewProgress } from './ReviewProgress';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { ReviewFailure } from './reviewFailure';
import { useReviewRun, type ReviewErrorState, type ReviewRun } from './useReviewRun';
import { docsFixture, fixtureSource } from './testing';
import type { KnowledgeGraphSource, KnowledgeReviewEvent } from './types';

function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

const ERROR: ReviewErrorState = {
    status: 'error',
    message: 'disk full',
    at: '2026-10-30T12:00:00.000Z',
    rootId: 'vscode:ws',
    rootPath: '/work/docs',
    lastPhase: 'judge',
    detail: 'Error: disk full\n    at write (store.ts:1)',
    host: 'BuilderForce for VS Code 1.2.3',
};

const runWith = (state: ReviewRun['state']): ReviewRun => ({
    state, available: true, start: vi.fn(), answer: vi.fn(), rereviewAll: vi.fn(), stop: vi.fn(), dismiss: vi.fn(),
});

const show = (state: ReviewRun['state']) =>
    render(<ReviewProgress run={runWith(state)} labels={L} titleOf={(id) => id} onContinue={() => undefined} />);

describe('a failed review', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shows the sentence, the reason and a Copy details button', () => {
        show(ERROR);
        expect(screen.getByText(L.reviewFailed)).toBeTruthy();
        expect(screen.getByText('Reason: disk full')).toBeTruthy();
        expect(screen.getByRole('button', { name: L.reviewCopyDetails })).toBeTruthy();
    });

    it('copies a diagnostics block with the status, root, phase, message, detail, host and time', async () => {
        const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
        stubClipboard(writeText);
        show(ERROR);
        fireEvent.click(screen.getByRole('button', { name: L.reviewCopyDetails }));
        expect(await screen.findByText(L.copied)).toBeTruthy();
        const text = writeText.mock.calls[0]![0];
        expect(text).toContain('status: error');
        expect(text).toContain('root: vscode:ws');
        expect(text).toContain('path: /work/docs');
        expect(text).toContain('phase: judge');
        expect(text).toContain('message: disk full');
        expect(text).toContain('at write (store.ts:1)');
        expect(text).toContain('host: BuilderForce for VS Code 1.2.3');
        expect(text).toContain('time: 2026-10-30T12:00:00.000Z');
    });

    it('lists only what is known', async () => {
        const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
        stubClipboard(writeText);
        show({ status: 'error', message: 'boom', at: '2026-10-30T12:00:00.000Z' });
        fireEvent.click(screen.getByRole('button', { name: L.reviewCopyDetails }));
        await screen.findByText(L.copied);
        const text = writeText.mock.calls[0]![0];
        expect(text).toContain('message: boom');
        expect(text).not.toContain('phase:');
        expect(text).not.toContain('host:');
        expect(text).not.toContain('detail:');
    });

    it('falls back to selectable text when the clipboard refuses', async () => {
        stubClipboard(async () => { throw new Error('denied'); });
        show(ERROR);
        fireEvent.click(screen.getByRole('button', { name: L.reviewCopyDetails }));
        expect(await screen.findByText(L.copyFailed)).toBeTruthy();
        const box = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(box.value).toContain('message: disk full');
        expect(box.value).toContain('phase: judge');
    });

    it('leaves the cancelled and aborted sentences as they were, with no copy button', () => {
        const { unmount } = show({ status: 'cancelled' });
        expect(screen.getByText(L.reviewCancelled)).toBeTruthy();
        expect(screen.queryByRole('button', { name: L.reviewCopyDetails })).toBeNull();
        unmount();
        show({ status: 'aborted' });
        expect(screen.getByText(L.reviewAborted)).toBeTruthy();
        expect(screen.queryByRole('button', { name: L.reviewCopyDetails })).toBeNull();
    });
});

describe('useReviewRun on a failed review', () => {
    it('keeps the last phase, the root and the thrown failure detail in the error state', async () => {
        const base = fixtureSource([docsFixture()]);
        const source: KnowledgeGraphSource = {
            ...base,
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
            status: 'error',
            message: 'model refused',
            rootId: 'vscode:ws',
            lastPhase: 'judge',
            detail: 'Error: model refused\n    at judge',
            host: 'BuilderForce for VS Code 1.2.3',
            rootPath: '/work/docs',
        });
        expect((result.current.state as ReviewErrorState).at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('has no phase when it failed before any progress, and uses the error stack as the detail', async () => {
        const base = fixtureSource([docsFixture()]);
        const source: KnowledgeGraphSource = {
            ...base,
            review: () => (async function* (): AsyncGenerator<KnowledgeReviewEvent> {
                throw new Error('no folder');
            })(),
        };
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({}));
        await waitFor(() => expect(result.current.state.status).toBe('error'));
        const state = result.current.state as ReviewErrorState;
        expect(state.lastPhase).toBeUndefined();
        expect(state.message).toBe('no folder');
        expect(state.detail).toContain('no folder');
    });
});
