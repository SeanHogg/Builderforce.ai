/**
 * knowledge/dependencyCruiserRules.ts — the dependency-cruiser `forbidden` rules for a
 * {@link PartitionRegistry} (PRD 38 §4.4).
 *
 * The SAME registry decides the graph's edge verdicts (memory's `verdictOf`) and the
 * analyzer's gate, so the view and the gate never disagree:
 *
 *   • one rule per ordered (from, to) pair the registry does not allow;
 *   • paths are the partition's globs compiled by memory's ONE `globToRegExp`;
 *   • partitions are first-match-wins, so a partition's rule excludes (`pathNot`) the paths
 *     an EARLIER partition already claims, exactly as `partitionOf` does;
 *   • severity follows the verdict: `upward` (a lower layer using a higher one) is an error,
 *     `skips` a warning — the same split as memory's partition-violation finding.
 *
 * A registry without `allow` has no verdicts, so it yields no rules. Folder partitions
 * (`TOP_LEVEL_FOLDER`) are named per path at run time and cannot be stated as a rule.
 *
 * Pure: no I/O. Worker-safe.
 */

import {
    globToRegExp, verdictOf, TOP_LEVEL_FOLDER, type PartitionRegistry, type PartitionRule,
} from '@seanhogg/builderforce-memory/knowledge';

export interface DependencyCruiserPathMatch {
    path: string;
    pathNot?: string;
}

export interface DependencyCruiserRule {
    name: string;
    comment: string;
    severity: 'error' | 'warn';
    from: DependencyCruiserPathMatch;
    to: DependencyCruiserPathMatch;
}

/** Rule-name prefix, so a host can tell the generated layer rules from its own. */
export const LAYER_RULE_PREFIX = 'kg-layer';

/** One alternation over globs' compiled sources, or undefined for none. */
function alternation(globs: readonly string[]): string | undefined {
    if (globs.length === 0) return undefined;
    return globs.map((g) => `(?:${globToRegExp(g).source})`).join('|');
}

function matchOf(rule: PartitionRule, earlier: readonly PartitionRule[]): DependencyCruiserPathMatch {
    const not = alternation(earlier.flatMap((r) => r.match));
    return { path: alternation(rule.match)!, ...(not ? { pathNot: not } : {}) };
}

export function toDependencyCruiserRules(reg: PartitionRegistry): DependencyCruiserRule[] {
    if (!reg.allow) return [];
    const ordered = reg.partitions;
    const named = ordered.filter((r) => r.id !== TOP_LEVEL_FOLDER && r.match.length > 0);
    const matchById = new Map(named.map((r) => [r.id, matchOf(r, ordered.slice(0, ordered.indexOf(r)))] as const));
    const rules: DependencyCruiserRule[] = [];
    for (const from of named) {
        for (const to of named) {
            const verdict = verdictOf(from.id, to.id, reg);
            if (verdict !== 'upward' && verdict !== 'skips') continue;
            rules.push({
                name: `${LAYER_RULE_PREFIX}-${from.id}-to-${to.id}`,
                comment: `${from.id} may not use ${to.id} (${verdict})`,
                severity: verdict === 'upward' ? 'error' : 'warn',
                from: matchById.get(from.id)!,
                to: matchById.get(to.id)!,
            });
        }
    }
    return rules;
}
