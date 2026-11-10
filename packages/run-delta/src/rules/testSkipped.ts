/**
 * rules/testSkipped.ts — `test-skipped` (quality, error; C8.2): a test that ran before is skipped
 * after (`.skip`, `xit`/`xtest`, `.todo`, or an enclosing `xdescribe`/`describe.skip`). A NEW test
 * added already skipped is not a weakening and is not reported. Blocks an autonomous run.
 *
 * Heuristic: text-level test facts; WS4 tree-sitter `testFacts` replace them.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { sharedTests, testFinding, testPairs } from './support/testPairs.js';

export const testSkipped: DeltaRule = {
    id: 'test-skipped',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const pair of testPairs(input)) {
            for (const t of sharedTests(pair)) {
                if (!t.before.skipped && t.after.skipped) after.push(testFinding(testSkipped, pair, t.key, 'error', {}, t));
            }
        }
        return { before: [], after };
    },
};
