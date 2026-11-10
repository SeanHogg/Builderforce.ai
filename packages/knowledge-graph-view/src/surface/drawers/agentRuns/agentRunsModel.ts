/**
 * The Agent runs drawer's pure model (PRD 46 §3.5): severity order and tone, the turn strip's geometry, a finding's
 * words from its kind and params, an evidence row, and the graph node a touched file is. No React, no I/O.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../../../labels';
import type { ThemeTone } from '../../../scene/themeColors';
import type { AgentRunEvidence, AgentRunFinding, AgentRunSeverity, AgentRunSummary, AgentRunTurn, AgentRunTurnKind } from '../../../types';

type Words = KnowledgeGraphLabels['surface']['agentRuns'];

/** Worst first. */
export const SEVERITY_ORDER: readonly AgentRunSeverity[] = ['error', 'warn', 'info'];

export const SEVERITY_TONE: Readonly<Record<AgentRunSeverity, ThemeTone>> = { error: 'sev5', warn: 'sev3', info: 'accent' };

/** The legend's order and each turn kind's fill. */
export const TURN_KINDS: readonly AgentRunTurnKind[] = ['read', 'write', 'forced', 'text', 'failed'];
export const TURN_TONE: Readonly<Record<AgentRunTurnKind, ThemeTone>> = { read: 'line3', write: 'sev1', forced: 'sev3', text: 'muted', failed: 'sev5' };

/** Findings worst first; a stable order inside one severity (the host's own). */
export function sortFindings(findings: readonly AgentRunFinding[]): AgentRunFinding[] {
    return findings.map((f, i) => ({ f, i }))
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity) || a.i - b.i)
        .map((x) => x.f);
}

export interface StripBar { turn: AgentRunTurn; x: number; y: number; width: number; height: number }

/**
 * One bar per turn, left to right, height ∝ prompt tokens (the largest fills `height`; a turn with any prompt is at
 * least `minBar` tall so it stays visible). Bars share `width` evenly with `gap` between them.
 */
export function stripGeometry(turns: readonly AgentRunTurn[], width: number, height: number, gap = 1, minBar = 2): StripBar[] {
    if (turns.length === 0) return [];
    const max = Math.max(0, ...turns.map((t) => t.promptTokens));
    const barWidth = Math.max(1, (width - gap * (turns.length - 1)) / turns.length);
    return turns.map((turn, i) => {
        const h = max > 0 ? Math.max(turn.promptTokens > 0 ? minBar : 0, (turn.promptTokens / max) * height) : 0;
        return { turn, x: i * (barWidth + gap), y: height - h, width: barWidth, height: h };
    });
}

/** A param as shown: whole numbers grouped, fractions to one decimal, text as sent. */
export function formatParam(v: string | number): string {
    if (typeof v === 'string') return v;
    return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1);
}

/** A finding's title and description in the viewer's words; a kind this build has no words for shows its id. */
export function findingText(f: AgentRunFinding, t: Words): { title: string; description: string } {
    const words = (t.findings as Record<string, { title: string; description: string } | undefined>)[f.kind];
    if (!words) return { title: f.kind, description: '' };
    const params = Object.fromEntries(Object.entries(f.params).map(([k, v]) => [k, formatParam(v)]));
    return { title: words.title, description: fillTemplate(words.description, params) };
}

export function evidenceText(e: AgentRunEvidence, t: Words): string {
    return fillTemplate(t.evidenceRow, { turn: e.turn, label: e.label });
}

/** One bar's accessible title. */
export function turnTitle(turn: AgentRunTurn, t: Words): string {
    return fillTemplate(t.stripBar, {
        index: turn.index, role: turn.role, model: turn.model, kind: t.turnKinds[turn.kind],
        prompt: formatParam(turn.promptTokens), completion: formatParam(turn.completionTokens), tools: turn.toolCalls,
        seconds: formatParam(Math.round(turn.durationMs / 100) / 10),
    });
}

export function runMeta(run: AgentRunSummary, t: Words): string {
    return fillTemplate(t.runMeta, { turns: run.turns, models: run.models.join(', ') });
}

export function runCounts(run: AgentRunSummary, t: Words): string {
    return fillTemplate(t.runCounts, { error: run.counts.error, warn: run.counts.warn, info: run.counts.info });
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * The graph's file node for a path the run touched: the node whose root-relative path equals it, or — for an absolute
 * or differently rooted path — the longest node path it ends with. Undefined when the graph has no such file.
 */
export function fileRefFor(graph: KnowledgeGraph, path: string): string | undefined {
    const want = norm(path);
    let best: { ref: string; len: number } | undefined;
    for (const n of graph.nodes) {
        if (n.kind !== 'file') continue;
        const own = pathOf(n.ref);
        if (!own) continue;
        const p = norm(own);
        if (p === want) return n.ref;
        if (want.endsWith(`/${p}`) && (!best || p.length > best.len)) best = { ref: n.ref, len: p.length };
    }
    return best?.ref;
}
