/**
 * The ReviewerPort the VSIX binds (PRD 45 §4.4 reviewerPort, §6 OD-1): ONE review
 * sub-run on a DIFFERENT model, given the diff and the evidence summary only.
 *
 * The reviewer model: the `builderforce.models.review` stage pin (the `verify`
 * stage) when it is not one of the author models; otherwise the first model from
 * the run's available models (stage/role pins, then the BYO catalog) that is not an
 * author model; otherwise refuse with how to add one. The reviewer's verdict is
 * checked with the SAME `reviewGate` the push gate uses — a reviewer on an author
 * model is refused there too, never recorded.
 *
 * A review that TIMES OUT counts as unavailable and refuses with the add-a-model
 * guidance (never a pass — OD-3).
 */
import { reviewGate } from "@builderforce/run-guards";
const DEFAULT_REVIEW_TIMEOUT_MS = 120_000;
/** How to add a second model, stated in the refusal when no reviewer is available. */
export const ADD_A_MODEL_TEXT = "No independent reviewer is available. Add one: connect a BYO account " +
    "(the gateway adds its models to the run's catalog) or set the builderforce.models.review " +
    "stage pin to a model that did not author the change, then push again.";
/** Pick the reviewer model per §6 OD-1: verify-stage pin, else first non-author available model. */
export function pickReviewerModel(verifyStagePin, availableModels, authorModels) {
    if (verifyStagePin && !authorModels.includes(verifyStagePin))
        return verifyStagePin;
    for (const m of availableModels)
        if (!authorModels.includes(m))
            return m;
    return null;
}
/**
 * Compose the ReviewerPort. The sub-run is given the diff and the evidence summary
 * ONLY — never the model's own narration of what it did.
 */
export function createReviewerPort(deps) {
    const timeoutMs = deps.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
    return {
        async review(input) {
            const model = pickReviewerModel(deps.verifyStagePin, deps.availableModels ?? [], input.authorModels);
            if (!model)
                return { refused: ADD_A_MODEL_TEXT };
            const diffHash = deps.hashDiff(input.diff);
            const prompt = `You are reviewing a change before it ships. Review ONLY the diff and the ` +
                `check evidence below — do not trust any narration of what was done.\n\n` +
                `## Diff\n${input.diff}\n\n## Evidence\n${input.evidence}\n\n` +
                `Reply with a JSON object: {"verdict": "approved" | "changes_requested", "findings": string[]}. ` +
                `List concrete defects as findings; an empty findings list means approved.`;
            let result;
            try {
                result = await withTimeout(deps.runReviewSubRun({ model, prompt }), timeoutMs);
            }
            catch {
                // The review could not complete (timeout, sub-run failure): OD-3 — unavailable.
                return { refused: ADD_A_MODEL_TEXT };
            }
            const verdict = {
                reviewerModel: model,
                verdict: result.verdict,
                diffHash,
                findings: result.findings,
            };
            // The SAME gate the push uses: an author model or a stale diffHash is refused here too.
            const gate = reviewGate(verdict, input.authorModels, diffHash);
            if (!gate.ok)
                return { refused: gate.reason };
            return verdict;
        },
    };
}
function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("review timeout")), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); });
    });
}
//# sourceMappingURL=reviewerPort.js.map