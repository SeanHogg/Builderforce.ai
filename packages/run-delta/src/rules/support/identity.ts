/**
 * rules/support/identity.ts — the C3 identity every text rule gives its findings, composed with
 * memory's `composeAnchor` / `anchorWithSnippet` (never reimplemented): the anchor is
 * `<ruleId>@<version>:<anchorKind>:<primary>[~<normalized-snippet hash>]` — no line numbers, no
 * member set — and the exact `id` adds the occurrence ordinal and the members.
 */

import { anchorWithSnippet, composeAnchor, type AnchorKind, type FindingIdentity } from '@seanhogg/builderforce-memory/knowledge';
import type { Evidence, RuleFinding, Severity } from '../../contract.js';
import { sortedUnique } from '../../engine/text.js';

export interface RuleRef {
    id: string;
    version: number;
}

export function ruleIdentity(
    rule: RuleRef,
    anchorKind: AnchorKind,
    primary: string,
    opts: { members: readonly string[]; snippet?: string; ordinal?: number },
): FindingIdentity {
    const anchor = composeAnchor(rule.id, rule.version, anchorKind, anchorWithSnippet(primary, opts.snippet));
    const members = sortedUnique(opts.members);
    return { id: `${anchor}${opts.ordinal ? `#${opts.ordinal}` : ''}|${members.join(',')}`, anchor, anchorKind, members };
}

/** Counts repeats of one key so equal occurrences in one file get distinct ids (`#1`, `#2`, …). */
export class Ordinals {
    private readonly seen = new Map<string, number>();

    next(key: string): number {
        const n = this.seen.get(key) ?? 0;
        this.seen.set(key, n + 1);
        return n;
    }
}

/** A heuristic text-rule finding (the common case until WS4 tree-sitter facts replace these rules). */
export function heuristicFinding(
    identity: FindingIdentity,
    severity: Severity,
    params: Record<string, string | number>,
    evidence: Evidence[],
): RuleFinding {
    return { identity, severity, confidence: 'heuristic', params, evidence };
}
