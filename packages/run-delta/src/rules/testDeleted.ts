/**
 * rules/testDeleted.ts — `test-deleted` (quality, error; C8.2): a test present before is gone after,
 * matched by (file, key). A test moved to another file reads as deleted here (test names collide too
 * often across files for a cross-file match to be safe). A deleted test file deletes every test in it.
 * Blocks an autonomous run.
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
        const after: RuleFinding[] = [];
        for (const pair of testPairs(input)) {
            for (const [key, before] of pair.before) {
                if (before.container || pair.after.has(key)) continue;
                after.push(testFinding(testDeleted, pair, key, 'error', { assertions: before.assertions }, { before }));
            }
        }
        return { before: [], after };
    },
};
