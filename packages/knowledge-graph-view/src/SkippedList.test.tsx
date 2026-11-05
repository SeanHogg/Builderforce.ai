// @vitest-environment jsdom
/** The files a review did not store: a count that opens into the list, reasons in words, no invented sizes. */
import { describe, expect, it, vi } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import { FIXTURE_REPORT, fixtureSource } from './testing';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from './labels';
import { ReviewProgress } from './ReviewProgress';
import { skippedRowText, SkippedUploads } from './SkippedList';
import { useReviewRun, type ReviewRun } from './useReviewRun';
import type { KnowledgeGraphSource, SkippedFile } from './types';

const skipped: SkippedFile[] = [
    { path: 'dump.sql', bytes: 12 * 1024 * 1024, reason: 'too-large' },
    { path: 'notes.txt', reason: 'unreadable' },
    { path: 'odd.bin', reason: 'something-new' },
];

describe('skippedRowText', () => {
    it('puts the reason in words, the size only when measured, and an unknown reason as sent', () => {
        expect(skippedRowText(skipped[0]!, L)).toBe(`dump.sql · 12.0 MB · ${L.surface.skipReasons.tooLarge}`);
        expect(skippedRowText(skipped[1]!, L)).toBe(`notes.txt · ${L.surface.skipReasons.unreadable}`);
        expect(skippedRowText(skipped[1]!, L)).not.toContain('0 B');
        expect(skippedRowText(skipped[2]!, L)).toBe('odd.bin · something-new');
    });
});

describe('SkippedUploads', () => {
    it('is a count that expands to the list, and draws nothing for an empty one', () => {
        const { container, rerender } = render(<SkippedUploads items={skipped} labels={L} />);
        const details = container.querySelector('details')!;
        expect(details.querySelector('summary')!.textContent).toBe(fillTemplate(L.surface.skippedUploads, { count: 3 }));
        expect(container.querySelectorAll('[data-testid="kg-skipped-uploads-list"] li')).toHaveLength(3);
        rerender(<SkippedUploads items={[]} labels={L} />);
        expect(container.innerHTML).toBe('');
    });
});

describe('the done card', () => {
    const done = (extra: Partial<Extract<ReviewRun['state'], { status: 'done' }>>) => (
        <ReviewProgress
            run={{ state: { status: 'done', rootId: 'docs', report: FIXTURE_REPORT, ...extra }, available: true, start: vi.fn(), answer: vi.fn(), rereviewAll: vi.fn(), stop: vi.fn(), dismiss: vi.fn() }}
            labels={L} titleOf={(id) => id} onContinue={() => undefined}
        />
    );

    it('lists the skipped uploads when the review reported any, and says nothing otherwise', () => {
        const { container, rerender } = render(done({ skipped }));
        expect(container.querySelector('[data-testid="kg-skipped-uploads"]')).not.toBeNull();
        rerender(done({}));
        expect(container.querySelector('[data-testid="kg-skipped-uploads"]')).toBeNull();
    });

    it('carries the skipped list from the review\'s done event into the state', async () => {
        const base = fixtureSource([]);
        const source: KnowledgeGraphSource = {
            ...base,
            review: (_req, ctl) => (async function* () {
                const plan = { rootId: 'docs', files: 1, byPack: {}, unchanged: 0, changed: [], removed: [], skipped: [], estimatedModelCalls: 0 };
                yield { type: 'plan' as const, plan };
                await ctl.confirm(plan);
                yield { type: 'done' as const, rootId: 'docs', report: FIXTURE_REPORT, skipped };
            })(),
        };
        const { result } = renderHook(() => useReviewRun(source, () => undefined));
        act(() => result.current.start({ pick: true }));
        await waitFor(() => expect(result.current.state.status).toBe('confirm'));
        act(() => result.current.answer(true));
        await waitFor(() => expect(result.current.state.status).toBe('done'));
        expect((result.current.state as Extract<ReviewRun['state'], { status: 'done' }>).skipped).toEqual(skipped);
    });
});
