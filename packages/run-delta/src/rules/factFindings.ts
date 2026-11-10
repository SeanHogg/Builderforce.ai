/**
 * rules/factFindings.ts — the measured `ilities.maintainability` kinds (C7 modularity, reusability,
 * analysability): the whole tree's `SideFacts.findings` of each kind in {@link FACT_FINDING_KINDS},
 * produced by memory's rules (`cycle`, `partition-violation`, `clone-group`, `god-module`) and the knip
 * adapter (`unused-*`), with the identity memory already gave them. One {@link DeltaRule} row per kind,
 * so comparability (C9) gates each kind on its own producers. They are `global` rules (C2): lineage runs
 * over the whole tree, and changed/persisting findings outside the impact set are dropped.
 */

import { pathOfRef } from '@seanhogg/builderforce-memory/knowledge';
import type { DeltaRule, RuleFinding, SideFacts } from '../contract.js';

/** Kind → the `ComparabilityMeta.tools` names whose version gates it (registry data). */
export const FACT_FINDING_KINDS: Readonly<Record<string, readonly string[]>> = {
    'clone-group': ['clone-group', 'jscpd'],
    cycle: ['cycle', 'dependency-cruiser'],
    'god-module': ['god-module'],
    'partition-violation': ['partition-violation'],
    'unused-dependency': ['unused-dependency', 'knip'],
    'unused-export': ['unused-export', 'knip'],
    'unused-file': ['unused-file', 'knip'],
};

function ofKind(facts: SideFacts, kind: string, side: 'before' | 'after'): RuleFinding[] {
    return facts.findings.filter((f) => f.kind === kind).map((f) => ({
        identity: f.identity,
        severity: f.severity,
        confidence: 'measured',
        params: f.params,
        evidence: f.identity.members.map((m) => ({ side, path: pathOfRef(m) ?? m.split('#')[0]!, note: kind })),
    }));
}

function factRule(kind: string, producers: readonly string[]): DeltaRule {
    return {
        id: kind,
        version: 1,
        dimension: 'ilities.maintainability',
        reads: ['structure'],
        producers,
        scope: 'global',
        derive: (input) => ({ before: ofKind(input.beforeFacts, kind, 'before'), after: ofKind(input.afterFacts, kind, 'after') }),
    };
}

export const factFindingRules: readonly DeltaRule[] = Object.keys(FACT_FINDING_KINDS).sort().map((k) => factRule(k, FACT_FINDING_KINDS[k]!));
