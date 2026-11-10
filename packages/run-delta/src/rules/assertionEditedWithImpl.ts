/**
 * rules/assertionEditedWithImpl.ts — `assertion-edited-with-impl` (quality, warn; C8.2): a test present
 * on both sides kept its assertion count but its assertion lines (the expected values) changed, in a
 * run that also changed implementation code. (Error for consolidation runs, per "tests run unchanged";
 * the run kind is not an input yet, so this pass reports warn.)
 *
 * Heuristic: text-level test facts; WS4 tree-sitter `testFacts` replace them.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { implChanged } from './support/files.js';
import { sharedTests, testFinding, testPairs } from './support/testPairs.js';

export const assertionEditedWithImpl: DeltaRule = {
    id: 'assertion-edited-with-impl',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        if (!implChanged(input)) return { before: [], after };
        for (const pair of testPairs(input)) {
            for (const t of sharedTests(pair)) {
                if (t.before.assertions !== t.after.assertions || t.before.assertions === 0) continue;
                const b = t.before.assertionLines.join('\n'), a = t.after.assertionLines.join('\n');
                if (a !== b) after.push(testFinding(assertionEditedWithImpl, pair, t.key, 'warn', { assertions: t.after.assertions }, t));
            }
        }
        return { before: [], after };
    },
};
