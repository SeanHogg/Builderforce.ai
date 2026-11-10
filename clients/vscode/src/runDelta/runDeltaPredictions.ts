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

import { newLocalRecord, scanByIndex, type LocalFirstStore } from "@builderforce/local-first";
import type { RunDeltaCardPayload } from "@builderforce/run-delta";
import type { NaturalnessResult, Prediction } from "@builderforce/run-delta/predict";
import { RUN_DELTAS_BY_CHAT, RUN_DELTAS_BY_RUN, runDeltaKey } from "./runDeltaRecords";

/** The device-only prediction row of one run in one repository. */
export interface RunPredictionValue {
  kind: "prediction";
  runId: string;
  /** The chat whose run it was: the card's Predicted block reads a chat's rows through the run-delta chat index. */
  chatId: number;
  /** As synced ({@link import("./runDeltaRecords").RunDeltaRecordValue.repository}). */
  repository: string;
  /** The change set the delta (and this prediction) was computed from. */
  changeSetId: string;
  /** The repository root on this device: what a card (`root`) is matched by. */
  root: string;
  /** ISO time it was computed. */
  at: string;
  /** §D6: the unusual new lines (`naturalness.prediction.value` = their count). */
  naturalness: NaturalnessResult;
  /** Replay (§D12): the commit the baseline was read at (absent for a folder root). */
  baseCommit?: string;
  /** Replay: the baseline files fed to the model, in order. */
  baselinePicks: string[];
  /** Replay: the scored files' recorded after hashes (bare hex), by path. */
  afterHashes: Record<string, string>;
}

export const isRunPredictionValue = (p: unknown): p is RunPredictionValue =>
  !!p && typeof p === "object" && (p as { kind?: unknown }).kind === "prediction";

/** `changeset:<runId>:<repoKey>` → the row id `run-delta-prediction:<runId>:<repoKey>`. */
export const runPredictionId = (changeSetId: string): string =>
  `run-delta-prediction:${runDeltaKey(changeSetId).slice("run-delta:".length)}`;

/** Stores a run's predictions once. Returns false when they were already stored for this run and repository. */
export async function storeRunPrediction(store: LocalFirstStore, deviceId: string, value: RunPredictionValue): Promise<boolean> {
  const id = runPredictionId(value.changeSetId);
  let written = false;
  await store.transact(async (tx) => {
    if (await tx.get("run-delta", id)) return;
    // Put, never appended: no journal event, so the sync never carries it.
    await tx.put(newLocalRecord<RunPredictionValue>({
      id, entityType: "run-delta", deviceId, occurredAt: value.at, schemaVersion: 1, payload: value,
    }));
    written = true;
  });
  return written;
}

/** The prediction rows of a run, or of every run of a chat, oldest first (then by repository). */
export async function readRunPredictions(store: LocalFirstStore, query: { runId?: string; chatId?: number }): Promise<RunPredictionValue[]> {
  if (query.runId === undefined && query.chatId === undefined) return [];
  const out: RunPredictionValue[] = [];
  await store.read(async (tx) => {
    const visit = (row: { deletedAt?: string; payload: unknown }): void => {
      if (row.deletedAt || !isRunPredictionValue(row.payload)) return;
      if (query.runId !== undefined && row.payload.runId !== query.runId) return;
      if (query.chatId !== undefined && row.payload.chatId !== query.chatId) return;
      out.push(row.payload);
    };
    if (query.runId !== undefined) await scanByIndex(tx, RUN_DELTAS_BY_RUN, query.runId, visit);
    else await scanByIndex(tx, RUN_DELTAS_BY_CHAT, query.chatId!, visit);
  });
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return out.sort((a, b) => cmp(a.at, b.at) || cmp(a.repository, b.repository));
}

/** A `run-delta/get` card with the predictions the card may show (`ok` only; §D11 Predicted block). */
export type PredictedCard = RunDeltaCardPayload & { predicted?: Prediction[] };

/**
 * The predictions of one stored row a card shows (each model's; naturalness today): `ok` with a non-zero value. An `ok` 0
 * ("no unusual lines") renders nothing and is never reported as shown.
 */
export const predictedOf = (row: RunPredictionValue): Prediction[] =>
  [row.naturalness.prediction].filter((p) => p.status === "ok" && p.value > 0);

/** Each computed card with its run's `ok` predictions for its repository root (matched by run and root). */
export function withPredicted(cards: readonly RunDeltaCardPayload[], rows: readonly RunPredictionValue[]): PredictedCard[] {
  return cards.map((card) => {
    if (card.status === "pending" || card.status === "failed" || !("root" in card) || !card.root) return card;
    const predicted = rows.filter((r) => r.runId === card.runId && r.root === card.root).flatMap(predictedOf);
    return predicted.length > 0 ? { ...card, predicted } : card;
  });
}

/** `prediction.shown` (PRD 41 §4 telemetry): which model, its version and status, and the quantized value; never content. */
export interface PredictionShownEvent {
  name: "prediction.shown";
  surface: "vscode";
  /** The prediction id (`naturalness.unusual-lines`). */
  prediction: string;
  model: string;
  version: string;
  status: Prediction["status"];
  value: number;
}

/** The event for one prediction the card rendered. */
export const predictionShownEvent = (p: Prediction): PredictionShownEvent => ({
  name: "prediction.shown", surface: "vscode", prediction: p.id, model: p.modelId, version: p.modelVersion, status: p.status, value: p.value,
});
