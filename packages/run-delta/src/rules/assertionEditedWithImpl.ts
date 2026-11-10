/**
 * rules/assertionEditedWithImpl.ts — `assertion-edited-with-impl` (quality; C8.2): a test present on
 * both sides kept its assertion count but its assertion lines (the expected values) changed, in a run
 * that also changed implementation code. Warn; ERROR in a `consolidation` run (`RunChangeSetInput.kind`),
 * per the "tests run unchanged" rule — and as an error it is a C8.2 error that blocks an autonomous run.
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
        const severity = input.runKind === 'consolidation' ? 'error' : 'warn';
        for (const pair of testPairs(input)) {
            for (const t of sharedTests(pair)) {
                if (t.before.assertions !== t.after.assertions || t.before.assertions === 0) continue;
                if (t.after.assertionLines.join('\n') !== t.before.assertionLines.join('\n')) {
                    after.push(testFinding(assertionEditedWithImpl, pair, t.key, severity, { assertions: t.after.assertions }, t));
                }
            }
        }
        return { before: [], after };
    },
};
