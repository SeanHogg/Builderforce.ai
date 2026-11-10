/**
 * The engine's inputs as PLAIN DATA ({@link PreparedDelta}, gathered on the extension host by `runDeltaPorts.ts`) and the
 * `DeltaPorts` that serve them. Pure and light: this is all the delta worker (`deltaWorker.ts`) loads besides the engine.
 */

import {
  computeRunDelta, defaultDimensionRegistry,
  type DeltaPorts, type DeltaRegistries, type RunChangeSetInput, type RunDelta, type SideFacts, type SideText, type UnresolvedFile,
} from "@builderforce/run-delta";

/** Everything the engine reads, as structured-cloneable data. */
export interface PreparedDelta {
  input: RunChangeSetInput;
  registries: DeltaRegistries;
  texts: { before: Array<[string, SideText | UnresolvedFile]>; after: Array<[string, SideText | UnresolvedFile]> };
  facts: { before: SideFacts; after: SideFacts };
  churn: Array<[string, number]>;
  pastScores: number[];
}

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
  };
}

/** THE engine call over prepared data: what the worker runs, and the in-thread fallback. */
export function computePrepared(p: PreparedDelta): Promise<RunDelta> {
  return computeRunDelta(p.input, defaultDimensionRegistry(p.registries), preparedPorts(p));
}
