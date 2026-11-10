/**
 * The view's first-load triage hooks: the timed source (`loadTimeline.ts`, wrapped ONCE per source
 * identity so `useKnowledgeGraph` never sees a new source on a rerender), the first settled screen,
 * and the host's trace (`KnowledgeGraphSource.loadTrace`) — read every second while a load runs (the
 * loading screen names its phase), then once as it ends and once a little later (the host's
 * after-load write lands after the answer). A refresh that failed is not a running load: the poll stops.
 */

import { useEffect, useRef, useState } from 'react';
import { createLoadTimeline, timedSource, type LoadTimeline, type PaintSource } from './loadTimeline';
import type { LoadTrace } from './loadTraceTypes';
import type { KnowledgeGraphSource } from './types';
import type { GraphStatus } from './useKnowledgeGraph';

export const TRACE_POLL_MS = 1000;
/** After a load ends, the trace is read again this much later. */
export const TRACE_SETTLE_MS = 3000;

/** The source, timed into a timeline; both stable for one source identity. */
export function useTimedSource(source: KnowledgeGraphSource): { source: KnowledgeGraphSource; timeline: LoadTimeline } {
    const held = useRef<{ of: KnowledgeGraphSource; source: KnowledgeGraphSource; timeline: LoadTimeline } | null>(null);
    if (!held.current || held.current.of !== source) {
        const timeline = createLoadTimeline();
        held.current = { of: source, source: timedSource(source, timeline), timeline };
    }
    return { source: held.current.source, timeline: held.current.timeline };
}

/** A load is running: the first read, or a refresh of a drawn graph that has not failed (`refreshFailed` leaves `stale` set). */
export function loadRunning(status: GraphStatus, stale: boolean, refreshFailed: boolean): boolean {
    return status === 'loading' || (stale && !refreshFailed);
}

/** Which screen a settled status is (null while loading). */
export function paintOf(status: GraphStatus, stale: boolean, snapshot: boolean): PaintSource | null {
    if (status === 'loading') return null;
    if (status !== 'ready') return status;
    return snapshot ? 'snapshot' : stale ? 'lastSeen' : 'fresh';
}

export function useFirstPaint(timeline: LoadTimeline, status: GraphStatus, stale: boolean, snapshot: boolean): void {
    useEffect(() => {
        const from = paintOf(status, stale, snapshot);
        if (from) timeline.painted(from);
    }, [timeline, status, stale, snapshot]);
}

/** The phase the host's running load of `rootId` (else any running load) has been in longest; undefined when none is running. */
export function currentLoadPhase(trace: LoadTrace | null, rootId: string | null): string | undefined {
    const loads = trace?.inFlight.filter((f) => f.op === 'load') ?? [];
    const load = loads.find((f) => f.rootId === rootId) ?? loads[0];
    return load?.phases.reduce<{ phase: string; startedAt: number } | undefined>((a, p) => (!a || p.startedAt < a.startedAt ? p : a), undefined)?.phase;
}

/** A read the host never answers is given up after this long, so the next tick reads again. */
export const TRACE_READ_TIMEOUT_MS = 5000;

/** What a reader of the trace can see change: the entries and in-flight calls with their phases (not the host's `now`, which moves on every answer). */
export function traceSignature(t: LoadTrace): string {
    const entries = t.entries.map((e) => `${e.op}|${e.rootId ?? ''}|${e.startedAt}|${e.durationMs}|${e.outcome}|${e.phases.map((p) => `${p.phase}:${p.ms}`).join(',')}`);
    const inFlight = t.inFlight.map((f) => `${f.op}|${f.rootId ?? ''}|${f.startedAt}|${f.phases.map((p) => `${p.phase}:${p.startedAt}`).join(',')}`);
    return `${entries.join(';')}#${inFlight.join(';')}`;
}

export interface HostLoadTrace {
    /** The host's trace as last changed; null until read, or when the host reports none. Re-renders only when it changes. */
    trace: LoadTrace | null;
    /** The latest answer (its `now` is current, so in-flight ages are), read on demand: Diagnostics take it when copied. */
    latest(): LoadTrace | null;
}

/**
 * The host's trace, read every second while `active` (a load is running) and once a little after it
 * ends. An answer that changes nothing a reader sees sets no state, so an idle poll re-renders
 * nothing; a read the host never settles is dropped after {@link TRACE_READ_TIMEOUT_MS}.
 */
export function useHostLoadTrace(source: KnowledgeGraphSource, active: boolean): HostLoadTrace {
    const [trace, setTrace] = useState<{ of: KnowledgeGraphSource; trace: LoadTrace } | null>(null);
    const latestRef = useRef<{ of: KnowledgeGraphSource; trace: LoadTrace; signature: string } | null>(null);
    useEffect(() => {
        if (!source.loadTrace) return undefined;
        let live = true;
        let reading = 0; // the read in progress (0: none); a timed-out read's late answer is ignored
        let reads = 0;
        let giveUp: ReturnType<typeof setTimeout> | undefined;
        const read = (): void => {
            if (reading) return;
            const id = ++reads;
            reading = id;
            giveUp = setTimeout(() => { if (reading === id) reading = 0; }, TRACE_READ_TIMEOUT_MS);
            source.loadTrace!().then((t) => {
                if (!live || reading !== id) return;
                const signature = traceSignature(t);
                const prior = latestRef.current;
                latestRef.current = { of: source, trace: t, signature };
                if (!prior || prior.of !== source || prior.signature !== signature) setTrace({ of: source, trace: t });
            }, () => undefined).finally(() => {
                if (reading === id) { reading = 0; clearTimeout(giveUp); }
            });
        };
        read();
        const poll = active ? setInterval(read, TRACE_POLL_MS) : undefined;
        const settle = active ? undefined : setTimeout(read, TRACE_SETTLE_MS);
        return () => { live = false; clearInterval(poll); clearTimeout(settle); clearTimeout(giveUp); };
    }, [source, active]);
    return {
        trace: trace && trace.of === source ? trace.trace : null,
        latest: () => (latestRef.current && latestRef.current.of === source ? latestRef.current.trace : null),
    };
}
