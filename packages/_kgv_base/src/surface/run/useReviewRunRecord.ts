/**
 * The Run panel's data (PRD 41 A8): the live run record from the host's `run` events (the latest one,
 * whichever review writes it), the root's past runs, and a past run opened frozen.
 *
 * The live record is subscribed for as long as the view lives, so the panel opens on a run already
 * underway; the history is read only while the panel is open, and again when a run ends.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeGraphSource, ReviewRunSummary, StoredReviewRun } from '../../types';
import type { ReviewRun as ReviewMachine } from '../../useReviewRun';
import { failureCountOf } from './runModel';

export interface RunHistoryRead {
    runs: ReviewRunSummary[];
    loading: boolean;
    failed: boolean;
}

export interface RunRecordRead {
    /** The latest run the host reported; null before any. */
    live: StoredReviewRun | null;
    history: RunHistoryRead;
    /** A past run picked from the history, shown frozen; null = the live run is shown. */
    opened: StoredReviewRun | null;
    /** A past run could not be opened (the host no longer holds it). */
    openFailed: boolean;
    open(runId: string): void;
    close(): void;
}

/** What the Run drawer is handed: the run data, and the review state machine (Stop, and what phase the confirm is at). */
export interface RunPanelData {
    read: RunRecordRead;
    review: ReviewMachine;
}

export function useReviewRunRecord(source: KnowledgeGraphSource, rootId: string | null, panelOpen: boolean): RunRecordRead {
    const runs = source.runs;
    const [latest, setLive] = useState<StoredReviewRun | null>(null);
    // Only this folder's run: a review of another folder does not become this panel's run.
    const live = latest && (rootId === null || latest.root === rootId) ? latest : null;
    const [history, setHistory] = useState<RunHistoryRead>({ runs: [], loading: false, failed: false });
    const [opened, setOpened] = useState<StoredReviewRun | null>(null);
    const [openFailed, setOpenFailed] = useState(false);
    const asked = useRef(0);

    useEffect(() => runs?.subscribe(setLive), [runs]);

    // A new run starts or the folder changes: any frozen run is put away.
    const liveId = live?.id;
    useEffect(() => { setOpened(null); setOpenFailed(false); }, [liveId, rootId]);

    // A live event carries only the latest failures: once the run has ended, the whole record (kept before it was posted) replaces it.
    const truncated = !!live && live.endedAt !== undefined && failureCountOf(live) > live.failures.length;
    useEffect(() => {
        if (!runs || !liveId || !truncated) return undefined;
        let current = true;
        runs.get(liveId).then(
            (full) => { if (current && full) setLive((prev) => (prev?.id === full.id ? full : prev)); },
            () => undefined,
        );
        return () => { current = false; };
    }, [runs, liveId, truncated]);

    // The history is read while the panel is open, and again when the live run ends (it was just kept).
    const endedAt = live?.endedAt;
    useEffect(() => {
        if (!runs || !rootId || !panelOpen) return undefined;
        const ask = ++asked.current;
        setHistory((h) => ({ ...h, loading: true, failed: false }));
        runs.list(rootId).then(
            (list) => { if (asked.current === ask) setHistory({ runs: list, loading: false, failed: false }); },
            () => { if (asked.current === ask) setHistory({ runs: [], loading: false, failed: true }); },
        );
        return () => { asked.current += 1; };
    }, [runs, rootId, panelOpen, endedAt]);

    const open = useCallback((runId: string) => {
        if (!runs) return;
        setOpenFailed(false);
        runs.get(runId).then(
            (run) => { if (run) setOpened(run); else setOpenFailed(true); },
            () => setOpenFailed(true),
        );
    }, [runs]);
    const close = useCallback(() => { setOpened(null); setOpenFailed(false); }, []);

    return { live, history, opened, openFailed, open, close };
}
