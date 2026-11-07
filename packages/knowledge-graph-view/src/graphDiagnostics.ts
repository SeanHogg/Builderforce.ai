/**
 * The graph view as plain text for a bug or improvement report — what *Copy diagnostics* puts
 * on the clipboard. PURE (the caller supplies the time) and English on purpose, like
 * `reviewDiagnostics.ts`: it is read by whoever triages the report, not by the person who
 * copied it. Counts are `k=v` pairs sorted by key, so equal input gives equal text.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from './order';
import { reviewDiagnosticsText } from './reviewDiagnostics';
import type { ReviewState } from './useReviewRun';
import { surfaceDiagnosticLines, type SurfaceDiagnosticsInput } from './surfaceDiagnostics';
import type { LensId, StoredReviewRun, ViewMode } from './types';
import { runDiagnosticLines } from './surface/run/runDiagnostics';

export interface GraphDiagnosticsInput {
    status: string;
    rootId: string | null;
    graph: KnowledgeGraph | null;
    /** What is on screen after focus and the lens. */
    drawn: { nodes: number; edges: number } | null;
    /** The compact "Show all" has been pressed. */
    showAll: boolean;
    webgl: boolean;
    reducedMotion: boolean;
    mode: ViewMode;
    width: number;
    compact: boolean;
    lens: LensId;
    review: ReviewState;
    lastPhase?: string | undefined;
    /** The surface's facts (map source, data coverage, lines, scope, sync, findings); absent ⇒ that section is left out. */
    surface?: SurfaceDiagnosticsInput | undefined;
    /** The latest review run the host reported (PRD 41 A8); absent ⇒ no run line. */
    run?: StoredReviewRun | null | undefined;
    /** ISO time. */
    time: string;
}

const yn = (v: boolean): string => (v ? 'yes' : 'no');

/** `k=v, k=v` over the counted values of `keys`, sorted by key; `none` when empty. */
function counts(keys: Iterable<string>): string {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return m.size ? [...m.entries()].sort(([a], [b]) => cmp(a, b)).map(([k, n]) => `${k}=${n}`).join(', ') : 'none';
}

/** Why fewer nodes are drawn than the graph holds. */
export function truncationReasons(graph: KnowledgeGraph, drawnNodes: number, compact: boolean, showAll: boolean): string[] {
    const reasons: string[] = [];
    if (drawnNodes < graph.nodes.length) reasons.push(compact && !showAll ? 'compact focus (top nodes only)' : 'max drawn nodes');
    if (graph.stats.truncated) reasons.push('graph truncated by the server');
    return reasons;
}

export function graphDiagnosticsText(i: GraphDiagnosticsInput): string {
    const g = i.graph;
    const s = i.review;
    const lines: string[] = ['Knowledge graph diagnostics', `status: ${i.status}`];
    if (i.rootId) lines.push(`root: ${i.rootId}`);
    if (g) {
        lines.push(`packs: ${[...g.scope.packs].sort(cmp).join(', ') || 'none'}`);
        lines.push(`stats: nodes=${g.stats.nodes} edges=${g.stats.edges} sources=${g.stats.sources}`);
        const drawn = i.drawn ?? { nodes: g.nodes.length, edges: g.edges.length };
        const reasons = truncationReasons(g, drawn.nodes, i.compact, i.showAll);
        lines.push(`drawn: nodes=${drawn.nodes}/${g.nodes.length} edges=${drawn.edges}/${g.edges.length} · truncated: ${yn(reasons.length > 0)}`);
        if (reasons.length) lines.push(`truncation reason: ${reasons.join('; ')}`);
    }
    lines.push(`webgl: ${yn(i.webgl)} · reduced-motion: ${yn(i.reducedMotion)} · view: ${i.mode}`);
    lines.push(`container: width=${Math.round(i.width)} compact=${yn(i.compact)}`);
    if (g) {
        lines.push(`nodes by kind: ${counts(g.nodes.map((n) => n.kind))}`);
        lines.push(`edges by kind: ${counts(g.edges.map((e) => e.kind))}`);
        lines.push(`edges by origin: ${counts(g.edges.map((e) => e.origin))}`);
        lines.push(`findings by kind: ${counts(g.findings.map((f) => f.kind))}`);
        const parts = [...new Set(g.nodes.flatMap((n) => (n.partition ? [n.partition] : [])))].sort(cmp);
        lines.push(`partitions: ${parts.join(', ') || 'none'}`);
    }
    lines.push(`lens: ${i.lens}`);
    lines.push(`review: ${s.status}${s.status === 'running' && s.progress ? ` (${s.progress.phase} ${s.progress.done}/${s.progress.total})` : ''}${i.lastPhase ? ` · last phase ${i.lastPhase}` : ''}`);
    if (s.status === 'done') {
        const r = s.report;
        const perSecond = r.durationMs > 0 ? (r.extracted / (r.durationMs / 1000)).toFixed(1) : 'n/a';
        lines.push(`report: extracted=${r.extracted} judged=${r.judged} readErrors=${r.readErrors} duration=${r.durationMs}ms files/s=${perSecond}`);
    }
    if (i.run) lines.push(...runDiagnosticLines(i.run));
    if (i.surface) lines.push(...surfaceDiagnosticLines(i.surface));
    lines.push(`time: ${i.time}`);
    if (s.status === 'error') lines.push('', reviewDiagnosticsText(s));
    return lines.join('\n');
}
