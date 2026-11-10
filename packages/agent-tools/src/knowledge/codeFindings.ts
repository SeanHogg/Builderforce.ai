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
 * Added here: knip's unused files, exports and dependencies, ONE FINDING PER ITEM (PRD 41 §C3),
 * so each has its own identity and lineage (`knowledgeGraph.fix.unusedFile` · `.unusedExport` ·
 * `.unusedDependency`). Anchors: an unused file → the file; an unused export → `<file>#<name>`
 * (symbol); an unused dependency → `<manifest>#<name>` (package). `<file>` is the file's node ref.
 *
 * Pure: no I/O. Worker-safe.
 */

import {
    compareStr, finding, refAnchor,
    type Finding, type FindingAnchor, type FindingRule, type KNode, type KnowledgeGraph, type NodeRef,
} from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES, CODE_PACK_ID } from './codeNodes.js';

/** The per-name unused kinds: the badge listing the names, the count badge, and what the anchor names. */
const UNUSED_ITEMS: ReadonlyArray<{ kind: string; names: string; count: string; anchorKind: FindingAnchor['anchorKind'] }> = [
    { kind: 'unused-export', names: CODE_BADGES.unusedExportNames, count: CODE_BADGES.unusedExports, anchorKind: 'symbol' },
    { kind: 'unused-dependency', names: CODE_BADGES.unusedDependencyNames, count: CODE_BADGES.unusedDependencies, anchorKind: 'package' },
];

const namesOf = (n: KNode, badge: string): string[] =>
    [...new Set(String(n.badges?.[badge] ?? '').split(',').filter(Boolean))].sort(compareStr);

/** One finding per unused name in the file; a graph built before names were badged gets one per file with its count. */
function itemFindings(n: KNode, item: (typeof UNUSED_ITEMS)[number]): Finding[] {
    const ref = n.ref as NodeRef;
    const names = namesOf(n, item.names);
    if (names.length === 0) {
        const count = Number(n.badges?.[item.count] ?? 0) || 0;
        return count > 0 ? [finding(item.kind, CODE_PACK_ID, [ref], 'info', { count, files: 1 }, undefined, refAnchor(ref))] : [];
    }
    return names.map((name) => {
        const anchor = `${ref}#${name}`;
        return finding(item.kind, CODE_PACK_ID, [ref], 'info', { count: 1, files: 1, name }, [anchor], { anchor, anchorKind: item.anchorKind });
    });
}

export const unusedCodeRule: FindingRule = {
    id: 'code.unused',
    find(g: KnowledgeGraph): Finding[] {
        const files = g.nodes.filter((n) => n.pack === CODE_PACK_ID && n.kind === 'file').sort((a, b) => compareStr(a.ref, b.ref));
        const out: Finding[] = [];
        for (const n of files) {
            if (n.badges?.[CODE_BADGES.unused] === 'file') {
                out.push(finding('unused-file', CODE_PACK_ID, [n.ref as NodeRef], 'info', { count: 1, files: 1 }, undefined, refAnchor(n.ref)));
            }
        }
        for (const item of UNUSED_ITEMS) for (const n of files) out.push(...itemFindings(n, item));
        return out;
    },
};

export const CODE_FINDING_RULES: readonly FindingRule[] = [unusedCodeRule];
