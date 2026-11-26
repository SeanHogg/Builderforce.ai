// @vitest-environment jsdom
/** Retry upload: the call returns once the upload has STARTED (it never holds a request open), the polled sync status carries the UI to the end, a refused start is said and re-enables Retry. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { KnowledgeGraphSource, SyncStatus } from '../../types';
import { SYNC_POLL_MS, useSyncStatus } from '../useSyncStatus';
import { useRetryUploadState } from './useRetryUpload';

const queue = (dirty: number, failed: number, sending = false): SyncStatus => ({
    local: { files: 3, docs: 0 }, sources: [], replica: { dirty, sending, failed: Array.from({ length: failed }, () => ({ reason: 'server error' })) },
});

/** A host whose queue is failed (4 changes) until a retry starts the upload; `set` moves the queue as the upload goes. */
function host(start: () => Promise<void> = async () => undefined) {
    let current = queue(4, 1);
    const source: KnowledgeGraphSource = {
        scopes: async () => [], load: async () => null,
        syncStatus: vi.fn(async () => current),
        retrySync: vi.fn(async () => { await start(); current = queue(4, 0, true); }),
    };
    return { source, set: (s: SyncStatus) => { current = s; } };
}

const mount = (source: KnowledgeGraphSource) => renderHook(() => {
    const sync = useSyncStatus(source, 'a', 'g');
    return { sync, retry: useRetryUploadState(source, 'a', sync.refresh) };
});

afterEach(() => vi.useRealTimers());

describe('useRetryUploadState', () => {
    it('is absent when the source has no port, and when there is no root', () => {
        const noPort = { scopes: async () => [], load: async () => null } as KnowledgeGraphSource;
        expect(renderHook(() => useRetryUploadState(noPort, 'a', () => undefined)).result.current).toBeUndefined();
        const { source } = host();
        expect(renderHook(() => useRetryUploadState(source, null, () => undefined)).result.current).toBeUndefined();
    });

    it('returns once the upload has started; the polled sync status then carries the UI to the end and polling stops', async () => {
        vi.useFakeTimers();
        const { source, set } = host();
        const { result } = mount(source);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(result.current.sync.status?.replica?.failed).toHaveLength(1); // failed: no polling yet
        const idleReads = (source.syncStatus as ReturnType<typeof vi.fn>).mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 3); });
        expect((source.syncStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBe(idleReads);

        act(() => result.current.retry!.retry());
        expect(source.retrySync).toHaveBeenCalledWith('a');
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(result.current.retry!.running).toBe(false); // the call has returned; the upload goes on
        expect(result.current.sync.status?.replica).toMatchObject({ sending: true, dirty: 4, failed: [] }); // read again when the call returned

        set(queue(2, 0, true));
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(result.current.sync.status?.replica?.dirty).toBe(2);
        set(queue(0, 0));
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(result.current.sync.status?.replica).toMatchObject({ dirty: 0, sending: false });

        const done = (source.syncStatus as ReturnType<typeof vi.fn>).mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 5); });
        expect((source.syncStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBe(done);
    });

    it('stops following when the upload fails again (the queue holds failures and nothing is sending)', async () => {
        vi.useFakeTimers();
        const { source, set } = host();
        const { result } = mount(source);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        act(() => result.current.retry!.retry());
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        set(queue(4, 1));
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS); });
        expect(result.current.sync.status?.replica?.failed).toHaveLength(1);
        const calls = (source.syncStatus as ReturnType<typeof vi.fn>).mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 4); });
        expect((source.syncStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    });

    it('says a refused start failed, re-enables Retry, and a new try clears the message', async () => {
        const { source } = host(async () => { throw new Error('could not start'); });
        const { result } = mount(source);
        await waitFor(() => expect(result.current.sync.status).not.toBeNull());

        act(() => result.current.retry!.retry());
        await waitFor(() => expect(result.current.retry!.failed).toBe(true));
        expect(result.current.retry!.running).toBe(false);

        act(() => result.current.retry!.retry());
        expect(result.current.retry!.failed).toBe(false);
    });
});
