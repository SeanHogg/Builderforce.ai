/**
 * agent-tools declares the analyzer adapters' output STRUCTURALLY (`delta/adapters/analyzer.ts`): it cannot import
 * this package, which imports agent-tools (a source-package cycle). This test is where the two shapes are held
 * together at compile time: a field added to `RuleFinding` / `AnalyzerFinding` / `AnalyzerResult` that the
 * adapters do not produce fails the typecheck here, not at a host's `DeltaPorts.analyze` call.
 *
 * A RELATIVE type import on purpose: a package specifier would be a new source-package edge every run-delta
 * consumer had to alias, for a test.
 */

import { describe, expect, it } from 'vitest';
import type { AnalyzerRunFinding, AnalyzerRunResult, ImportedRuleFinding } from '../../agent-tools/src/delta/adapters/analyzer.js';
import type { AnalyzerFinding, AnalyzerResult, RuleFinding } from './contract.js';

/** Compiles only when `F` is assignable to `T`. */
const assignable = <T>() => <F extends T>(value?: F): F | undefined => value;

describe('agent-tools analyzer shapes are run-delta shapes', () => {
    it('ImportedRuleFinding → RuleFinding, AnalyzerRunFinding → AnalyzerFinding, AnalyzerRunResult → AnalyzerResult', () => {
        assignable<RuleFinding>()<ImportedRuleFinding>();
        assignable<AnalyzerFinding>()<AnalyzerRunFinding>();
        assignable<AnalyzerResult>()<AnalyzerRunResult>();
        expect(true).toBe(true);
    });
});
