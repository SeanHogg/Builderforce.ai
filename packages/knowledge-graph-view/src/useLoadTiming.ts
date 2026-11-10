/**
 * The view's first-load triage hooks: the timed source (`loadTimeline.ts`, wrapped ONCE per source
 * identity so `useKnowledgeGraph` never sees a new source on a rerender), the first settled screen,
 * and the host's trace (`KnowledgeGraphSource.loadTrace`) — read every second while a load runs (the
 * loading screen names its phase), then once as it ends and once a little later (the host's
 * after-load write lands after the answer).
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

/** The host's latest trace; null until read, or when the host reports none. `active`: a load is running. */
export function useHostLoadTrace(source: KnowledgeGraphSource, active: boolean): LoadTrace | null {
    const [trace, setTrace] = useState<{ of: KnowledgeGraphSource; trace: LoadTrace } | null>(null);
    useEffect(() => {
        if (!source.loadTrace) return undefined;
        let live = true;
        let reading = false;
        const read = (): void => {
            if (reading) return;
            reading = true;
            source.loadTrace!().then((t) => { if (live) setTrace({ of: source, trace: t }); }, () => undefined).finally(() => { reading = false; });
        };
        read();
        const poll = active ? setInterval(read, TRACE_POLL_MS) : undefined;
        const settle = active ? undefined : setTimeout(read, TRACE_SETTLE_MS);
        return () => { live = false; clearInterval(poll); clearTimeout(settle); };
    }, [source, active]);
    return trace && trace.of === source ? trace.trace : null;
}
