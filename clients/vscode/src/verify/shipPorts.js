/**
 * The PRD 45 ship-gate ports as ONE editor run binds them (PRD 46 §3.6): `verifier`, `git` and
 * `reviewer`, spread onto the Brain host request next to `needsConfirm` by both editor surfaces
 * — the panel's run host (`brainRunHost.ts`) and the native participant (`nativeBrainRun.ts`).
 *
 * The verifier and git ports are built ONCE per workspace root and reused by every run there,
 * so the verifier's in-process cache spans runs (a re-check of unchanged bytes costs nothing).
 * The reviewer is built per run: it reads the run's own stream and the review stage pin as they
 * are NOW (a settings change applies to the next run).
 *
 * No runtime `vscode` import — the live module arrives as `VscodeLike` (tested with a fake).
 */
import { createHash } from "crypto";
import { createGit, createReviewer, createVerifierPort } from "./index";
/** The review sub-run's JSON verdict, or a request for changes when the reply is not one. */
export function parseReviewReply(text) {
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    try {
        const parsed = JSON.parse(json ?? "");
        const findings = Array.isArray(parsed.findings) ? parsed.findings.filter((f) => typeof f === "string") : [];
        if (parsed.verdict === "approved" || parsed.verdict === "changes_requested")
            return { verdict: parsed.verdict, findings };
    }
    catch {
        /* not JSON — falls through */
    }
    return { verdict: "changes_requested", findings: ["The reviewer did not return a JSON verdict; review again."] };
}
/** The reviewer's dependencies for one run: its stream, the review pin, the other stage pins. */
function reviewerDeps(run) {
    const phase = run.settings?.phaseModels;
    const available = [phase?.code, phase?.plan, run.settings?.subagentModel, run.settings?.pipeline?.quickModel]
        .filter((m) => typeof m === "string" && !!m);
    return {
        ...(phase?.verify ? { verifyStagePin: phase.verify } : {}),
        availableModels: [...new Set(available)],
        runReviewSubRun: async ({ model, prompt }) => {
            const result = await run.stream({ messages: [{ role: "user", content: prompt }], model, modelStrict: true, role: "verify" });
            return parseReviewReply(result.text);
        },
        hashDiff: (diff) => createHash("sha256").update(diff, "utf8").digest("hex"),
    };
}
/** One editor's ship-gate ports: call it per run; the verifier and git port are per workspace root. */
export function createShipPorts(deps) {
    const byRoot = new Map();
    return (run) => {
        let bound = byRoot.get(run.root);
        if (!bound) {
            const host = {
                root: run.root,
                vscode: deps.vscode,
                git: deps.git,
                ...(deps.readText ? { readText: deps.readText } : {}),
            };
            bound = { verifier: createVerifierPort(host), git: createGit(host) };
            byRoot.set(run.root, bound);
        }
        return { ...bound, reviewer: createReviewer(reviewerDeps(run)) };
    };
}
//# sourceMappingURL=shipPorts.js.map