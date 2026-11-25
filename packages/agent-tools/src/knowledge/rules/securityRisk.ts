/**
 * knowledge/rules/securityRisk.ts — `security-risk`: one finding per code file whose code-shield risk score
 * (the `securityRisk` badge) reaches {@link MIN_RISK}. Reads the knowledge input only (the file badges), so it
 * never re-scans; the badge holds rule ids, never matched text. Request key `knowledgeGraph.fix.securityRisk`.
 */

import { defineRule, finding, refAnchor, type KnowledgeRuleExtra, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_BADGES, CODE_PACK_ID } from '../codeNodes.js';
import { codeFiles } from './unusedItems.js';

/** The score from which a file is a finding (below it the lens still tones the file). */
export const MIN_RISK = 40;
/** The score from which the finding is an error rather than a warning (the scorer's block threshold). */
const BLOCK_RISK = 80;

export const securityRiskRule = defineRule<KnowledgeRuleExtra>({
    id: 'code.security-risk',
    version: 1,
    reads: [], // the knowledge graph only
    scope: 'global',
    extraInputs: ['knowledge'],
    derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).flatMap((n) => {
        const risk = Number(n.badges?.[CODE_BADGES.securityRisk] ?? 0) || 0;
        if (risk < MIN_RISK) return [];
        const rules = String(n.badges?.[CODE_BADGES.securityRules] ?? '');
        return [finding('security-risk', CODE_PACK_ID, [n.ref as NodeRef], risk >= BLOCK_RISK ? 'error' : 'warn', { count: 1, files: 1, risk, rules }, undefined, refAnchor(n.ref))];
    }),
});
