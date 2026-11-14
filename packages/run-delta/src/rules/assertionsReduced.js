/**
 * rules/assertionsReduced.ts — `assertions-reduced` (quality, error; C8.2): a test present on both
 * sides has fewer `expect(…)`/`assert…(…)` calls after than before. Blocks an autonomous run.
 *
 * Heuristic: text-level test facts; WS4 tree-sitter `testFacts` replace them.
 */
import { sharedTests, testFinding, testPairs } from './support/testPairs.js';
export const assertionsReduced = {
    id: 'assertions-reduced',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const after = [];
        for (const pair of testPairs(input)) {
            for (const t of sharedTests(pair)) {
                if (t.after.assertions < t.before.assertions) {
                    after.push(testFinding(assertionsReduced, pair, t.key, 'error', { before: t.before.assertions, after: t.after.assertions }, t));
                }
            }
        }
        return { before: [], after };
    },
};
//# sourceMappingURL=assertionsReduced.js.map