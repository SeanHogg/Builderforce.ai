/**
 * knowledge/rules/unusedItems.ts — what the unused-code rules share (PRD 41 §B5, §C3): the code pack's file nodes in
 * ref order, and ONE finding per unused name a file's badge lists (a graph built before names were badged: one per
 * file with its count). Anchors: a file → the file; an export → `<file>#<name>` (symbol); a dependency →
 * `<manifest>#<name>` (package). Pure, Worker-safe.
 */

import { compareStr, finding, refAnchor, type Finding, type FindingAnchor, type KNode, type KnowledgeGraph, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_PACK_ID } from '../codeNodes.js';

export interface UnusedItem { kind: string; names: string; count: string; anchorKind: FindingAnchor['anchorKind'] }

/** The code pack's file nodes, sorted by ref. */
export const codeFiles = (g: KnowledgeGraph): KNode[] =>
    g.nodes.filter((n) => n.pack === CODE_PACK_ID && n.kind === 'file').sort((a, b) => compareStr(a.ref, b.ref));

const namesOf = (n: KNode, badge: string): string[] =>
    [...new Set(String(n.badges?.[badge] ?? '').split(',').filter(Boolean))].sort(compareStr);

/** One finding per unused name in the file; a graph built before names were badged gets one per file with its count. */
export function itemFindings(n: KNode, item: UnusedItem): Finding[] {
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
