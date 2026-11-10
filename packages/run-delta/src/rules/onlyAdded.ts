/**
 * rules/onlyAdded.ts — `only-added` (quality, error; C8.2): a `.only` / `fit` / `fdescribe` focus
 * marker in a changed test file (which silently skips every other test). Reported per side; lineage
 * makes a marker the before side lacked `introduced`. Blocks an autonomous run.
 *
 * Heuristic: text-level test facts; WS4 tree-sitter `testFacts` replace them.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { testFinding, testPairs } from './support/testPairs.js';

export const onlyAdded: DeltaRule = {
    id: 'only-added',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const out = { before: [] as RuleFinding[], after: [] as RuleFinding[] };
        for (const pair of testPairs(input)) {
            for (const [key, t] of pair.before) {
                if (!t.only) continue;
                const f = testFinding(onlyAdded, pair, key, 'error', {}, { before: t });
                out.before.push(f);
            }
            for (const [key, t] of pair.after) if (t.only) out.after.push(testFinding(onlyAdded, pair, key, 'error', {}, { after: t }));
        }
        return out;
    },
};
