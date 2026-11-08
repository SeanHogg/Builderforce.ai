/**
 * The host's sync status for a root: the ONE read of `source.syncStatus` the surface makes. The
 * pure readings built from it (pill, parity line) live in `syncPill.ts`, react-free.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeGraphSource, SyncStatus } from '../types';

/** While an upload is under way or waiting, the status is read again this often (the host pushes nothing). */
export const SYNC_POLL_MS = 2000;

export interface SyncRead {
    /** The host's report; null while absent, loading or failed. */
    status: SyncStatus | null;
    /** The last read failed (the Server tab says so instead of loading forever). */
    failed: boolean;
    /** Reads again through the same path (the Server tab's refresh): never a second fetch path. */
    refresh(): void;
}

/**
 * The host's sync status for a root: the ONE read, shared by the review action (status chip + button on the ask-bar row) and the Reviews panel (Server and Diagnostics tabs).
 * Re-read when `refreshKey` changes (a new graph landed), on `refresh()`, and every `SYNC_POLL_MS` while the replica is sending or waiting with changes and nothing has failed (uploads the person did not
 * start included); polling stops when the queue is idle and when the view unmounts. A new root starts from nothing, never from the last root's status.
 */
export function useSyncStatus(source: KnowledgeGraphSource, rootId: string | null, refreshKey: unknown): SyncRead {
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [failed, setFailed] = useState(false);
    const [again, setAgain] = useState(0);
    const read = source.syncStatus;
    const seenRoot = useRef(rootId);
    useEffect(() => {
        // Another root must not show the last root's status while its own is on the way; a re-read of the SAME root keeps the last one.
        if (seenRoot.current !== rootId) { seenRoot.current = rootId; setStatus(null); }
        setFailed(false);
        if (!read || !rootId) { setStatus(null); return undefined; }
        let live = true;
        read.call(source, rootId).then(
            (s) => { if (live) setStatus(s); },
            () => { if (live) setFailed(true); },
        );
        return () => { live = false; };
    }, [read, source, rootId, refreshKey, again]);
    const refresh = useCallback(() => setAgain((n) => n + 1), []);
    const uploading = !!status?.replica && (status.replica.sending || (status.replica.dirty > 0 && status.replica.failed.length === 0));
    useEffect(() => {
        if (!uploading) return undefined;
        const timer = setInterval(refresh, SYNC_POLL_MS);
        return () => clearInterval(timer);
    }, [uploading, refresh]);
    return { status, failed, refresh };
}
