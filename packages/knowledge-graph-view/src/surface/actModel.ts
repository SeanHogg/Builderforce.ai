/**
 * What the Act rail reads, as pure functions: the (at most three) action cards ranked from the
 * scope's findings, where a finding came from (exact / analyzer / model), whether a
 * deterministic fix exists, the acceptance checks of a path, and the fixed test request. None
 * of it calls a model: every sentence is a catalog template filled from the finding's own data.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingItems, findingTitle } from '../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { PathModel } from './path';
import { codemodOf } from './codemods';
import { findingProvenance } from './scope';

/** Cards shown at most; the rest are in the findings list and the Fix queue. */
export const MAX_CARDS = 3;
/** Acceptance checks listed at most (the rest are counted). */
export const MAX_CHECKS = 6;

/** Where a finding comes from: counted from the graph (exact), measured by a tool (analyzer), or judged by a model. */
export type FindingSource = 'exact' | 'analyzer' | 'model';

const MODEL_KINDS: ReadonlySet<string> = new Set(['contradiction', 'possible-same', 'near-duplicate']);

export function findingSource(f: Pick<Finding, 'kind'>): FindingSource {
    const p = findingProvenance(f);
    if (p === 'deterministic') return 'exact';
    return p === 'heuristic' && MODEL_KINDS.has(f.kind) ? 'model' : 'analyzer';
}

/** 1..5 for the heat ramp of a card's numbered pin. */
/** A finding severity on the heat ramp (1 to 5). */
export const LEVEL = { error: 5, warn: 3, info: 2 } as const;
const RANK = { error: 0, warn: 1, info: 2 } as const;

export interface ActionCard {
    finding: Finding;
    /** 1..5, the pin's colour on the heat ramp. */
    level: number;
    source: FindingSource;
    /** A deterministic fix exists AND the host can apply it. */
    canApply: boolean;
}

/** The top cards: most severe first, then the widest, then by id (stable). `applicable` = the host's source has `applyFix`, or a per-kind test of what it can apply (`canApplyKind`). */
export function actionCards(findings: readonly Finding[], applicable: boolean | ((kind: string) => boolean), max = MAX_CARDS): ActionCard[] {
    return [...findings]
        .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.nodes.length - a.nodes.length || a.id.localeCompare(b.id))
        .slice(0, max)
        .map((finding) => ({ finding, level: LEVEL[finding.severity], source: findingSource(finding), canApply: typeof applicable === 'function' ? applicable(finding.kind) : applicable && codemodOf(finding.kind)?.builtin === true }));
}

/** "This path is done when…": one checkable line per finding on the path, capped; `more` is how many were left off. */
export function acceptanceChecks(findings: readonly Finding[], labels: KnowledgeGraphLabels, index: ReadonlyMap<string, KNode>): { checks: string[]; more: number } {
    const ranked = [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.id.localeCompare(b.id));
    const checks = ranked.slice(0, MAX_CHECKS).map((f) => fillTemplate(labels.surface.act.doneCheck, { title: findingTitle(f, labels), items: findingItems(f, index) }));
    return { checks, more: Math.max(0, ranked.length - checks.length) };
}

/** The fixed request that turns a path into a test (never a model call): the path, its stops in order, and the checks. */
export function testRequestFor(path: PathModel, title: string, findings: readonly Finding[], labels: KnowledgeGraphLabels, index: ReadonlyMap<string, KNode>): string {
    const { checks } = acceptanceChecks(findings, labels, index);
    return fillTemplate(labels.surface.act.testRequest, {
        path: title,
        stops: path.stops.map((s) => s.name).join(' → '),
        checks: checks.length > 0 ? checks.join('; ') : labels.surface.act.doneNone,
    });
}
