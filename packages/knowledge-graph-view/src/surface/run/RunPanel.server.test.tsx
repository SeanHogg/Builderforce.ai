// @vitest-environment jsdom
/** The Server tab: parity bars, the files not stored (with the left-out list), the upload queue (Upload now, Retry, Diagnose), the revision, and the hints. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SyncStatus } from '../../types';
import { createKit, r, sync, type HarnessProps } from './runPanelKit';

const { machine, portOf, Harness, tab } = createKit({ fn: vi.fn as never, act, screen });

afterEach(cleanup);

const open = (syncStatus: SyncStatus | null, extra: Partial<HarnessProps> = {}) => {
    render(<Harness port={portOf().port} review={machine({ status: 'idle' })} sync={syncStatus} {...extra} />);
    fireEvent.click(tab(r.tabServer));
};
const failedUpload = (over: Partial<NonNullable<SyncStatus['replica']>> = {}) => sync({ replica: { dirty: 4, sending: false, failed: [{ reason: 'server error', status: 500 } as never], ...over } });

describe('the Server tab', () => {
    it('shows the parity numbers, the files not stored with how many were too large, and the upload queue', () => {
        open(sync({ skipped: [{ path: 'a.bin', reason: 'too-large' }, { path: 'b.bin', reason: 'unreadable' }], replica: { dirty: 4, sending: false, failed: [] } }));
        expect(screen.getByTestId('kg-review-parity').textContent).toBe(fillTemplate(L.surface.header.parityDiffers, { local: '120', server: '100' }));
        const bars = within(screen.getByTestId('kg-server-tab')).getAllByRole('meter');
        expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['100', '83']);
        const stored = screen.getByTestId('kg-review-not-stored').textContent!;
        expect(stored).toContain('2 files not stored');
        expect(stored).toContain('1 file was too large to store');
        expect(stored).toContain('20 files are missing on the server');
        expect(screen.getByTestId('kg-review-upload').textContent).toBe(fillTemplate(r.uploadWaiting, { count: 4 }));
        expect(screen.queryByRole('button', { name: L.surface.overlay.diagnose })).toBeNull();
    });

    it('has a "what is left out" link that opens the list of files not stored', () => {
        open(sync({ skipped: [{ path: 'a.bin', reason: 'too-large' }] }));
        expect(screen.queryByTestId('kg-left-out-list')).toBeNull();
        fireEvent.click(screen.getByTestId('kg-left-out-link'));
        expect(within(screen.getByTestId('kg-left-out-list')).getByText(/a\.bin/)).toBeTruthy();
    });

    it('explains itself with a hint under each reading', () => {
        open(sync({ skipped: [{ path: 'a.bin', reason: 'x' }], replica: { dirty: 1, sending: false, failed: [] } }));
        for (const hint of [r.hintParity, r.hintNotStored, r.hintQueue]) expect(screen.getByText(hint)).toBeTruthy();
    });

    it('a failed upload is red, shows the Sync detail, and Diagnose switches to the Diagnostics tab', () => {
        open(failedUpload());
        expect(screen.getByTestId('kg-review-upload').textContent).toBe(fillTemplate(r.uploadFailed, { count: 4, failed: 1 }));
        expect(screen.getByTestId('kg-sync-replica-failed')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.overlay.diagnose }));
        expect(tab(r.tabDiagnostics).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('kg-diagnostics-tab')).toBeTruthy();
    });

    it('holds the Before / After revision the map shows, and changing it calls the root', () => {
        const onChange = vi.fn();
        open(sync(), { revision: { value: 'after', hasBefore: true, onChange } });
        expect(screen.getByText(r.revisionTitle)).toBeTruthy();
        fireEvent.click(screen.getByRole('radio', { name: L.compareBefore }));
        expect(onChange).toHaveBeenCalledWith('before');
    });
});

describe('Retry upload and Upload now (the source\'s one retrySync port)', () => {
    it('Retry calls the port for this folder, and is disabled and says so while it runs', async () => {
        let release!: () => void;
        const retrySync = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
        open(failedUpload(), { retrySync });
        const retry = screen.getByTestId('kg-retry-upload') as HTMLButtonElement;
        expect(retry.textContent).toBe(r.actionRetryUpload);
        fireEvent.click(retry);
        expect(retrySync).toHaveBeenCalledWith('docs');
        await waitFor(() => expect((screen.getByTestId('kg-retry-upload') as HTMLButtonElement).disabled).toBe(true));
        expect(screen.getByTestId('kg-retry-upload').textContent).toBe(r.uploadRetrying);
        await act(async () => { release(); });
        await waitFor(() => expect((screen.getByTestId('kg-retry-upload') as HTMLButtonElement).disabled).toBe(false));
    });

    it('says a refused retry failed and enables the button again', async () => {
        open(failedUpload(), { retrySync: vi.fn(async () => { throw new Error('offline'); }) });
        fireEvent.click(screen.getByTestId('kg-retry-upload'));
        expect((await screen.findByTestId('kg-retry-failed')).textContent).toBe(r.retryFailed);
        await waitFor(() => expect((screen.getByTestId('kg-retry-upload') as HTMLButtonElement).disabled).toBe(false));
    });

    it('a queue that waits but has not failed offers Upload now, through the same port', () => {
        const retrySync = vi.fn(async () => undefined);
        open(sync({ replica: { dirty: 3, sending: false, failed: [] } }), { retrySync });
        expect(screen.queryByTestId('kg-retry-upload')).toBeNull();
        fireEvent.click(screen.getByTestId('kg-upload-now'));
        expect(retrySync).toHaveBeenCalledWith('docs');
    });

    it('is disabled while the host says the queue is sending', () => {
        open(failedUpload({ sending: true }), { retrySync: vi.fn(async () => undefined) });
        expect((screen.getByTestId('kg-retry-upload') as HTMLButtonElement).disabled).toBe(true);
    });

    it('offers no Retry and no Upload now when the source has no port (the web), only Diagnose', () => {
        open(failedUpload());
        expect(screen.queryByTestId('kg-retry-upload')).toBeNull();
        expect(screen.queryByTestId('kg-upload-now')).toBeNull();
        expect(screen.getByRole('button', { name: L.surface.overlay.diagnose })).toBeTruthy();
    });
});

// What the old Sync drawer showed beyond the parity bars, kept as Server tab sections (the original drawer tests, through the real panel).
describe('the Server tab keeps the Sync drawer\'s other sections', () => {
    const status: SyncStatus = {
        local: { files: 10, edges: 20, docs: 2 }, server: { files: 8, edges: 20, docs: 2 },
        skipped: [{ path: 'big.json', bytes: 2_000_000, reason: 'too-large' }, { path: 'vendor/x', reason: 'nested-checkout' }, { path: 'a.local', reason: 'local-state' }],
        sources: [{ id: 'coverage', state: 'absent' }, { id: 'traces', state: 'absent' }, { id: 'openapi', state: 'estimated' }, { id: 'code', state: 'collected' }],
    };
    const history = {
        total: 2, loading: false,
        commits: [
            { sha: 'aaaaaaaa1', title: 'old fix', at: '2026-01-01T00:00:00Z', refs: ['x'] },
            { sha: 'bbbbbbbb2', title: 'new work', at: '2026-01-05T00:00:00Z', refs: ['x', 'y'], author: 'Sean' },
        ],
    };
    const base: Partial<HarnessProps> = { withHistory: true, history, lastReviewedAt: '2026-01-03T00:00:00Z' };

    it('feeds the commits since the last review, newest first, pending before applied', () => {
        open(status, base);
        const rows = [...screen.getByTestId('kg-sync-delta').querySelectorAll('li')];
        expect(rows.map((row) => row.getAttribute('data-sha'))).toEqual(['bbbbbbbb2', 'aaaaaaaa1']);
        expect(rows[0]!.getAttribute('data-state')).toBe('pending');
        expect(rows[1]!.getAttribute('data-state')).toBe('applied');
        expect(rows[0]!.textContent).toContain('Sean');
    });

    it('says the commit feed is not available when the source keeps no history', () => {
        open(status, { ...base, withHistory: false, history: undefined });
        expect(screen.getByTestId('kg-sync-delta-unavailable').textContent).toBe(L.surface.unavailable.notHere);
    });

    it('says the commits are loading, never "no commits", while history is on the way', () => {
        open(status, { ...base, history: { commits: [], total: 0, loading: true } });
        expect(screen.getByTestId('kg-sync-delta-loading').textContent).toBe(L.surface.sync.deltaLoading);
        expect(screen.queryByText(L.surface.sync.deltaEmpty)).toBeNull();
    });

    it('lists the real excluded folders and keeps them out of the files not stored', () => {
        open(status, base);
        const excluded = screen.getByTestId('kg-sync-excluded').textContent!;
        expect(excluded).toContain('vendor/x');
        expect(excluded).toContain('a.local');
        fireEvent.click(screen.getByTestId('kg-left-out-link'));
        const skipped = screen.getByTestId('kg-left-out-list').textContent!;
        expect(skipped).toContain('big.json');
        expect(skipped).not.toContain('vendor/x');
    });

    it('says "unknown", not "none", when no review recorded what it skipped', () => {
        open({ ...status, skipped: undefined }, base);
        expect(screen.getByTestId('kg-sync-excluded-unknown').textContent).toBe(L.surface.sync.skippedUnknown);
    });

    it('offers each source its action: compose, open the API drawer, or nothing', () => {
        const onCompose = vi.fn();
        const openPanel = vi.fn();
        open(status, { ...base, onCompose, openPanel });
        fireEvent.click(document.querySelector('[data-source="coverage"] button')!);
        expect(onCompose).toHaveBeenCalledWith(L.surface.sync.setUpV8Request);
        fireEvent.click(document.querySelector('[data-source="traces"] button')!);
        expect(onCompose).toHaveBeenCalledWith(L.surface.sync.turnOnRequest);
        fireEvent.click(document.querySelector('[data-source="openapi"] [data-action="actionGenerate"]')!);
        expect(openPanel).toHaveBeenCalledWith('api');
        expect(document.querySelector('[data-source="code"] button')).toBeNull();
    });

    it('shows "Not available here" instead of a dead button when there is no composer', () => {
        open(status, base);
        expect(document.querySelector('[data-source="coverage"] button')).toBeNull();
        expect(document.querySelector('[data-source="coverage"] [data-testid="kg-source-unavailable"]')).toBeTruthy();
    });

    it('resends skipped files through the review flow, and marks resend unavailable when the host cannot review', () => {
        const onResendSkipped = vi.fn();
        open(status, { ...base, onResendSkipped });
        fireEvent.click(screen.getByTestId('kg-sync-resend'));
        expect(onResendSkipped).toHaveBeenCalledTimes(1);
        cleanup();
        open(status, base);
        expect(screen.queryByTestId('kg-sync-resend')).toBeNull();
        expect(screen.getByTestId('kg-sync-resend-unavailable')).toBeTruthy();
    });
});
