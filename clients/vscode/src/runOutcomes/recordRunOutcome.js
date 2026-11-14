/**
 * Run end on this device (PRD 41 §D1, "Features are frozen at run end"): once a run's delta for one repository is stored,
 * its `RunFeatures` are computed from what was available at the change set's finalization and written ONCE as the run's
 * `run-outcome` record. Detached and best-effort: it never fails or delays the run, and a failure leaves the run without
 * features (it is logged, never retried with later data — a late freeze would read the future).
 *
 * Inputs: the stored delta (counts per dimension, entry points), the change set (the run's attributed paths, its base
 * commit, its finalization time), git (line counts, 90-day churn, file age) and this device's own past run outcomes in the
 * repository (past follow-up fixes and prior runs, both read as of run end by `freezeRunFeatures`).
 */
import { DAY_MS, freezeRunFeatures, lineDelta } from "@builderforce/run-delta/predict";
import { provenRunTexts, runFiles, textOf } from "../runDelta/runTexts";
import { pathBirths, pathHistory } from "./outcomeGit";
import { readRunOutcomes, recordRunFeatures, runOutcomeIdOfChangeSet } from "./runOutcomeRecords";
const HISTORY_DAYS = 90;
/** The paths a change set attributes to its run (authored or modified by it), sorted (THE rule: `runDelta/runTexts.ts`). */
export { runFiles };
/**
 * The run's OWN line counts per file (M4), from its PROVEN sides (`runDelta/runTexts.ts`): before = the base commit's blob
 * for a file clean at baseline (absent for one the run created), after = the file on disk only when its hash is the
 * recorded `afterHash` — so a later edit never counts as the run's. A file dirty at baseline is proven by its pre-image
 * (`preimages`); without the reader it cannot be. Undefined when any file cannot be proven (size is then not measured, never
 * wrong). Dated by the change set's capture.
 */
export async function runLineCounts(root, cs, preimages) {
    const out = [];
    for (const f of await provenRunTexts({ root, changeSet: cs, ...(preimages ? { preimages } : {}) })) {
        const beforeText = textOf(f.before);
        const afterText = textOf(f.after);
        if (beforeText === null || afterText === null)
            return undefined;
        out.push({ path: f.path, at: cs.capturedAt, ...lineDelta(beforeText, afterText) });
    }
    return out;
}
/** The feature inputs of one stored delta. Undefined when its change set is gone. */
export async function runFeatureInputs(store, stored, preimages) {
    const { value, local } = stored;
    const record = await store.read((tx) => tx.get("change-set", value.changeSetId));
    if (!record)
        return undefined;
    const cs = record.payload;
    const finalizedAt = cs.capturedAt;
    const paths = runFiles(cs).map((f) => f.path);
    const since = new Date(Date.parse(finalizedAt) - HISTORY_DAYS * DAY_MS).toISOString();
    const [fileLines, fileCommits, fileBirths, past] = await Promise.all([
        runLineCounts(local.root, cs, preimages),
        pathHistory(local.root, paths, since),
        pathBirths(local.root, paths),
        readRunOutcomes(store, value.repository),
    ]);
    const others = past.filter((p) => p.value.runId !== value.runId);
    return {
        runId: value.runId,
        repository: value.repository,
        finalizedAt,
        entryPoint: "vscode",
        mode: value.mode,
        delta: value.delta,
        ...(fileLines ? { fileLines } : {}),
        ...(fileCommits ? { fileCommits } : {}),
        fileBirths,
        pastLabels: others.flatMap((p) => p.value.labels.map((label) => ({
            at: label.computedAt, label, paths: [...new Set(p.value.attribution.map((a) => a.path))],
        }))),
        // Prior runs in this repository on this device, dated by their own run end.
        experience: { priorRuns: others.map((p) => ({ at: p.value.features.finalizedAt })) },
        people: { agentId: cs.author },
    };
}
/** Freezes and stores the run's features for one stored delta; never throws. */
export async function recordRunOutcomeAtEnd(deps, stored) {
    try {
        const inputs = await runFeatureInputs(deps.store, stored, deps.preimages?.(stored.local.root));
        if (!inputs)
            return;
        const features = freezeRunFeatures(inputs);
        await recordRunFeatures(deps.store, {
            id: runOutcomeIdOfChangeSet(stored.value.changeSetId), features, deviceId: deps.deviceId(), at: inputs.finalizedAt,
            ...(deps.destination ? { destination: deps.destination } : {}),
        });
    }
    catch (error) {
        deps.onError(error);
    }
}
//# sourceMappingURL=recordRunOutcome.js.map