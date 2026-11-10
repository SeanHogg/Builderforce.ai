/**
 * The engine's inputs as PLAIN DATA ({@link PreparedDelta}, gathered on the extension host by `runDeltaPorts.ts`) and the
 * `DeltaPorts` that serve them. Pure and light: this is all the delta worker (`deltaWorker.ts`) loads besides the engine.
 */

import {
  annotateDynamicTier, computeRunDelta, defaultDimensionRegistry, withDynamicRules,
  type AnalyzerResult, type ComputeOptions, type DeltaPorts, type DynamicCheckResult, type DeltaRegistries, type RunChangeSetInput, type RunDelta, type SideFacts, type SideText, type UnresolvedFile,
} from "@builderforce/run-delta";

/** Everything the engine reads, as structured-cloneable data. */
export interface PreparedDelta {
  input: RunChangeSetInput;
  registries: DeltaRegistries;
  texts: { before: Array<[string, SideText | UnresolvedFile]>; after: Array<[string, SideText | UnresolvedFile]> };
  facts: { before: SideFacts; after: SideFacts };
  churn: Array<[string, number]>;
  pastScores: number[];
  /** The L3 analyzer results of both sides (`analyzers/repoAnalyzers.ts`). Absent: this delta has no analyzer tier. */
  analyzers?: { before: AnalyzerResult[]; after: AnalyzerResult[] };
  /** The optional dynamic tier's results (`dynamicTier.ts`), registered as rules. Absent: the tier is not part of this compute. */
  dynamic?: DynamicCheckResult[];
  /**
   * The dynamic tier's after-side `coverage` result, measured over the report its own test run left in its scratch copy
   * (`dynamicTier.ts`): it supersedes the analyzer pass's `coverage` row, which can only read the working tree's.
   */
  dynamicCoverage?: AnalyzerResult;
  /** The engine call's options: `{ analyzers: 'pending' }` for phase 1 (the L3 analyzers still to run), `asOf` for data age. */
  options?: ComputeOptions;
}

/** A tool the host did not run on a side: not measured there. */
const notRun = (tool: string): AnalyzerResult => ({ tool, version: "", status: "skipped", reason: "tool-absent", findings: [] });

/** `DeltaPorts` over prepared data. */
export function preparedPorts(p: PreparedDelta): DeltaPorts {
  const texts = { before: new Map(p.texts.before), after: new Map(p.texts.after) };
  const churn = new Map(p.churn);
  return {
    async texts(side, paths) {
      const out = new Map<string, SideText | UnresolvedFile>();
      for (const path of paths) {
        const t = texts[side].get(path);
        if (t) out.set(path, t);
      }
      return out;
    },
    facts: async (side) => p.facts[side],
    churn: async (paths) => new Map(paths.flatMap((path) => (churn.has(path) ? [[path, churn.get(path)!] as const] : []))),
    pastScores: async () => p.pastScores,
    ...(p.analyzers ? {
      analyze: async (side: "before" | "after", tool: string) =>
        (side === "after" && p.dynamicCoverage?.tool === tool ? p.dynamicCoverage : undefined)
        ?? p.analyzers![side].find((r) => r.tool === tool) ?? notRun(tool),
    } : {}),
  };
}

/** THE engine call over prepared data: what the worker runs, and the in-thread fallback. */
export async function computePrepared(p: PreparedDelta): Promise<RunDelta> {
  const registry = defaultDimensionRegistry(p.registries);
  if (!p.dynamic || p.dynamic.length === 0) return computeRunDelta(p.input, registry, preparedPorts(p), p.options);
  return annotateDynamicTier(await computeRunDelta(p.input, withDynamicRules(registry, p.dynamic), preparedPorts(p), p.options), p.dynamic);
}
