/**
 * The editor's ONE `OnDeviceTasks` port (PRD 42 · B2): Synapse and the other local engines
 * behind a single on-device completion. The completion itself is a transport, so it lives
 * in `modelRouting.ts` (the one router) and is handed in; this module owns the port's
 * shape — what is available on this machine and the window a chunk must fit.
 */
import { completionOnDeviceTasks } from "@seanhogg/builderforce-brain-embedded";
import { isServableLocalModel } from "@builderforce/local-inference";
import { getLocalModelsConfig } from "./gateway";
import { probeOnDeviceRuntimes } from "./localModels";
/** Whether anything on this machine could serve an on-device completion right now. */
export async function onDeviceModelAvailable() {
    return (await probeOnDeviceRuntimes(getLocalModelsConfig())).some((p) => p.models.some(isServableLocalModel));
}
/**
 * The input window a summary chunk must fit: the smallest probed window among the models
 * that can serve now (the plan may pick any of them), undefined when none reports one.
 */
export async function onDeviceWindow() {
    const windows = (await probeOnDeviceRuntimes(getLocalModelsConfig()))
        .flatMap((p) => p.models.filter(isServableLocalModel))
        .flatMap((m) => (m.contextTokens ? [m.contextTokens] : []));
    return windows.length > 0 ? Math.min(...windows) : undefined;
}
/**
 * The port over one on-device completion: every caller (knowledge judgement, local research)
 * goes through its `json` / `summarize` / `complete`. `translate` is `null` here;
 * `detectLanguage` is the deterministic heuristic.
 */
export function createOnDeviceTasks(complete, observe) {
    return completionOnDeviceTasks({
        complete,
        available: onDeviceModelAvailable,
        contextTokens: onDeviceWindow,
        ...(observe ? { observe } : {}),
    });
}
//# sourceMappingURL=onDeviceTasks.js.map