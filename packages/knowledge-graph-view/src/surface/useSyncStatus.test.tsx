// @vitest-environment jsdom
/** The ONE sync read: one fetch, a reset on a root switch, a failure that is said, and refresh through the same path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { KnowledgeGraphSource, SyncStatus } from '../types';
import { SYNC_POLL_MS, useSyncStatus } from './useSyncStatus';

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
});
