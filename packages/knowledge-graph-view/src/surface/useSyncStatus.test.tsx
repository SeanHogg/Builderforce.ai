// @vitest-environment jsdom
/** The ONE sync read: one fetch, a reset on a root switch, a failure that is said, and refresh through the same path. */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { KnowledgeGraphSource, SyncStatus } from '../types';
import { useSyncStatus } from './syncPill';

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
