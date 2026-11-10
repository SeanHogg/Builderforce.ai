/**
 * The `run-delta` local-first record (PRD 41 §C14): one per run and repository, `run-delta:<runId>:<repoKey>`, written once
 * (a retried finalization keeps the stored one) through the same `newLocalRecord` + `tx.put` + `tx.append` path as the change
 * set it was computed from, so it syncs as a mirror record behind that change set.
 *
 * Also the reads the host serves: a run's (or a chat's) stored deltas for the chat card (`run-delta/get`), and a
 * repository's past blast-radius scores for the C10 percentile bands.
 */

import { newLocalRecord, type EntityDestination, type LocalFirstStore } from "@builderforce/local-first";
import type { RunDelta } from "@builderforce/run-delta";

/** What a stored delta carries beside the engine's result. */
export interface RunDeltaRecordValue {
  runId: string;
  /** The change set's repository identity (remote URL, else the root path). */
  repository: string;
  /** The repository's absolute local root on this device (where the card's "Open code" resolves a path). */
  root: string;
  /** The change-set record the delta was computed from. */
  changeSetId: string;
  /** The chat whose run it was (the host's local chat id). */
  chatId: number;
  mode: "interactive" | "autonomous";
  delta: RunDelta;
  /** Wall time of the computation, ms. */
  computedMs: number;
  /** §12.5: an autonomous run whose delta holds blocking findings, with their rule ids. */
  blocked?: { rules: string[] };
  /** `.builderforce/delta.json` entries that were ignored (codes from `withOverrides`). */
  overridesDropped?: string[];
}

/** The chat card's payload: what `run-delta/card` carries and `run-delta/get` answers with. */
export interface RunDeltaCard {
  chatId: number;
  runId: string;
  /** The repository identity (its remote URL, else its root path). */
  repo: string;
  /** The absolute local repository root: a card path opens at `root + '/' + path`. */
  root: string;
  delta: RunDelta;
}

/** `changeset:<runId>:<repoKey>` → `run-delta:<runId>:<repoKey>`: the same run and repository key. */
export function runDeltaId(changeSetId: string): string {
  const repoKey = changeSetId.slice(changeSetId.lastIndexOf(":") + 1);
  const runId = changeSetId.slice("changeset:".length, changeSetId.lastIndexOf(":"));
  return `run-delta:${runId}:${repoKey}`;
}

export const cardOf = (value: RunDeltaRecordValue): RunDeltaCard =>
  ({ chatId: value.chatId, runId: value.runId, repo: value.repository, root: value.root, delta: value.delta });

/** Stores the delta once. Returns false when one was already stored for this run and repository. */
export async function storeRunDelta(
  store: LocalFirstStore,
  deps: { deviceId: string; at: string; destination?: EntityDestination },
  value: RunDeltaRecordValue,
  /** False once the computation was abandoned: checked inside the transaction, so nothing lands after that. */
  live: () => boolean = () => true,
): Promise<boolean> {
  const id = runDeltaId(value.changeSetId);
  let stored = false;
  await store.transact(async (tx) => {
    if (!live() || await tx.get("run-delta", id)) return;
    const record = newLocalRecord<RunDeltaRecordValue>({
      id,
      entityType: "run-delta",
      deviceId: deps.deviceId,
      destination: deps.destination ?? { kind: "unbound" },
      occurredAt: deps.at,
      schemaVersion: 1,
      payload: value,
    });
    await tx.put(record);
    await tx.append({
      eventId: `run-delta:create:${id}`,
      clientEntityId: id,
      entityType: "run-delta",
      operation: "create",
      schemaVersion: record.schemaVersion,
      occurredAt: deps.at,
      dependsOn: [`change-set:create:${value.changeSetId}`],
      destination: record.destination,
      payload: record.payload,
    });
    stored = true;
  });
  return stored;
}

/** The stored deltas of a run, or of every run of a chat, oldest first. */
export async function readRunDeltas(store: LocalFirstStore, query: { runId?: string; chatId?: number }): Promise<RunDeltaCard[]> {
  if (query.runId === undefined && query.chatId === undefined) return [];
  const found: Array<{ at: string; card: RunDeltaCard }> = [];
  await store.read(async (tx) => {
    await tx.scan<RunDeltaRecordValue>("run-delta", (row) => {
      const p = row.payload;
      if (row.deletedAt || !p?.delta) return;
      if (query.runId !== undefined && p.runId !== query.runId) return;
      if (query.chatId !== undefined && p.chatId !== query.chatId) return;
      found.push({ at: row.occurredAt, card: cardOf(p) });
    });
  });
  return found.sort((a, b) => a.at.localeCompare(b.at) || a.card.repo.localeCompare(b.card.repo)).map((f) => f.card);
}

/** Past blast-radius scores of a repository (C10), from its stored deltas. */
export async function pastBlastScores(store: LocalFirstStore, repository: string): Promise<number[]> {
  const scores: number[] = [];
  await store.read(async (tx) => {
    await tx.scan<RunDeltaRecordValue>("run-delta", (row) => {
      const score = row.payload?.delta?.blastRadius?.score;
      if (!row.deletedAt && row.payload?.repository === repository && typeof score === "number") scores.push(score);
    });
  });
  return scores;
}
