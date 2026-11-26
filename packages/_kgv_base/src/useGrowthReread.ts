/**
 * The open root grows while it is being reviewed: on a progress event that advanced, re-read it refocus-style (the picture
 * stays). The done path does the final load.
 *
 * A re-read lands only if nothing newer started meanwhile (`growSeq`: any load, a finished review or a source swap bumps it)
 * AND the review of THIS root is still running (`growing`). The re-read goes through the ONE `settledThrottle`
 * (`@builderforce/knowledge-client/settledThrottle`): it never overlaps itself (a build longer than the window would
 * otherwise be aborted by the next one, forever), the window runs from when the previous re-read SETTLED, and a progress tick
 * during a re-read yields ONE trailing re-read, with the latest progress.
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { settledThrottle, SKIPPED, type SettledThrottle } from '@builderforce/knowledge-client/settledThrottle';
import type { ReviewRun } from './useReviewRun';
import { isNotReviewedHere, type KnowledgeGraphSource } from './types';

/**
 * The least time between two re-reads of a graph that a running review is growing: the same window as the host's whole-graph
 * live refresh (`FULL_REFRESH_MIN_MS`).
 */
export const GROW_INTERVAL_MS = 30_000;

export interface GrowthReread {
    held: unknown;
    source: KnowledgeGraphSource;
    review: ReviewRun;
    paint(g: KnowledgeGraph | null): void;
    /** The root whose review is growing it now; the view clears it when a review finishes. */
    growing: MutableRefObject<string | null>;
    growSeq: MutableRefObject<number>;
    pendingLoad: MutableRefObject<unknown>;
    rootIdRef: MutableRefObject<string | null>;
    loadFocusRef: MutableRefObject<string[] | undefined>;
    setStale(v: boolean): void;
    setRefreshFailed(v: boolean): void;
    setReady(): void;
}

export function useGrowthReread(a: GrowthReread): void {
    const { held, source, review, paint, growing, growSeq, pendingLoad, rootIdRef, loadFocusRef, setStale, setRefreshFailed, setReady } = a;
    const grown = useRef<{ phase: string; done: number }>({ phase: '', done: -1 });
    const growTask = useRef<() => Promise<unknown>>(async () => SKIPPED);
    const growThrottle = useRef<SettledThrottle | null>(null);
    useEffect(() => {
        const throttle = settledThrottle(() => growTask.current(), GROW_INTERVAL_MS, { leading: true });
        growThrottle.current = throttle;
        return () => { throttle.dispose(); growThrottle.current = null; };
    }, []);
    const reviewState = review.state;
    const reviewRoot = review.rootId;
    useEffect(() => {
        const root = rootIdRef.current;
        if (held || reviewState.status !== 'running' || !root || !reviewRoot || reviewRoot !== root) {
            growing.current = null;
            if (reviewState.status !== 'running') grown.current = { phase: '', done: -1 };
            return;
        }
        growing.current = root;
        const p = reviewState.progress;
        if (!p) return;
        const last = grown.current;
        if (p.phase === last.phase && p.done <= last.done) return;
        growTask.current = async () => {
            // Nothing to grow once the review of this root is over; the root load in flight lands first (the next tick re-reads).
            // (SKIPPED: nothing was read, so the window stays open for the next tick.)
            if (growing.current !== root || pendingLoad.current) return SKIPPED;
            grown.current = { phase: p.phase, done: p.done };
            const seq = growSeq.current;
            const focus = loadFocusRef.current;
            try {
                const g = await source.load(root, focus ? { focus } : undefined);
                if (!g || isNotReviewedHere(g) || growSeq.current !== seq || growing.current !== root || rootIdRef.current !== root) return undefined;
                paint(g); setStale(false); setRefreshFailed(false); setReady();
            } catch {
                // A re-read that something newer superseded (a load, a finished review, another root) is not a failure; one that failed
                // while still current is reported as the view reports any failed refresh, and the next successful read clears it.
                if (growSeq.current === seq && growing.current === root && rootIdRef.current === root) setRefreshFailed(true);
            }
            return undefined;
        };
        growThrottle.current?.request();
    }, [held, reviewState, reviewRoot, source, paint]); // eslint-disable-line react-hooks/exhaustive-deps
}
