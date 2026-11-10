/**
 * agent-tools declares the analyzer adapters' output STRUCTURALLY (`delta/adapters/analyzer.ts`, it cannot import
 * run-delta); this host hands it to run-delta's `DeltaPorts.analyze`. Held together here in BOTH directions at compile time:
 * a field one side adds that the other does not carry fails the typecheck of this file.
 */

import { describe, expect, it } from "vitest";
import type { AnalyzerRunFinding, AnalyzerRunMetric, AnalyzerRunResult } from "@builderforce/agent-tools";
import type { AnalyzerFinding, AnalyzerMetric, AnalyzerResult } from "@builderforce/run-delta";

/** Compiles only when `F` is assignable to `T`. */
const assignable = <T>() => <F extends T>(value?: F): F | undefined => value;

describe("analyzer shapes", () => {
  it("AnalyzerRunResult ⇄ AnalyzerResult, AnalyzerRunFinding ⇄ AnalyzerFinding, AnalyzerRunMetric ⇄ AnalyzerMetric", () => {
    assignable<AnalyzerResult>()<AnalyzerRunResult>();
    assignable<AnalyzerRunResult>()<AnalyzerResult>();
    assignable<AnalyzerFinding>()<AnalyzerRunFinding>();
    assignable<AnalyzerRunFinding>()<AnalyzerFinding>();
    assignable<AnalyzerMetric>()<AnalyzerRunMetric>();
    assignable<AnalyzerRunMetric>()<AnalyzerMetric>();
    expect(true).toBe(true);
  });
});
