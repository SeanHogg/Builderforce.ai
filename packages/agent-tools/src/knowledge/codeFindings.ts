/**
 * knowledge/codeFindings.ts — the code pack's OWN findings (PRD 38 §4.5).
 *
 * Memory's generic findings already cover the rest of the code pack's list, and are not
 * repeated here:
 *
 *   | code finding      | generic kind            | request key                                 |
 *   |-------------------|-------------------------|---------------------------------------------|
 *   | layer violation   | `partition-violation`   | `knowledgeGraph.fix.partitionViolation`     |
 *   | cycle             | `cycle`                 | `knowledgeGraph.fix.cycle`                  |
 *   | clone group       | `clone-group`           | `knowledgeGraph.fix.cloneGroup`             |
 *   | near-duplicate    | `near-duplicate`        | `knowledgeGraph.fix.nearDuplicate`          |
 *   | unlayered share   | `unpartitioned`         | `knowledgeGraph.fix.unpartitioned`          |
 *
 * Added here: knip's unused files, exports and dependencies, one finding per kind
 * (`knowledgeGraph.fix.unusedFile` · `.unusedExport` · `.unusedDependency`).
 *
 * Pure: no I/O. Worker-safe.
 */

import {
    compareStr, findingId, requestKeyFor, MAX_FINDING_NODES,
    type Finding, type FindingRule, type KNode, type KnowledgeGraph,
} from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES, CODE_PACK_ID } from './codeNodes.js';

/** One row per unused kind: which files it names and how many items each contributes. */
const UNUSED_KINDS: ReadonlyArray<{ kind: string; items(n: KNode): number }> = [
    { kind: 'unused-file', items: (n) => (n.badges?.[CODE_BADGES.unused] === 'file' ? 1 : 0) },
    { kind: 'unused-export', items: (n) => Number(n.badges?.[CODE_BADGES.unusedExports] ?? 0) || 0 },
    { kind: 'unused-dependency', items: (n) => Number(n.badges?.[CODE_BADGES.unusedDependencies] ?? 0) || 0 },
];

export const unusedCodeRule: FindingRule = {
    id: 'code.unused',
    find(g: KnowledgeGraph): Finding[] {
        const files = g.nodes.filter((n) => n.pack === CODE_PACK_ID && n.kind === 'file');
        const out: Finding[] = [];
        for (const { kind, items } of UNUSED_KINDS) {
            const hits = files.map((n) => ({ ref: n.ref, count: items(n) })).filter((h) => h.count > 0);
            if (hits.length === 0) continue;
            const refs = hits.map((h) => h.ref).sort(compareStr);
            out.push({
                id: findingId(kind, refs), kind, pack: CODE_PACK_ID, nodes: refs.slice(0, MAX_FINDING_NODES),
                severity: 'info',
                params: { count: hits.reduce((sum, h) => sum + h.count, 0), files: refs.length },
                requestKey: requestKeyFor(kind),
            });
        }
        return out;
    },
};

export const CODE_FINDING_RULES: readonly FindingRule[] = [unusedCodeRule];
