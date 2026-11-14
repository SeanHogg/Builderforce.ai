/**
 * The summarizer a LOCAL chat's "Consolidate" / "Fork" compresses with: the ONE
 * transcript summarizer (`@seanhogg/builderforce-memory/working`) over the same gateway
 * route a run streams on. Resolved per call, so a sign-in or a model change since the
 * panel opened is honoured.
 */
import { streamSummaryCompletion } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey } from "./gateway";
import { onDeviceTasks, resolveModelRoute, routeStream } from "./modelRouting";
export function gatewaySummaryCompletion(secrets) {
    return async (request) => {
        const stream = routeStream(await resolveModelRoute(secrets, { turn: true }), await getApiKey(secrets));
        // The device first (PRD 42 · C2), then the run's route.
        return streamSummaryCompletion(stream, undefined, onDeviceTasks)(request);
    };
}
//# sourceMappingURL=chatSummarizer.js.map