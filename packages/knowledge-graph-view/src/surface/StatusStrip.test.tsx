// @vitest-environment jsdom
/** The status strip (pill, parity, scrubber, review card) and the ⋯ menu it holds. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import type { KnowledgeGraphSource, ReviewRequest } from '../types';
import { OverflowMenu, type OverflowMenuProps } from './OverflowMenu';
import { StatusStrip, type StatusStripProps } from './StatusStrip';

const strip = (over: Partial<StatusStripProps> = {}) => {
    const p: StatusStripProps = {
        labels: L, narrow: false, pill: { state: 'synced', text: 'Synced just now' }, parity: '15 files here and on the server', reviewStatus: 'idle',
        reviewCard: <button type="button">card action</button>, onSync: vi.fn(), time: <div data-testid="scrubber">scrubber</div>, overlays: <span data-testid="overlays" />, overflow: <span data-testid="overflow" />, ...over,
    };
    const utils = render(<StatusStrip {...p} />);
    return { p, ...utils };
};
const pill = () => document.querySelector('[data-state]') as HTMLElement;

describe('StatusStrip', () => {
    it('is one line with the pill, the parity and the scrubber on a wide container', () => {
        strip();
        const row = screen.getByTestId('kg-status-strip');
        expect(row.contains(screen.getByTestId('kg-parity'))).toBe(true);
        expect(screen.queryByTestId('kg-scrubber-line')).toBeNull();
        expect(screen.getByTestId('scrubber')).toBeTruthy();
    });

    it('on a narrow container puts the scrubber on a second, horizontally scrolling line and hides the parity', () => {
        strip({ narrow: true });
        expect(screen.queryByTestId('kg-parity')).toBeNull();
        const line = screen.getByTestId('kg-scrubber-line');
        expect(line.style.overflowX).toBe('auto');
        expect(within(line).getByTestId('scrubber')).toBeTruthy();
        expect(screen.getByTestId('overlays')).toBeTruthy(); // the overlay menu lives in the strip on a phone
    });

    it('says the sync state in words as well as colour', () => {
        strip();
        expect(pill().getAttribute('aria-label')).toBe(`Synced just now ${L.surface.pillStates.synced}`);
    });

    it('the pill opens the Sync drawer when no review is underway', () => {
        const { p } = strip();
        fireEvent.click(pill());
        expect(p.onSync).toHaveBeenCalled();
        expect(screen.queryByTestId('kg-review-card')).toBeNull();
    });

    describe('the review card', () => {
        it('toggles from the pill with aria-expanded and aria-controls pointing at the card', () => {
            strip({ reviewStatus: 'running' });
            expect(pill().getAttribute('aria-expanded')).toBe('false');
            fireEvent.click(pill());
            const card = screen.getByTestId('kg-review-card');
            expect(pill().getAttribute('aria-expanded')).toBe('true');
            expect(pill().getAttribute('aria-controls')).toBe(card.id);
            fireEvent.click(pill());
            expect(screen.queryByTestId('kg-review-card')).toBeNull();
        });

        it('closes on Esc and hands focus back to the pill', () => {
            strip({ reviewStatus: 'running' });
            fireEvent.click(pill());
            fireEvent.keyDown(screen.getByTestId('kg-review-card'), { key: 'Escape' });
            expect(screen.queryByTestId('kg-review-card')).toBeNull();
            expect(document.activeElement).toBe(pill());
        });

        it('closes on a press outside, and not on one inside', () => {
            strip({ reviewStatus: 'running' });
            fireEvent.click(pill());
            fireEvent.pointerDown(screen.getByTestId('kg-review-card'));
            expect(screen.getByTestId('kg-review-card')).toBeTruthy();
            fireEvent.pointerDown(document.body);
            expect(screen.queryByTestId('kg-review-card')).toBeNull();
        });

        it.each(['confirm', 'error'] as const)('opens by itself on %s and moves focus into it', (status) => {
            strip({ reviewStatus: status });
            const card = screen.getByTestId('kg-review-card');
            expect(card.contains(document.activeElement)).toBe(true);
        });

        it('opens by itself when the review is done WITHOUT stealing focus, and announces it in the live region', () => {
            const { container } = strip({ reviewStatus: 'done' });
            expect(screen.getByTestId('kg-review-card')).toBeTruthy();
            expect(screen.getByTestId('kg-review-card').contains(document.activeElement)).toBe(false);
            expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(`${L.reviewDoneTitle} · Synced just now`);
        });

        it('closes when the review is dismissed', () => {
            const { rerender, p } = strip({ reviewStatus: 'confirm' });
            rerender(<StatusStrip {...p} reviewStatus="idle" />);
            expect(screen.queryByTestId('kg-review-card')).toBeNull();
        });
    });
});

describe('OverflowMenu', () => {
    const source = (over: Partial<KnowledgeGraphSource> = {}): KnowledgeGraphSource => ({
        scopes: async () => [], load: async () => null, review: (() => (async function* () { /* none */ })()) as KnowledgeGraphSource['review'], ...over,
    });
    const menu = (over: Partial<OverflowMenuProps> = {}) => {
        const p: OverflowMenuProps = {
            source: source(), labels: L, rootId: 'sys', canReview: true, reviewStatus: 'idle', onReview: vi.fn(), diagnosticsText: () => 'DIAG', targets: [], ...over,
        };
        render(<OverflowMenu {...p} />);
        fireEvent.click(screen.getByRole('button', { name: L.surface.header.moreActions }));
        return { p, panel: screen.getByRole('menu', { name: L.surface.header.moreActions }) };
    };

    it('offers Review a folder and Re-review, and starts the matching request', () => {
        const { p, panel } = menu();
        fireEvent.click(within(panel).getByRole('menuitem', { name: L.surface.header.reReview }));
        expect(p.onReview).toHaveBeenCalledWith({ rootId: 'sys' } satisfies ReviewRequest);
    });

    it('lists one review item per target when the host names several', () => {
        const { panel } = menu({ targets: [{ id: 'ws', kind: 'workspace', title: 'Repo' }, { id: 'dev', kind: 'device', title: 'Laptop' }] as OverflowMenuProps['targets'] });
        expect(within(panel).getAllByRole('menuitem', { name: new RegExp(`^${L.reviewFolder}`) })).toHaveLength(2);
    });

    it('offers no review actions when review is not on offer', () => {
        const { panel } = menu({ canReview: false });
        expect(within(panel).queryByRole('menuitem', { name: L.surface.header.reReview })).toBeNull();
    });

    it('disables the review actions while a review is underway', () => {
        const { panel } = menu({ reviewStatus: 'running' });
        expect((within(panel).getByRole('menuitem', { name: L.surface.header.reReview }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('switches Before / After when the host keeps a baseline ("Before" disabled without one)', () => {
        const onChange = vi.fn();
        const { panel } = menu({ revision: { value: 'after', hasBefore: false, onChange } });
        expect((within(panel).getByRole('menuitem', { name: new RegExp(`^${L.compareBefore}`) }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(within(panel).getByRole('menuitem', { name: new RegExp(`^${L.compareAfter}`) }));
        expect(onChange).toHaveBeenCalledWith('after');
    });

    it('copies the diagnostics and says Copied', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        const { panel } = menu();
        fireEvent.click(within(panel).getByRole('menuitem', { name: L.copyDiagnostics }));
        expect(writeText).toHaveBeenCalledWith('DIAG');
        expect(await screen.findByText(L.copied)).toBeTruthy();
    });

    it('does not hold the folder picker (the spine root crumb is its one place)', () => {
        const { panel } = menu();
        expect(within(panel).queryByText(/Folder:/)).toBeNull();
    });
});
