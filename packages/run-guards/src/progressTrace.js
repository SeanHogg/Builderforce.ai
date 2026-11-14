/**
 * THE trace step for a progress detector action — trips AND the advisories that are
 * never trips (B1 readiness, B4 batching). Hosts used to trace only trips and swallow
 * the advisory, so a run that was nudged left nothing a trace could see. One mapping
 * here keeps every host's trace row the same shape.
 */
import { BATCHING_NUDGE_NOTE } from "./batchingNudge.js";
/** The source of an advisory note — the B1 readiness note or the B4 batching nudge. */
function advisorySourceOf(note) {
    // The detector has exactly two advisory producers; READINESS_ADVISORY_NOTE is the other.
    return note === BATCHING_NUDGE_NOTE ? "batching" : "readiness";
}
export function progressTraceStep(action, override = {}) {
    if (action.kind === "advisory") {
        const source = advisorySourceOf(action.note);
        return {
            label: "loop.progress_advisory",
            args: { advisory: source },
            result: `progress advisory (${source}): a one-off note on the next turn, not a trip`,
        };
    }
    const outcome = override.outcome ?? action.kind;
    return {
        label: "loop.progress_check",
        args: override.detail ?? { trip: action.trip, signal: action.signal.kind, action: action.kind },
        result: `progress check ${action.trip}: ${action.signal.kind} → ${outcome}`,
    };
}
//# sourceMappingURL=progressTrace.js.map