/**
 * rules/timeoutRaised.ts — `timeout-raised` (quality, warn; C8.2): a test present on both sides got a
 * larger per-test timeout (a trailing numeric argument or `{ timeout: N }`); adding one where there
 * was none counts as raised.
 *
 * Heuristic: text-level test facts; WS4 tree-sitter `testFacts` replace them.
 */

import type { DeltaRule, RuleFinding } from '../contract.js';
import { sharedTests, testFinding, testPairs } from './support/testPairs.js';

export const timeoutRaised: DeltaRule = {
    id: 'timeout-raised',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const pair of testPairs(input)) {
            for (const t of sharedTests(pair)) {
                const b = t.before.timeout, a = t.after.timeout;
                if (a !== undefined && (b === undefined || a > b)) {
                    after.push(testFinding(timeoutRaised, pair, t.key, 'warn', { before: b ?? 0, after: a }, t));
                }
            }
        }
        return { before: [], after };
    },
};
