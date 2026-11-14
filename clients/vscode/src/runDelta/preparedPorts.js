/**
 * The engine's inputs as PLAIN DATA ({@link PreparedDelta}, gathered on the extension host by `runDeltaPorts.ts`) and the
 * `DeltaPorts` that serve them. Pure and light: this is all the delta worker (`deltaWorker.ts`) loads besides the engine.
 */
import { annotateDynamicTier, computeRunDelta, defaultDimensionRegistry, withDynamicRules, } from "@builderforce/run-delta";
/** A tool the host did not run on a side: not measured there. */
const notRun = (tool) => ({ tool, version: "", status: "skipped", reason: "tool-absent", findings: [] });
/** `DeltaPorts` over prepared data. */
export function preparedPorts(p) {
    const texts = { before: new Map(p.texts.before), after: new Map(p.texts.after) };
    const churn = new Map(p.churn);
    return {
        async texts(side, paths) {
            const out = new Map();
            for (const path of paths) {
                const t = texts[side].get(path);
                if (t)
                    out.set(path, t);
            }
            return out;
        },
        facts: async (side) => p.facts[side],
        churn: async (paths) => new Map(paths.flatMap((path) => (churn.has(path) ? [[path, churn.get(path)]] : []))),
        pastScores: async () => p.pastScores,
        ...(p.analyzers ? {
            analyze: async (side, tool) => (side === "after" && p.dynamicCoverage?.tool === tool ? p.dynamicCoverage : undefined)
                ?? p.analyzers[side].find((r) => r.tool === tool) ?? notRun(tool),
        } : {}),
    };
}
/** THE engine call over prepared data: what the worker runs, and the in-thread fallback. */
export async function computePrepared(p) {
    const registry = defaultDimensionRegistry(p.registries);
    if (!p.dynamic || p.dynamic.length === 0)
        return computeRunDelta(p.input, registry, preparedPorts(p), p.options);
    return annotateDynamicTier(await computeRunDelta(p.input, withDynamicRules(registry, p.dynamic), preparedPorts(p), p.options), p.dynamic);
}
//# sourceMappingURL=preparedPorts.js.map