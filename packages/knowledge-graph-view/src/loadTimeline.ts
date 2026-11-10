/**
 * The view's side of first-load triage: when each call the first paint waits on was asked and
 * answered (`lastSeen`, `scopes`, every `load`, `baseline`), relative to the view's mount, and when
 * the first picture landed and from what (the last-seen cache, or a fresh load). `timedSource`
 * records them by wrapping the source once, so `useKnowledgeGraph` is untouched; the wrapper keeps
 * every other member of the source (it inherits from it). Read by the Diagnostics' First load section.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { isNotReviewedHere, type KnowledgeGraphSource } from './types';

export type TimedCall = 'lastSeen' | 'scopes' | 'load' | 'baseline';
/** `miss`: the call answered nothing (no last-seen graph, no baseline, no graph). */
export type TimedOutcome = 'ok' | 'miss' | 'not-here' | 'error';

export interface TimelineMark {
    call: TimedCall;
    rootId?: string;
    focus?: boolean;
    /** Ms since mount. */
    startMs: number;
    /** Ms since mount; absent while the call runs. */
    endMs?: number;
    outcome?: TimedOutcome;
    error?: string;
    nodes?: number;
    edges?: number;
    /** Scopes answered. */
    count?: number;
}

export interface LoadTimelineSnapshot {
    /** Ms since mount, now. */
    nowMs: number;
    marks: TimelineMark[];
    /** When the first screen past loading was drawn, and what it was. */
    firstPaint?: { ms: number; from: PaintSource };
    /** When a fresh graph (not the last-seen one) was first drawn. */
    freshMs?: number;
}

/** What the first settled screen was: a graph (the last-seen one, a fresh load, a held snapshot) or a screen without one. */
export type PaintSource = 'lastSeen' | 'fresh' | 'snapshot' | 'empty' | 'not-here' | 'load-failed' | 'error';

export interface LoadTimeline {
    /** Opens a mark; the returned function closes it. */
    begin(call: TimedCall, info?: Pick<TimelineMark, 'rootId' | 'focus'>): (end: Pick<TimelineMark, 'outcome' | 'error' | 'nodes' | 'edges' | 'count'>) => void;
    /** The view settled on a screen; the first one is kept, and the first fresh graph. */
    painted(from: PaintSource): void;
    snapshot(): LoadTimelineSnapshot;
}

/** Marks kept (a review's growth re-reads add one each; the oldest go first, the first ones are kept). */
export const TIMELINE_MARKS = 40;
const FIRST_KEPT = 8;

export function createLoadTimeline(now: () => number = () => performance.now()): LoadTimeline {
    const t0 = now();
    const at = (): number => Math.round(now() - t0);
    const marks: TimelineMark[] = [];
    let firstPaint: LoadTimelineSnapshot['firstPaint'];
    let freshMs: number | undefined;
    return {
        begin(call, info = {}) {
            const mark: TimelineMark = { call, startMs: at(), ...(info.rootId ? { rootId: info.rootId } : {}), ...(info.focus ? { focus: true } : {}) };
            marks.push(mark);
            // The first calls are the first load: they stay; the middle is dropped when the list is full.
            if (marks.length > TIMELINE_MARKS) marks.splice(FIRST_KEPT, 1);
            return (end) => {
                if (mark.endMs !== undefined) return;
                Object.assign(mark, { endMs: at() }, Object.fromEntries(Object.entries(end).filter(([, v]) => v !== undefined)));
            };
        },
        painted(from) {
            const ms = at();
            firstPaint ??= { ms, from };
            if (from === 'fresh' || from === 'snapshot') freshMs ??= ms;
        },
        snapshot: () => ({
            nowMs: at(), marks: marks.map((m) => ({ ...m })),
            ...(firstPaint ? { firstPaint: { ...firstPaint } } : {}), ...(freshMs !== undefined ? { freshMs } : {}),
        }),
    };
}

const counts = (g: KnowledgeGraph) => ({ nodes: g.nodes.length, edges: g.edges.length });
const errorOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Times one async call: the mark closes with `describe`'s fields, or with the error (which is rethrown). */
async function timed<T>(timeline: LoadTimeline, call: TimedCall, info: Pick<TimelineMark, 'rootId' | 'focus'>, run: () => Promise<T>, describe: (v: T) => Pick<TimelineMark, 'outcome' | 'nodes' | 'edges' | 'count'>): Promise<T> {
    const end = timeline.begin(call, info);
    try {
        const v = await run();
        end(describe(v));
        return v;
    } catch (error) {
        end({ outcome: 'error', error: errorOf(error) });
        throw error;
    }
}

/**
 * The source with `lastSeen`, `scopes`, `load` and `baseline` timed into `timeline`. Every other member
 * (and `snapshot`) is the source's own, read through the prototype. Create it ONCE per source (memoised on
 * the source's identity): a new wrapper is a new source to `useKnowledgeGraph`, which resets the view.
 */
export function timedSource(source: KnowledgeGraphSource, timeline: LoadTimeline): KnowledgeGraphSource {
    const out = Object.create(source) as KnowledgeGraphSource;
    out.scopes = () => timed(timeline, 'scopes', {}, () => source.scopes(), (rows) => ({ outcome: 'ok', count: rows.length }));
    out.load = (rootId, opts) => timed(timeline, 'load', { rootId, ...(opts?.focus ? { focus: true } : {}) }, () => source.load(rootId, opts), (g) => (
        !g ? { outcome: 'miss' } : isNotReviewedHere(g) ? { outcome: 'not-here' } : { outcome: 'ok', ...counts(g) }
    ));
    if (source.lastSeen) {
        const lastSeen = source.lastSeen.bind(source);
        out.lastSeen = () => timed(timeline, 'lastSeen', {}, lastSeen, (seen) => (seen ? { outcome: 'ok', ...counts(seen.graph) } : { outcome: 'miss' }));
    }
    if (source.baseline) {
        const baseline = source.baseline.bind(source);
        out.baseline = (rootId) => timed(timeline, 'baseline', { rootId }, () => baseline(rootId), (b) => (b ? { outcome: 'ok', ...counts(b.graph) } : { outcome: 'miss' }));
    }
    return out;
}
