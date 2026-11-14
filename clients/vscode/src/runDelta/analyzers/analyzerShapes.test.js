/**
 * agent-tools declares the analyzer adapters' output STRUCTURALLY (`delta/adapters/analyzer.ts`, it cannot import
 * run-delta); this host hands it to run-delta's `DeltaPorts.analyze`. Held together here in BOTH directions at compile time:
 * a field one side adds that the other does not carry fails the typecheck of this file.
 */
import { describe, expect, it } from "vitest";
/** Compiles only when `F` is assignable to `T`. */
const assignable = () => (value) => value;
describe("analyzer shapes", () => {
    it("AnalyzerRunResult ⇄ AnalyzerResult, AnalyzerRunFinding ⇄ AnalyzerFinding, AnalyzerRunMetric ⇄ AnalyzerMetric", () => {
        assignable()();
        assignable()();
        assignable()();
        assignable()();
        assignable()();
        assignable()();
        expect(true).toBe(true);
    });
});
//# sourceMappingURL=analyzerShapes.test.js.map