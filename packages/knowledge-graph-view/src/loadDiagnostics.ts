/**
 * The Diagnostics' First load section: where the time before the first picture went. The view's own
 * timeline (`loadTimeline.ts`: each call it made, ms since mount) and the host's trace
 * (`KnowledgeGraphSource.loadTrace`: each call's phases, the phase a running load is in and for how
 * long, the host's event-loop lag). PURE and English on purpose, like the rest of the diagnostics.
 */

import type { DiagnosticSection } from './diagnosticSection';
import type { LoadTimelineSnapshot, TimelineMark } from './loadTimeline';
import type { LoadTrace, LoadTraceEntry, LoadTraceLag } from './loadTraceTypes';

export interface LoadDiagnosticsInput {
    timeline: LoadTimelineSnapshot;
    /** The host's trace; null ⇒ not read yet, absent ⇒ this host reports none. */
    host?: LoadTrace | null | undefined;
}

/** A first paint (or a call still running) slower than this asks to be looked at. */
export const SLOW_LOAD_MS = 10_000;
/** Host calls listed, newest last. */
const HOST_ENTRIES = 10;

const ms = (n: number): string => `${Math.round(n)}ms`;
const lagText = (l: LoadTraceLag): string => `lag max=${ms(l.maxMs)} p99=${ms(l.p99Ms)}`;

function markLine(m: TimelineMark, nowMs: number): string {
    const parts = [`+${ms(m.startMs)}`];
    if (m.rootId) parts.push(`root=${m.rootId}`);
    if (m.focus) parts.push('focus');
    if (m.endMs === undefined) parts.push(`running ${ms(nowMs - m.startMs)}`);
    else parts.push(ms(m.endMs - m.startMs), m.outcome ?? 'ok');
    if (m.error) parts.push(`error=${m.error}`);
    if (m.nodes !== undefined) parts.push(`nodes=${m.nodes} edges=${m.edges ?? 0}`);
    if (m.count !== undefined) parts.push(`count=${m.count}`);
    return `view ${m.call}: ${parts.join(' · ')}`;
}

function entryLine(e: LoadTraceEntry): string {
    const parts: string[] = [];
    if (e.rootId) parts.push(`root=${e.rootId}`);
    parts.push(ms(e.durationMs), e.outcome);
    if (e.error) parts.push(`error=${e.error}`);
    if (e.via) parts.push(`via=${e.via}`);
    if (e.phases.length) parts.push(e.phases.map((p) => `${p.phase}=${ms(p.ms)}`).join(' '));
    if (e.nodes !== undefined) parts.push(`nodes=${e.nodes} edges=${e.edges ?? 0} sources=${e.sources ?? 0}${e.truncated ? ' truncated' : ''}`);
    if (e.count !== undefined) parts.push(`count=${e.count}`);
    if (e.nearDuplicates !== undefined) parts.push(`nearDuplicates=${e.nearDuplicates}`);
    if (e.focus !== undefined) parts.push(`focus=${e.focus ? 'yes' : 'no'}`);
    if (e.maxNodes !== undefined) parts.push(`maxNodes=${e.maxNodes}`);
    if (e.hostLag) parts.push(lagText(e.hostLag));
    return `host ${e.op}: ${parts.join(' · ')}`;
}

export function loadDiagnosticSection({ timeline: t, host }: LoadDiagnosticsInput): DiagnosticSection {
    const lines: string[] = [];
    lines.push(t.firstPaint ? `first paint: ${ms(t.firstPaint.ms)} from ${t.firstPaint.from}` : `first paint: not yet (${ms(t.nowMs)} since open)`);
    lines.push(`fresh graph: ${t.freshMs !== undefined ? ms(t.freshMs) : 'not yet'}`);
    for (const m of t.marks) lines.push(markLine(m, t.nowMs));
    let stuck = false;
    if (host === undefined) lines.push('host trace: not reported by this host');
    else if (host === null) lines.push('host trace: not read yet');
    else {
        for (const e of host.entries.slice(-HOST_ENTRIES)) lines.push(entryLine(e));
        for (const f of host.inFlight) {
            const age = host.now - f.startedAt;
            if (age > SLOW_LOAD_MS) stuck = true;
            const phases = f.phases.map((p) => `in ${p.phase} for ${ms(host.now - p.startedAt)}`).join(', ') || 'between phases';
            lines.push(`host running: ${[f.op, ...(f.rootId ? [`root=${f.rootId}`] : []), ms(age), phases, ...(f.hostLag ? [lagText(f.hostLag)] : [])].join(' · ')}`);
        }
    }
    const slowPaint = t.firstPaint ? t.firstPaint.ms > SLOW_LOAD_MS : t.nowMs > SLOW_LOAD_MS;
    const slowCall = t.marks.some((m) => m.endMs === undefined && t.nowMs - m.startMs > SLOW_LOAD_MS);
    return { id: 'load', lines, attention: slowPaint || slowCall || stuck };
}
