/**
 * rules/support/identity.ts — the C3 identity every text rule gives its findings, composed with
 * memory's `composeAnchor` / `anchorWithSnippet` (never reimplemented): the anchor is
 * `<ruleId>@<version>:<anchorKind>:<primary>[~<normalized-snippet hash>]` — no line numbers, no
 * member set — and the exact `id` adds the occurrence ordinal and the members.
 */
import { anchorWithSnippet, composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import { sortedUnique } from '../../engine/text.js';
export function ruleIdentity(rule, anchorKind, primary, opts) {
    const anchor = composeAnchor(rule.id, rule.version, anchorKind, anchorWithSnippet(primary, opts.snippet));
    const members = sortedUnique(opts.members);
    return { id: `${anchor}${opts.ordinal ? `#${opts.ordinal}` : ''}|${members.join(',')}`, anchor, anchorKind, members };
}
/** Counts repeats of one key so equal occurrences in one file get distinct ids (`#1`, `#2`, …). */
export class Ordinals {
    seen = new Map();
    next(key) {
        const n = this.seen.get(key) ?? 0;
        this.seen.set(key, n + 1);
        return n;
    }
}
/** A heuristic text-rule finding (the common case until WS4 tree-sitter facts replace these rules). */
export function heuristicFinding(identity, severity, params, evidence) {
    return { identity, severity, confidence: 'heuristic', params, evidence };
}
//# sourceMappingURL=identity.js.map