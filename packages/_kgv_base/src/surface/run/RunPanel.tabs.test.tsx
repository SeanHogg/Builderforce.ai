// @vitest-environment jsdom
/** The Reviews panel's frame: its tabs (click, arrow keys, remembered per root), their badges, and the header's ring and status line. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishedRun, liveRun, summaryOf } from './runFixture';
import { createKit, r, sync } from './runPanelKit';

const { machine, portOf, Harness, tab } = createKit({ fn: vi.fn as never, act, screen });

afterEach(cleanup);

describe('tabs', () => {
    it('shows Review first, switches tabs by click and by arrow keys, and remembers the tab when the panel is closed and opened again', () => {
        render(<Harness port={portOf().port} review={machine({ status: 'idle' })} />);
        expect(screen.getByRole('tablist', { name: r.tabsLabel })).toBeTruthy();
        expect(tab(r.tabReview).getAttribute('aria-selected')).toBe('true');

        fireEvent.click(tab(r.tabServer));
        expect(tab(r.tabServer).getAttribute('aria-selected')).toBe('true');
        fireEvent.keyDown(tab(r.tabServer), { key: 'ArrowRight' });
        expect(tab(r.tabDiagnostics).getAttribute('aria-selected')).toBe('true');
        fireEvent.keyDown(tab(r.tabDiagnostics), { key: 'ArrowRight' }); // wraps
        expect(tab(r.tabReview).getAttribute('aria-selected')).toBe('true');
        fireEvent.keyDown(tab(r.tabReview), { key: 'ArrowLeft' });
        expect(tab(r.tabDiagnostics).getAttribute('aria-selected')).toBe('true');

        fireEvent.click(screen.getByText('toggle'));
        expect(screen.queryByRole('tablist')).toBeNull();
        fireEvent.click(screen.getByText('toggle'));
        expect(tab(r.tabDiagnostics).getAttribute('aria-selected')).toBe('true');
    });

    it('badges Runs with the number of runs and Server with the files not stored', async () => {
        const { port } = portOf({ list: vi.fn(async () => [summaryOf(finishedRun())]) });
        render(<Harness port={port} review={machine({ status: 'idle' })} sync={sync({ skipped: [{ path: 'a.bin', reason: 'too-large' }, { path: 'b.bin', reason: 'x' }] })} />);
        await waitFor(() => expect(screen.getByTestId('kg-tab-badge-runs').textContent).toBe('1'));
        expect(screen.getByTestId('kg-tab-badge-server').textContent).toBe('2');
    });
});

describe('the layout', () => {
    it('lays the panel out as a column: the body scrolls on its own and the footer sits outside it, with no sticky offsets', () => {
        render(<Harness port={portOf().port} review={machine({ status: 'confirm', plan: { rootId: 'docs', files: 3, byPack: {}, unchanged: 1, changed: [], removed: [], skipped: [], estimatedModelCalls: 0 } })} />);
        const root = screen.getByTestId('kg-run');
        const body = screen.getByTestId('kg-reviews-body');
        const footer = screen.getByTestId('kg-reviews-footer');
        expect(root.style.display).toBe('flex');
        expect(root.style.flexDirection).toBe('column');
        expect(body.style.overflowY).toBe('auto');
        expect(body.contains(footer)).toBe(false);
        expect(root.contains(footer)).toBe(true);
        expect(footer.style.position).toBe('');
        expect(footer.style.bottom).toBe('');
    });
});

describe('the header', () => {
    it('shows the live percent as a ring, and a dot otherwise', () => {
        const { port, push } = portOf();
        render(<Harness port={port} review={machine({ status: 'running' })} />);
        push(liveRun());
        expect(screen.getByTestId('kg-reviews-ring')).toBeTruthy();
        expect(screen.getByTestId('kg-reviews-status').textContent).toContain('Re-review · started');
        cleanup();
        render(<Harness port={portOf().port} review={machine({ status: 'idle' })} lastReviewedAt="2026-01-01T11:58:00Z" />);
        expect(screen.getByTestId('kg-reviews-dot')).toBeTruthy();
        expect(screen.getByTestId('kg-reviews-status').textContent).toMatch(/^Reviewed /);
    });
});
