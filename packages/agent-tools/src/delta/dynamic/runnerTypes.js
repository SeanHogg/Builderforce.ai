/**
 * delta/dynamic/runnerTypes.ts — run-delta's dynamic-tier runner types (`dynamic/contract.ts`, `dynamic/tier.ts`),
 * restated STRUCTURALLY: run-delta imports agent-tools, so an import back would be a source-package cycle (the
 * same rule as `adapters/analyzer.ts`). The host that imports both (the VSIX's `runDelta/dynamicTier.ts`) asserts,
 * at the type level and both ways, that these equal run-delta's — a drift fails its type check, not a run.
 */
export {};
//# sourceMappingURL=runnerTypes.js.map