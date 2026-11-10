/**
 * knowledge/codeFindings.ts — the code pack's OWN findings (PRD 38 §4.5): the REGISTRY of its FactRules and the
 * pack-rule facade over them (PRD 41 §B5).
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
 * Added here: knip's unused files, exports and dependencies, ONE FINDING PER ITEM (PRD 41 §C3), each kind ONE rule
 * file under knowledge/rules/ (`unusedFile.ts`, `unusedExport.ts`, `unusedDependency.ts`), registered in
 * {@link CODE_FACT_RULES}. `unusedCodeRule` is the pack's `FindingRule` over them (files, then exports, then
 * dependencies), so `computeFindings` and its tests are unchanged.
 *
 * Pure: no I/O. Worker-safe.
 */

import { knowledgeFacts, runKnowledgeRules, type Finding, type FindingRule, type KnowledgeGraph, type KnowledgeRule } from '@seanhogg/builderforce-memory/knowledge';
import { unusedDependencyRule } from './rules/unusedDependency.js';
import { unusedExportRule } from './rules/unusedExport.js';
import { unusedFileRule } from './rules/unusedFile.js';

/** The code pack's FactRules, in emission order. Global, reading the knowledge input alone (hash it with `knowledgeInputHash`). */
export const CODE_FACT_RULES: readonly KnowledgeRule[] = Object.freeze([unusedFileRule, unusedExportRule, unusedDependencyRule]);

export const unusedCodeRule: FindingRule = {
    id: 'code.unused',
    find(g: KnowledgeGraph): Finding[] {
        return runKnowledgeRules(CODE_FACT_RULES, knowledgeFacts(g, new Map()));
    },
};

export const CODE_FINDING_RULES: readonly FindingRule[] = [unusedCodeRule];
