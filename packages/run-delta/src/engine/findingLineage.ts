/**
 * engine/findingLineage.ts — one rule's two-sided output → {@link DeltaFinding}s, through memory's
 * `matchLineage` (C3; never reimplemented here) and the C9 comparability outcome.
 *
 *  - Comparable: each lineage entry becomes one finding; `changed`/`persisting` carry both sides'
 *    evidence, `introduced` the after side's, `resolved` the before side's.
 *  - Not comparable: NO introduced or resolved entries. Every after-side finding is `present`.
 *  - A finding introduced in a file whose before side could not be resolved is `present` too: only its
 *    lineage is unknown (C1).
 *  - A `global` rule (C2) keeps `changed`/`persisting` findings only when a member touches the impact
 *    set, and drops every finding whose members all lie in excluded files (outside the run).
 *  - Every string of every finding passes through THE redaction before it leaves (secrets never reach
 *    a delta, whatever rule found the line).
 */

import { matchLineage } from '@seanhogg/builderforce-memory/knowledge';
import type { DeltaFinding, DeltaRule, Evidence, Lineage, RuleFinding } from '../contract.js';
import { memberPath } from './findingFacts.js';
import { redact } from './redact.js';
import { compareStr } from './text.js';

export interface LineageScope {
    /** Changed files, renamed-from paths, dependents and entry points (C2). */
    impact: ReadonlySet<string>;
    /** Files outside the verdicts (outside-run, binary, ignored, submodule). */
    excluded: ReadonlySet<string>;
    /** In-run files whose before side is unresolved. */
    unknownBefore: ReadonlySet<string>;
}

function bySideId(list: readonly RuleFinding[]): Map<string, RuleFinding> {
    const out = new Map<string, RuleFinding>();
    for (const f of [...list].sort((a, b) => compareStr(a.identity.id, b.identity.id))) if (!out.has(f.identity.id)) out.set(f.identity.id, f);
    return out;
}

export function compareEvidence(a: Evidence, b: Evidence): number {
    return compareStr(a.side, b.side) || compareStr(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0)
        || compareStr(a.note ?? '', b.note ?? '') || compareStr(a.snippet ?? '', b.snippet ?? '');
}

const paths = (f: RuleFinding): string[] => [...f.identity.members.map(memberPath), ...f.evidence.map((e) => e.path)];
const touchesAny = (f: RuleFinding, set: ReadonlySet<string>) => paths(f).some((p) => set.has(p));
const allIn = (f: RuleFinding, set: ReadonlySet<string>) => { const ps = f.identity.members.map(memberPath); return ps.length > 0 && ps.every((p) => set.has(p)); };

/** Every string leaf redacted. */
function redacted<T>(value: T): T {
    if (typeof value === 'string') return redact(value) as T;
    if (Array.isArray(value)) return value.map(redacted) as T;
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redacted(v);
    return out as T;
}

function toDelta(rule: DeltaRule, f: RuleFinding, lineage: Lineage, evidence: Evidence[], change?: DeltaFinding['change']): DeltaFinding {
    return redacted({
        identity: f.identity,
        dimension: rule.dimension,
        ruleId: rule.id,
        ruleVersion: rule.version,
        severity: f.severity,
        lineage,
        ...(change ? { change } : {}),
        confidence: f.confidence,
        params: f.params,
        evidence: [...evidence].sort(compareEvidence),
    });
}

export function findingsOf(
    rule: DeltaRule,
    sides: { before: readonly RuleFinding[]; after: readonly RuleFinding[] },
    isComparable: boolean,
    scope: LineageScope,
): DeltaFinding[] {
    const global = rule.scope === 'global';
    const keep = (f: RuleFinding) => !(global && allIn(f, scope.excluded));
    const before = bySideId(sides.before.filter(keep)), after = bySideId(sides.after.filter(keep));
    const out: DeltaFinding[] = [];

    if (!isComparable) {
        for (const f of after.values()) if (!global || touchesAny(f, scope.impact)) out.push(toDelta(rule, f, 'present', f.evidence));
        return out;
    }

    for (const e of matchLineage([...before.values()].map((f) => f.identity), [...after.values()].map((f) => f.identity))) {
        const b = e.before !== undefined ? before.get(e.before) : undefined;
        const a = e.after !== undefined ? after.get(e.after) : undefined;
        if (e.lineage === 'introduced' && a) {
            out.push(toDelta(rule, a, touchesAny(a, scope.unknownBefore) ? 'present' : 'introduced', a.evidence));
            continue;
        }
        if (e.lineage === 'resolved' && b) { out.push(toDelta(rule, b, 'resolved', b.evidence)); continue; }
        if (!a || !b) continue;
        if (global && !touchesAny(a, scope.impact) && !touchesAny(b, scope.impact)) continue;
        out.push(toDelta(rule, a, e.lineage, [...b.evidence, ...a.evidence], e.change));
    }
    return out;
}
