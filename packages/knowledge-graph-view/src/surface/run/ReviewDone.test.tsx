// @vitest-environment jsdom
/** How a review ends in the panel: the finished summary (Continue, the files not stored) and the failure (the reason, Copy details). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { FIXTURE_REPORT } from '../../testing';
import type { ReviewErrorState } from '../../useReviewRun';
import { ReviewDone } from './ReviewDone';

function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

const ERROR: ReviewErrorState = {
    status: 'error', message: 'disk full', at: '2026-10-30T12:00:00.000Z', rootId: 'vscode:ws', rootPath: '/work/docs', lastPhase: 'judge',
    detail: 'Error: disk full\n    at write (store.ts:1)', host: 'BuilderForce for VS Code 1.2.3',
};

const failed = (state: ReviewErrorState = ERROR) => render(<ReviewDone labels={L} state={state} onContinue={() => undefined} onDismiss={() => undefined} />);

describe('a failed review in the panel', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shows the sentence, the reason and a Copy details button', () => {
        failed();
        expect(screen.getByText(L.reviewFailed)).toBeTruthy();
        expect(screen.getByText('Reason: disk full')).toBeTruthy();
        expect(screen.getByRole('button', { name: L.reviewCopyDetails })).toBeTruthy();
    });

    it('copies a diagnostics block with the status, root, phase, message, detail, host and time', async () => {
        const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
        stubClipboard(writeText);
        failed();
        fireEvent.click(screen.getByRole('button', { name: L.reviewCopyDetails }));
        expect(await screen.findByText(L.copied)).toBeTruthy();
        const text = writeText.mock.calls[0]![0];
        for (const line of ['status: error', 'root: vscode:ws', 'path: /work/docs', 'phase: judge', 'message: disk full', 'at write (store.ts:1)', 'host: BuilderForce for VS Code 1.2.3', 'time: 2026-10-30T12:00:00.000Z']) {
            expect(text).toContain(line);
        }
    });

    it('lists only what is known', async () => {
        const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
        stubClipboard(writeText);
        failed({ status: 'error', message: 'boom', at: '2026-10-30T12:00:00.000Z' });
        fireEvent.click(screen.getByRole('button', { name: L.reviewCopyDetails }));
        await screen.findByText(L.copied);
        const text = writeText.mock.calls[0]![0];
        expect(text).toContain('message: boom');
        for (const absent of ['phase:', 'host:', 'detail:']) expect(text).not.toContain(absent);
    });

    it('falls back to selectable text when the clipboard refuses', async () => {
        stubClipboard(async () => { throw new Error('denied'); });
        failed();
        fireEvent.click(screen.getByRole('button', { name: L.reviewCopyDetails }));
        expect(await screen.findByText(L.copyFailed)).toBeTruthy();
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('message: disk full');
    });
});

describe('a finished review in the panel', () => {
    const done = (unjudged: number, onContinue = vi.fn()) => render(
        <ReviewDone labels={L} state={{ status: 'done', rootId: 'docs', report: { ...FIXTURE_REPORT, unjudged } }} onContinue={onContinue} onDismiss={() => undefined} />,
    );

    it('says what was written and offers no Continue when nothing is left', () => {
        done(0);
        expect(screen.getByText(L.reviewDoneTitle)).toBeTruthy();
        expect(screen.getByText('2 files read · 4 sections judged · 3 facts written')).toBeTruthy();
        expect(screen.queryByRole('button', { name: L.reviewContinue })).toBeNull();
    });

    it('offers Continue when sections were left unjudged, for the same root', () => {
        const onContinue = vi.fn();
        done(3, onContinue);
        fireEvent.click(screen.getByRole('button', { name: L.reviewContinue }));
        expect(onContinue).toHaveBeenCalledWith('docs');
    });
});
