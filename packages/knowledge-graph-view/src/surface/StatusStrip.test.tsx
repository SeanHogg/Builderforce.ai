// @vitest-environment jsdom
/** The status strip: a status chip joined to ONE action button, then the scrubber. Both open the Reviews panel, in every state. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import type { ReviewState } from '../useReviewRun';
import { StatusStrip, type StatusStripProps } from './StatusStrip';
import { stripAction, syncPill, type SyncPillInput } from './syncPill';
import { RetryUploadContext } from './run/useRetryUpload';

const pillOf = (over: Partial<SyncPillInput> = {}) => syncPill({ labels: L, review: { status: 'idle' }, stale: false, refreshFailed: false, sync: null, ...over });

const strip = (over: Partial<StatusStripProps> = {}, input: Partial<SyncPillInput> = {}) => {
    const pill = pillOf(input);
    const p: StatusStripProps = {
        labels: L, narrow: false, pill, action: stripAction(L, pill, 'Docs'), onOpen: vi.fn(),
        time: <div data-testid="scrubber">scrubber</div>, overlays: <span data-testid="overlays" />, ...over,
    };
    const utils = render(<StatusStrip {...p} />);
    return { p, ...utils };
};

describe('StatusStrip', () => {
    it('is one line with the chip, the one action button and the scrubber on a wide container', () => {
        strip();
        const row = screen.getByTestId('kg-status-strip');
        expect(within(row).getAllByTestId('kg-review-action')).toHaveLength(1);
        expect(within(row).getByTestId('kg-status-chip')).toBeTruthy();
        expect(screen.queryByTestId('kg-scrubber-line')).toBeNull();
        expect(screen.getByTestId('scrubber')).toBeTruthy();
    });

    it('holds no parity line, no ⋯ menu and no review card', () => {
        strip();
        expect(screen.queryByTestId('kg-parity')).toBeNull();
        expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
        expect(screen.queryByTestId('kg-review-card')).toBeNull();
        expect(within(screen.getByTestId('kg-status-strip')).getAllByRole('button')).toHaveLength(2);
    });

    it('on a narrow container shrinks the chip to its dot (the words stay in its name), keeps the verb, and scrolls the scrubber on a second line', () => {
        strip({ narrow: true }, { review: { status: 'planning' } });
        const chip = screen.getByTestId('kg-status-chip');
        expect(chip.textContent).toBe('');
        expect(chip.getAttribute('aria-label')).toContain(L.surface.run.review.chipCountingPlain);
        expect(screen.getByTestId('kg-review-action').textContent).toBe(L.surface.run.review.actionStart);
        const line = screen.getByTestId('kg-scrubber-line');
        expect(line.style.overflowX).toBe('auto');
        expect(within(line).getByTestId('scrubber')).toBeTruthy();
        expect(screen.getByTestId('overlays')).toBeTruthy(); // the overlay menu lives in the strip on a phone
    });

    it('says the state in words as well as colour', () => {
        strip({}, { review: { status: 'stopping', stoppedAt: 0 } });
        expect(screen.getByTestId('kg-status-chip').getAttribute('aria-label')).toBe(`${L.surface.run.review.chipStopping} ${L.surface.pillStates.syncing}`);
    });

    it('draws a 2px progress underline on the chip only while reviewing', () => {
        const { unmount } = strip({}, { review: { status: 'running', progress: { phase: 'extract', done: 5, total: 10 } } });
        expect(screen.getByTestId('kg-chip-progress').style.width).toBe('50%');
        unmount();
        strip();
        expect(screen.queryByTestId('kg-chip-progress')).toBeNull();
    });

    it('spins while counting, reviewing and stopping (stopping in the amber warn token), and is a plain dot otherwise', () => {
        const dotOf = () => screen.getByTestId('kg-chip-dot');
        const spin = (input: Partial<SyncPillInput>) => { const view = strip({}, input); const d = dotOf(); const out = { spinner: d.dataset.spinner === 'true', tone: d.dataset.tone }; view.unmount(); return out; };
        expect(spin({ review: { status: 'planning' } }).spinner).toBe(true);
        expect(spin({ review: { status: 'running' } }).spinner).toBe(true);
        const stopping = spin({ review: { status: 'stopping', stoppedAt: 0 } });
        expect(stopping.spinner).toBe(true);
        expect(stopping.tone).toBe('cycle'); // the amber warn token
        expect(spin({ review: { status: 'running' } }).tone).toBe('accent');
        expect(spin({}).spinner).toBe(false);
        expect(spin({ review: { status: 'aborted' } }).spinner).toBe(false);
    });

    describe('both buttons open the Reviews panel, in every state', () => {
        const states: [string, Partial<SyncPillInput>, string][] = [
            ['never reviewed', {}, 'review'],
            ['counting', { review: { status: 'planning' } as ReviewState }, 'review'],
            ['plan ready', { review: { status: 'confirm', plan: {} as never } as ReviewState }, 'review'],
            ['running', { review: { status: 'running' } as ReviewState }, 'review'],
            ['stopping', { review: { status: 'stopping', stoppedAt: 0 } as ReviewState }, 'review'],
            ['stopped', { review: { status: 'aborted' } as ReviewState }, 'runs'],
            ['failed', { review: { status: 'error', message: 'x', at: '2026-01-01T00:00:00Z' } as ReviewState }, 'review'],
            ['up to date', { sync: { local: { files: 3, docs: 0 }, server: { files: 3, docs: 0 }, sources: [] }, lastReviewedAt: '2026-01-01T11:58:00Z' }, 'runs'],
            ['files not stored', { sync: { local: { files: 3, docs: 0 }, server: { files: 3, docs: 0 }, sources: [], skipped: [{ path: 'a', reason: 'x' }] } }, 'server'],
        ];
        it.each(states)('%s: the chip opens its tab and the button opens Review', (_name, input, chipTab) => {
            const { p } = strip({}, input);
            fireEvent.click(screen.getByTestId('kg-status-chip'));
            expect(p.onOpen).toHaveBeenLastCalledWith(chipTab);
            const action = screen.getByTestId('kg-review-action') as HTMLButtonElement;
            if (action.disabled) return; // counting / stopping: the button waits
            fireEvent.click(action);
            expect(p.onOpen).toHaveBeenLastCalledWith('review');
        });

        const failedSync = { local: { files: 3, docs: 0 }, server: { files: 3, docs: 0 }, sources: [], replica: { dirty: 1, sending: false, failed: [{ reason: 'x' } as never] } };

        it('a failed upload with no retry port: the button says so and, like the chip, opens the Server tab', () => {
            const { p } = strip({}, { sync: failedSync });
            expect(screen.getByTestId('kg-review-action').textContent).toBe(L.surface.run.review.actionSeeUpload);
            fireEvent.click(screen.getByTestId('kg-status-chip'));
            expect(p.onOpen).toHaveBeenLastCalledWith('server');
            fireEvent.click(screen.getByTestId('kg-review-action'));
            expect(p.onOpen).toHaveBeenLastCalledWith('server');
        });

        it('a failed upload with a retry port (from context): the button is Retry upload, retries at once instead of opening the panel, and is disabled while it runs', () => {
            const retry = vi.fn();
            const pill = pillOf({ sync: failedSync });
            const p: StatusStripProps = { labels: L, narrow: false, pill, action: stripAction(L, pill, 'Docs'), onOpen: vi.fn() };
            const view = render(<RetryUploadContext.Provider value={{ retry, running: false, failed: false }}><StatusStrip {...p} /></RetryUploadContext.Provider>);
            expect(screen.getByTestId('kg-review-action').textContent).toBe(L.surface.run.review.actionRetryUpload);
            fireEvent.click(screen.getByTestId('kg-review-action'));
            expect(retry).toHaveBeenCalledTimes(1);
            expect(p.onOpen).not.toHaveBeenCalled();

            view.rerender(<RetryUploadContext.Provider value={{ retry, running: true, failed: false }}><StatusStrip {...p} /></RetryUploadContext.Provider>);
            const busy = screen.getByTestId('kg-review-action') as HTMLButtonElement;
            expect(busy.disabled).toBe(true);
            expect(busy.textContent).toBe(L.surface.run.review.uploadRetrying);
        });
    });

    it('is a plain status with no button for a host that cannot review or record runs', () => {
        strip({ onOpen: undefined });
        expect(screen.queryByTestId('kg-review-action')).toBeNull();
        expect(screen.getByTestId('kg-status-chip').tagName).toBe('SPAN');
    });
});
