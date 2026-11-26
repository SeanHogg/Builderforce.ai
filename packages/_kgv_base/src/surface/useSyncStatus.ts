/**
 * The host's sync status for a root: the ONE read of `source.syncStatus` the surface makes. The
 * pure readings built from it (pill, parity line) live in `syncPill.ts`, react-free.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeGraphSource, SyncStatus } from '../types';

/** While an upload is under way or waiting, the status is read again this often (the host pushes nothing). */
export const SYNC_POLL_MS = 2000;
/** The longest a backed-off poll waits: a queue that is not moving (offline, or reads failing) is read at most this often. */
export const SYNC_POLL_MAX_MS = 60_000;

/** The wait before the next poll after `misses` reads in a row that showed no progress (failed, or dirty but not sending). */
export function syncPollDelay(misses: number): number {
    return Math.min(SYNC_POLL_MAX_MS, SYNC_POLL_MS * 2 ** Math.max(0, misses));
}

/** The replica is sending, or waiting with changes and nothing has failed. */
export function isUploading(status: SyncStatus | null): boolean {
    const replica = status?.replica;
    return !!replica && (replica.sending || (replica.dirty > 0 && replica.failed.length === 0));
}

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
 * Re-read when `refreshKey` changes (a new graph landed), on `refresh()`, and while the replica is sending or waiting with changes and nothing has failed (uploads the person did not
 * start included). A sending queue is read every `SYNC_POLL_MS`; a queue that is dirty but not sending, or a read that FAILED while it was uploading, backs off exponentially up to
 * `SYNC_POLL_MAX_MS`. A failed read clears the status (it is stale). Polling pauses while the page is hidden and resumes, from the short interval, when it is shown again.
 * Polling stops when the queue is idle and when the view unmounts. A new root starts from nothing, never from the last root's status.
 */
export function useSyncStatus(source: KnowledgeGraphSource, rootId: string | null, refreshKey: unknown): SyncRead {
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [failed, setFailed] = useState(false);
    const [again, setAgain] = useState(0);
    /** Bumped when a read settles: the poll scheduler runs after each one. */
    const [settled, setSettled] = useState(0);
    const read = source.syncStatus;
    const seenRoot = useRef(rootId);
    /** Reads in a row that showed no progress; the backoff exponent. */
    const misses = useRef(0);
    /** The last good read was uploading: keep polling (backed off) through failed reads. */
    const polling = useRef(false);
    /** The read under way was the poll's own, not a person's refresh or a new graph. */
    const byPoll = useRef(false);
    useEffect(() => {
        // Another root must not show the last root's status while its own is on the way; a re-read of the SAME root keeps the last one.
        if (seenRoot.current !== rootId) { seenRoot.current = rootId; setStatus(null); polling.current = false; }
        const poll = byPoll.current;
        byPoll.current = false;
        // A person's refresh or a new graph starts from the short interval and says nothing failed yet.
        if (!poll) { misses.current = 0; setFailed(false); }
        if (!read || !rootId) { setStatus(null); polling.current = false; return undefined; }
        let live = true;
        read.call(source, rootId).then(
            (s) => {
                if (!live) return;
                setStatus(s);
                setFailed(false);
                polling.current = isUploading(s);
                misses.current = s.replica?.sending ? 0 : misses.current + (poll ? 1 : 0);
                setSettled((n) => n + 1);
            },
            () => {
                if (!live) return;
                setStatus(null);
                setFailed(true);
                misses.current += 1;
                setSettled((n) => n + 1);
            },
        );
        return () => { live = false; };
    }, [read, source, rootId, refreshKey, again]);
    const refresh = useCallback(() => setAgain((n) => n + 1), []);
    /** The pending poll, so a read started by the page becoming visible cancels it (one read, not two). */
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!polling.current) return undefined;
        const timer = setTimeout(() => {
            pollTimer.current = null;
            if (typeof document !== 'undefined' && document.hidden) return; // resumed by `visibilitychange`
            byPoll.current = true;
            setAgain((n) => n + 1);
        }, syncPollDelay(misses.current));
        pollTimer.current = timer;
        return () => {
            clearTimeout(timer);
            if (pollTimer.current === timer) pollTimer.current = null;
        };
    }, [settled]);
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const onVisible = () => {
            if (document.hidden || !polling.current) return;
            if (pollTimer.current !== null) { clearTimeout(pollTimer.current); pollTimer.current = null; }
            misses.current = 0;
            byPoll.current = true;
            setAgain((n) => n + 1);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);
    return { status, failed, refresh };
}
