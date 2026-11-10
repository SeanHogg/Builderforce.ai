/**
 * knowledge/rules/unusedFile.ts — `unused-file`: one finding per code file knip badged unused (PRD 38 §4.5, PRD 41 §B5).
 * Reads the knowledge input only (the file badges). Request key `knowledgeGraph.fix.unusedFile`.
 */

import { defineRule, finding, refAnchor, type KnowledgeRuleExtra, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES, CODE_PACK_ID } from '../codeNodes.js';
import { codeFiles } from './unusedItems.js';

export const unusedFileRule = defineRule<KnowledgeRuleExtra>({
    id: 'code.unused-file',
    version: 1,
    reads: [], // the knowledge graph only
    scope: 'global',
    extraInputs: ['knowledge'],
    derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph)
        .filter((n) => n.badges?.[CODE_BADGES.unused] === 'file')
        .map((n) => finding('unused-file', CODE_PACK_ID, [n.ref as NodeRef], 'info', { count: 1, files: 1 }, undefined, refAnchor(n.ref))),
});
