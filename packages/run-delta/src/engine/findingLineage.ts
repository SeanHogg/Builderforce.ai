/**
 * engine/findingLineage.ts — one rule's two-sided output → {@link DeltaFinding}s, through memory's
 * `matchLineage` (C3; never reimplemented here) and the C9 comparability outcome.
 *
 *  - Comparable: each lineage entry becomes one finding; `changed`/`persisting` carry both sides'
 *    evidence, `introduced` the after side's, `resolved` the before side's.
 *  - Not comparable: NO introduced or resolved entries. Every after-side finding is shown as
 *    "present now" (`presentNow: true`, lineage `persisting` by convention).
 *  - A `global` rule (C2) keeps `changed`/`persisting` findings only when a member touches the impact set.
 */

import { matchLineage, pathOfRef } from '@seanhogg/builderforce-memory/knowledge';
import type { DeltaFinding, DeltaRule, Evidence, RuleFinding } from '../contract.js';
import { compareStr } from './text.js';

function bySideId(list: readonly RuleFinding[]): Map<string, RuleFinding> {
    const out = new Map<string, RuleFinding>();
    for (const f of [...list].sort((a, b) => compareStr(a.identity.id, b.identity.id))) if (!out.has(f.identity.id)) out.set(f.identity.id, f);
    return out;
}

export function compareEvidence(a: Evidence, b: Evidence): number {
    return compareStr(a.side, b.side) || compareStr(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0)
        || compareStr(a.note ?? '', b.note ?? '') || compareStr(a.snippet ?? '', b.snippet ?? '');
}

const memberPath = (m: string): string => pathOfRef(m) ?? m.split('#')[0]!;

function touches(f: RuleFinding, impact: ReadonlySet<string>): boolean {
    return f.identity.members.some((m) => impact.has(memberPath(m))) || f.evidence.some((e) => impact.has(e.path));
}

function toDelta(rule: DeltaRule, f: RuleFinding, lineage: DeltaFinding['lineage'], evidence: Evidence[], extra: Partial<DeltaFinding> = {}): DeltaFinding {
    return {
        identity: f.identity,
        dimension: rule.dimension,
        ruleId: rule.id,
        ruleVersion: rule.version,
        severity: f.severity,
        lineage,
        confidence: f.confidence,
        params: f.params,
        evidence: [...evidence].sort(compareEvidence),
        ...extra,
    };
}

export function findingsOf(
    rule: DeltaRule,
    sides: { before: readonly RuleFinding[]; after: readonly RuleFinding[] },
    isComparable: boolean,
    impact: ReadonlySet<string>,
): DeltaFinding[] {
    const before = bySideId(sides.before), after = bySideId(sides.after);
    const global = rule.scope === 'global';
    const out: DeltaFinding[] = [];

    if (!isComparable) {
        for (const f of after.values()) {
            if (global && !touches(f, impact)) continue;
            out.push(toDelta(rule, f, 'persisting', f.evidence, { presentNow: true }));
        }
        return out;
    }

    const entries = matchLineage([...before.values()].map((f) => f.identity), [...after.values()].map((f) => f.identity));
    for (const e of entries) {
        const b = e.before !== undefined ? before.get(e.before) : undefined;
        const a = e.after !== undefined ? after.get(e.after) : undefined;
        if (e.lineage === 'introduced' && a) { out.push(toDelta(rule, a, 'introduced', a.evidence)); continue; }
        if (e.lineage === 'resolved' && b) { out.push(toDelta(rule, b, 'resolved', b.evidence)); continue; }
        if (!a || !b) continue;
        if (global && !touches(a, impact) && !touches(b, impact)) continue;
        out.push(toDelta(rule, a, e.lineage, [...b.evidence, ...a.evidence], e.change ? { change: e.change } : {}));
    }
    return out;
}
