/**
 * dynamic/testTiming.ts — C6.2's cheap performance proxy: when the dynamic tier ran the tests on both
 * sides, per-test durations from the reporter JSON are compared. A test at least {@link SLOWER_FACTOR}×
 * slower AND over {@link SLOW_TEST_MS} after the run is a `test-slower` warn (measured, performance). Tests present on
 * one side only are not compared.
 */

import type { RuleFinding } from '../contract.js';
import { ruleIdentity } from '../rules/support/identity.js';
import type { DynamicMeasurement } from './contract.js';

export const TEST_TIMING_RULE = { id: 'test-slower', version: 1 } as const;
export const SLOWER_FACTOR = 3;
export const SLOW_TEST_MS = 200;

/** `<root-relative test file>#<full test name>` → duration in ms. */
export type TestDurations = ReadonlyMap<string, number>;

export function testTimingMeasurement(before: TestDurations, after: TestDurations): DynamicMeasurement {
    const findings: RuleFinding[] = [];
    for (const key of [...after.keys()].sort()) {
        const a = after.get(key)!, b = before.get(key);
        if (b === undefined || a <= SLOW_TEST_MS || a < SLOWER_FACTOR * Math.max(b, 1)) continue;
        const file = key.includes('#') ? key.slice(0, key.indexOf('#')) : key;
        findings.push({
            identity: ruleIdentity(TEST_TIMING_RULE, 'symbol', key, { members: [file] }),
            severity: 'warn',
            confidence: 'measured',
            params: { test: key.slice(file.length + 1), beforeMs: Math.round(b), afterMs: Math.round(a) },
            evidence: [{ side: 'after', path: file, note: `${Math.round(b)}ms→${Math.round(a)}ms` }],
        });
    }
    return {
        ruleId: TEST_TIMING_RULE.id, ruleVersion: TEST_TIMING_RULE.version, dimension: 'performance',
        findings: { before: [], after: findings }, metrics: [],
    };
}
