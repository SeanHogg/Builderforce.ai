/**
 * rules/testDeleted.ts — `test-deleted` (quality, error; C8.2): a test present before is gone after,
 * and no other changed test file now holds a test with the same key (a test moved between changed
 * files is not deleted). A deleted test file deletes every test in it. Blocks an autonomous run.
 *
 * Heuristic: text-level test facts; WS4 tree-sitter `testFacts` replace them.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { testFinding, testPairs } from './support/testPairs.js';

export const testDeleted: DeltaRule = {
    id: 'test-deleted',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const pairs = testPairs(input);
        const afterKeys = new Set(pairs.flatMap((p) => [...p.after.values()].filter((t) => !t.container).map((t) => t.key)));
        const after: RuleFinding[] = [];
        for (const pair of pairs) {
            for (const [key, before] of pair.before) {
                if (before.container || pair.after.has(key) || afterKeys.has(key)) continue;
                after.push(testFinding(testDeleted, pair, key, 'error', { assertions: before.assertions }, { before }));
            }
        }
        return { before: [], after };
    },
};
