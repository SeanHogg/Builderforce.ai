/**
 * The editor's judgement port for a review (PRD 38 §4.3, §8.2): routed LOCAL ENGINES FIRST,
 * then the gateway — the same two seams the editor's other small structured calls use
 * (`onDeviceTasks`, `routeComplete` in `modelRouting.ts`), with the shared prompts and
 * memory's validators (`completionJudgement`).
 *
 *   - a model on this machine, when one is running (free tokens);
 *   - then, linked to a project, the platform's routed judge call (`client.judgement` —
 *     metered as `knowledge_judge` with the project), else the editor's own route;
 *   - Local only never reaches the gateway: a review with no local model runs
 *     extracted-only (§5.4).
 */
import { completionJudgement, fallbackJudgement } from "@builderforce/agent-tools/knowledge";
import { NO_LOCAL_MODEL } from "@seanhogg/builderforce-brain-embedded";
import { onDeviceModelAvailable, onDeviceTasks, resolveModelRoute, routeComplete } from "../modelRouting";
import { currentInferenceMode } from "../inferenceModeSetting";
const messagesOf = (system, user) => [
    { role: "system", content: system },
    { role: "user", content: user },
];
/**
 * Whether {@link editorJudgement} will yield a judge: a gateway judge unless the mode is Local only (a settings read),
 * else a model running on this machine. No server is started or asked — the confirm chip uses it to count compare calls.
 */
export async function judgeConfigured() {
    if (currentInferenceMode() !== "local-only")
        return true;
    return onDeviceModelAvailable().catch(() => false);
}
/** The review's judgement port, resolved once per review; undefined when nothing may judge. */
export async function editorJudgement(secrets, client) {
    const ports = [];
    const used = new Set();
    if (await onDeviceModelAvailable().catch(() => false)) {
        // The port's raw completion: judgement parses its own reply (memory's validators), and a
        // failure propagates so the chain moves on to the platform's judge.
        const local = async ({ system, user, signal }) => {
            const reply = await onDeviceTasks.complete(messagesOf(system, user), signal, (ref) => used.add(ref));
            if (reply === null)
                throw new Error(NO_LOCAL_MODEL);
            return reply;
        };
        ports.push(completionJudgement(local));
    }
    if (currentInferenceMode() !== "local-only") {
        if (client) {
            ports.push(client.judgement);
        }
        else {
            const routed = async ({ system, user, signal }) => {
                const route = await resolveModelRoute(secrets);
                const reply = await routeComplete(route, secrets, messagesOf(system, user), signal);
                if (route.model)
                    used.add(route.model);
                return reply;
            };
            ports.push(completionJudgement(routed));
        }
    }
    return ports.length > 0 ? { ...fallbackJudgement(ports), modelsUsed: () => [...used] } : undefined;
}
//# sourceMappingURL=knowledgeJudgement.js.map