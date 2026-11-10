// @vitest-environment jsdom
/** The ONE sync read: one fetch, a reset on a root switch, a failure that is said, and refresh through the same path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { KnowledgeGraphSource, SyncStatus } from '../types';
import { SYNC_POLL_MAX_MS, SYNC_POLL_MS, syncPollDelay, useSyncStatus } from './useSyncStatus';

const status = (files: number): SyncStatus => ({ local: { files, docs: 0 }, sources: [] });
const sourceOf = (read: KnowledgeGraphSource['syncStatus']): KnowledgeGraphSource => ({ scopes: async () => [], load: async () => null, ...(read ? { syncStatus: read } : {}) });

describe('useSyncStatus', () => {
    it('reads once per root and graph, however many consumers read the result', async () => {
        const read = vi.fn(async () => status(3));
        const source = sourceOf(read);
        const { result, rerender } = renderHook(() => useSyncStatus(source, 'a', 'g1'));
        await waitFor(() => expect(result.current.status).toEqual(status(3)));
        rerender();
        rerender();
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('reads again when a new graph lands, keeping the last status meanwhile (no flicker)', async () => {
        let n = 0;
        const read = vi.fn(async () => status(++n));
        const source = sourceOf(read);
        const { result, rerender } = renderHook(({ key }) => useSyncStatus(source, 'a', key), { initialProps: { key: 'g1' } });
        await waitFor(() => expect(result.current.status?.local.files).toBe(1));
        rerender({ key: 'g2' });
        expect(result.current.status?.local.files).toBe(1);
        await waitFor(() => expect(result.current.status?.local.files).toBe(2));
    });

    it('drops the last root\'s status the moment the root changes', async () => {
        let release!: (s: SyncStatus) => void;
        const read = vi.fn((rootId: string) => (rootId === 'a' ? Promise.resolve(status(1)) : new Promise<SyncStatus>((r) => { release = r; })));
        const source = sourceOf(read);
        const { result, rerender } = renderHook(({ root }) => useSyncStatus(source, root, 'g'), { initialProps: { root: 'a' } });
        await waitFor(() => expect(result.current.status?.local.files).toBe(1));
        rerender({ root: 'b' });
        await waitFor(() => expect(result.current.status).toBeNull());
        await act(async () => release(status(9)));
        expect(result.current.status?.local.files).toBe(9);
    });

    it('says a failed read, and clears it on the next successful one', async () => {
        const read = vi.fn<NonNullable<KnowledgeGraphSource['syncStatus']>>().mockRejectedValueOnce(new Error('x')).mockResolvedValue(status(2));
        const source = sourceOf(read); // stable, like the view's source: a new object per render would be a new read per render
        const { result } = renderHook(() => useSyncStatus(source, 'a', 'g'));
        await waitFor(() => expect(result.current.failed).toBe(true));
        expect(result.current.status).toBeNull();
        act(() => result.current.refresh());
        await waitFor(() => expect(result.current.status?.local.files).toBe(2));
        expect(result.current.failed).toBe(false);
    });

    it('refresh reads through the same path (one more call, not a second fetch path)', async () => {
        const read = vi.fn(async () => status(1));
        const source = sourceOf(read);
        const { result } = renderHook(() => useSyncStatus(source, 'a', 'g'));
        await waitFor(() => expect(result.current.status).not.toBeNull());
        act(() => result.current.refresh());
        await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    });

    it('is empty for a host that cannot report, or with no root', () => {
        const none = renderHook(() => useSyncStatus(sourceOf(undefined), 'a', 'g'));
        expect(none.result.current.status).toBeNull();
        const read = vi.fn(async () => status(1));
        const noRoot = renderHook(() => useSyncStatus(sourceOf(read), null, 'g'));
        expect(noRoot.result.current.status).toBeNull();
        expect(read).not.toHaveBeenCalled();
    });
});

describe('useSyncStatus while an upload is under way', () => {
    afterEach(() => vi.useRealTimers());
    const replica = (dirty: number, sending: boolean, failed = 0): SyncStatus => ({
        local: { files: 3, docs: 0 }, sources: [], replica: { dirty, sending, failed: Array.from({ length: failed }, () => ({ reason: 'x' })) },
    });

    it('reads again every 2 s while the replica sends, follows the queue down, and stops once it is idle', async () => {
        vi.useFakeTimers();
        const answers = [replica(3, true), replica(1, true), replica(0, false)];
        const read = vi.fn(async () => answers[Math.min(read.mock.calls.length - 1, answers.length - 1)]!);
        const source = sourceOf(read);
        const { result } = renderHook(() => useSyncStatus(source, 'a', 'g'));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(result.current.status?.replica?.dirty).toBe(3);

        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(result.current.status?.replica?.dirty).toBe(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(result.current.status?.replica?.dirty).toBe(0);

        const calls = read.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 5); });
        expect(read).toHaveBeenCalledTimes(calls);
    });

    it('does not poll an idle queue or a queue that failed, and stops when the view unmounts', async () => {
        vi.useFakeTimers();
        const idle = vi.fn(async () => replica(0, false));
        const idleSource = sourceOf(idle);
        const a = renderHook(() => useSyncStatus(idleSource, 'a', 'g'));
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 3); });
        expect(idle).toHaveBeenCalledTimes(1);
        a.unmount();

        const failed = vi.fn(async () => replica(4, false, 1));
        const failedSource = sourceOf(failed);
        const b = renderHook(() => useSyncStatus(failedSource, 'a', 'g'));
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 3); });
        expect(failed).toHaveBeenCalledTimes(1);
        b.unmount();

        const busy = vi.fn(async () => replica(2, true));
        const busySource = sourceOf(busy);
        const c = renderHook(() => useSyncStatus(busySource, 'a', 'g'));
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        c.unmount();
        const calls = busy.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 4); });
        expect(busy).toHaveBeenCalledTimes(calls);
    });

    it('regression: a failed read clears the uploading status and backs off instead of polling every 2 s', async () => {
        vi.useFakeTimers();
        let fail = false;
        const read = vi.fn(async () => { if (fail) throw new Error('offline'); return replica(3, true); });
        const source = sourceOf(read);
        const { result } = renderHook(() => useSyncStatus(source, 'a', 'g'));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(result.current.status?.replica?.sending).toBe(true);

        fail = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(result.current.failed).toBe(true);
        expect(result.current.status).toBeNull(); // stale, not the last good "uploading"
        const afterFail = read.mock.calls.length;
        // The next poll waits syncPollDelay(1) = 4 s, not 2 s.
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(read).toHaveBeenCalledTimes(afterFail);
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(read).toHaveBeenCalledTimes(afterFail + 1);

        // A minute offline costs a handful of reads, not thirty.
        const before = read.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(read.mock.calls.length - before).toBeLessThanOrEqual(4);

        fail = false;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MAX_MS); });
        expect(result.current.failed).toBe(false);
        expect(result.current.status?.replica?.sending).toBe(true);
        // Back on the short interval once it is sending again.
        const resumed = read.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(read).toHaveBeenCalledTimes(resumed + 1);
    });

    it('regression: a dirty queue that never sends is read with backoff, not every 2 s forever', async () => {
        vi.useFakeTimers();
        const read = vi.fn(async () => replica(5, false));
        const source = sourceOf(read);
        renderHook(() => useSyncStatus(source, 'a', 'g'));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        const start = read.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
        // 2+4+8+16+32 s, then once a minute: well under the 150 reads a fixed 2 s poll would make.
        expect(read.mock.calls.length - start).toBeLessThanOrEqual(10);
        expect(read.mock.calls.length - start).toBeGreaterThan(0);
    });

    it('pauses while the page is hidden and resumes when it is shown', async () => {
        vi.useFakeTimers();
        const read = vi.fn(async () => replica(3, true));
        const source = sourceOf(read);
        const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        try {
            renderHook(() => useSyncStatus(source, 'a', 'g'));
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 5); });
            expect(read).toHaveBeenCalledTimes(1);
            hidden.mockReturnValue(false);
            await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
            expect(read).toHaveBeenCalledTimes(2);
        } finally {
            hidden.mockRestore();
        }
    });
});

describe('useSyncStatus visibility', () => {
    afterEach(() => vi.useRealTimers());

    it('regression: becoming visible with a poll pending reads once, not twice', async () => {
        vi.useFakeTimers();
        const read = vi.fn(async (): Promise<SyncStatus> => ({ local: { files: 3, docs: 0 }, sources: [], replica: { dirty: 3, sending: true, failed: [] } }));
        const source = sourceOf(read);
        renderHook(() => useSyncStatus(source, 'a', 'g'));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(read).toHaveBeenCalledTimes(1);
        // A 2 s poll is pending; the page announces it is visible half-way through.
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS / 2); });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
        expect(read).toHaveBeenCalledTimes(2);
        // The old timer's deadline passes: no extra read. The next one is a full interval after the visible read.
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS / 2); });
        expect(read).toHaveBeenCalledTimes(2);
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS / 2); });
        expect(read).toHaveBeenCalledTimes(3);
    });
});

describe('syncPollDelay', () => {
    it('doubles from SYNC_POLL_MS and caps at SYNC_POLL_MAX_MS', () => {
        expect(syncPollDelay(0)).toBe(SYNC_POLL_MS);
        expect(syncPollDelay(1)).toBe(SYNC_POLL_MS * 2);
        expect(syncPollDelay(3)).toBe(SYNC_POLL_MS * 8);
        expect(syncPollDelay(50)).toBe(SYNC_POLL_MAX_MS);
    });
});
