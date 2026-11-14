/**
 * A run's predicted measures on this device (PRD 41 Part D, §D11 "Predicted" block): one device-only row per run and
 * repository, `run-delta-prediction:<runId>:<repoKey>`, beside the delta it was computed after. Put, never journaled, so it
 * never syncs: it names the repository's own paths and lines.
 *
 * D0: nothing here feeds a verdict, a hold or the card's verdict rows. `run-delta/get` attaches a card's `ok` predictions
 * ({@link predictedOf}) as `predicted`; the webview's Predicted line renders them with ≈ wording, and reports each first
 * render (`run-delta/prediction-shown`), which the host counts as `prediction.shown` ({@link predictionShownEvent}).
 *
 * §D12 audit: every row keeps the full {@link Prediction} (model id and version, `inputDigest`), so any shown prediction can be
 * replayed.
 */
import { newLocalRecord, scanByIndex } from "@builderforce/local-first";
import { RUN_DELTAS_BY_CHAT, RUN_DELTAS_BY_RUN, runDeltaKey } from "./runDeltaRecords";
export const isRunPredictionValue = (p) => !!p && typeof p === "object" && p.kind === "prediction";
/** `changeset:<runId>:<repoKey>` → the row id `run-delta-prediction:<runId>:<repoKey>`. */
export const runPredictionId = (changeSetId) => `run-delta-prediction:${runDeltaKey(changeSetId).slice("run-delta:".length)}`;
/** Stores a run's predictions once. Returns false when they were already stored for this run and repository. */
export async function storeRunPrediction(store, deviceId, value) {
    const id = runPredictionId(value.changeSetId);
    let written = false;
    await store.transact(async (tx) => {
        if (await tx.get("run-delta", id))
            return;
        // Put, never appended: no journal event, so the sync never carries it.
        await tx.put(newLocalRecord({
            id, entityType: "run-delta", deviceId, occurredAt: value.at, schemaVersion: 1, payload: value,
        }));
        written = true;
    });
    return written;
}
/** The prediction rows of a run, or of every run of a chat, oldest first (then by repository). */
export async function readRunPredictions(store, query) {
    if (query.runId === undefined && query.chatId === undefined)
        return [];
    const out = [];
    await store.read(async (tx) => {
        const visit = (row) => {
            if (row.deletedAt || !isRunPredictionValue(row.payload))
                return;
            if (query.runId !== undefined && row.payload.runId !== query.runId)
                return;
            if (query.chatId !== undefined && row.payload.chatId !== query.chatId)
                return;
            out.push(row.payload);
        };
        if (query.runId !== undefined)
            await scanByIndex(tx, RUN_DELTAS_BY_RUN, query.runId, visit);
        else
            await scanByIndex(tx, RUN_DELTAS_BY_CHAT, query.chatId, visit);
    });
    const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    return out.sort((a, b) => cmp(a.at, b.at) || cmp(a.repository, b.repository));
}
/**
 * The predictions of one stored row a card shows (each model's; naturalness today): `ok` with a non-zero value. An `ok` 0
 * ("no unusual lines") renders nothing and is never reported as shown.
 */
export const predictedOf = (row) => [row.naturalness.prediction].filter((p) => p.status === "ok" && p.value > 0);
/** Each computed card with its run's `ok` predictions for its repository root (matched by run and root). */
export function withPredicted(cards, rows) {
    return cards.map((card) => {
        if (card.status === "pending" || card.status === "failed" || !("root" in card) || !card.root)
            return card;
        const predicted = rows.filter((r) => r.runId === card.runId && r.root === card.root).flatMap(predictedOf);
        return predicted.length > 0 ? { ...card, predicted } : card;
    });
}
/** The event for one prediction the card rendered. */
export const predictionShownEvent = (p) => ({
    name: "prediction.shown", surface: "vscode", prediction: p.id, model: p.modelId, version: p.modelVersion, status: p.status, value: p.value,
});
//# sourceMappingURL=runDeltaPredictions.js.map