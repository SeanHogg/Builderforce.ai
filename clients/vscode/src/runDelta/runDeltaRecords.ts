/**
 * The `run-delta` local-first record (PRD 41 §C14): one per run and repository, `run-delta:<runId>:<repoKey>`, written once
 * (a retried finalization keeps the stored one) through the same `newLocalRecord` + `tx.put` + `tx.append` path as the change
 * set it was computed from, so it syncs as a mirror record behind that change set.
 *
 * PRIVACY. The synced payload carries no local data: the repository is named by its remote URL, or by `local:<hash>` when it
 * has none (never its absolute path), and ignored `.builderforce/delta.json` entries are reduced to their code plus a hash
 * of the key ({@link redactDropped}, at most {@link MAX_DROPPED}). What only this device needs — the absolute root and the
 * plain repository identity — is a SIDE record, `run-delta-local:<runId>:<repoKey>`, written with no journal event, so it is
 * never mirrored.
 *
 * Also the reads the host serves, through record indexes (never a scan of every delta): a run's or a chat's stored deltas for
 * the chat card (`run-delta/get`), one delta for Open code, and a repository's past blast-radius scores (C10).
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import { defineRecordIndex, newLocalRecord, scanByIndex, type EntityDestination, type ExecutionValue, type LocalFirstStore } from "@builderforce/local-first";
import type { RunDelta } from "@builderforce/run-delta";

/** The synced value. */
export interface RunDeltaRecordValue {
  runId: string;
  /** The repository identity as synced: its remote URL, else `local:<hash of the root>`. */
  repository: string;
  /** The change-set record the delta was computed from. */
  changeSetId: string;
  /** The chat whose run it was (the host's local chat id). */
  chatId: number;
  mode: "interactive" | "autonomous";
  delta: RunDelta;
  /** Wall time of the computation, ms. */
  computedMs: number;
  /**
   * §12.5: the blocking rule ids that HELD this autonomous run at its finalize gate (`runHoldGate.ts`): its execution is
   * `awaiting_input` with a hold naming them, not `completed`. Absent when this delta held nothing (an interactive run, no
   * blocking codes, or codes computed after the gate's verdict).
   */
  blocked?: { rules: string[] };
  /** Ignored `.builderforce/delta.json` entries, redacted ({@link redactDropped}). */
  overridesDropped?: string[];
}

/** The device-only side record: never journaled, so never synced. */
export interface RunDeltaLocalValue {
  kind: "local";
  runId: string;
  chatId: number;
  /** The absolute repository root on this device (Open code resolves under it). */
  root: string;
  /** The plain repository identity (remote URL, else the root path). */
  repo: string;
}

/** The chat card's payload: what `run-delta/card` carries and `run-delta/get` answers with. Local data, never synced. */
export interface RunDeltaCard {
  chatId: number;
  runId: string;
  /** The repository identity (its remote URL, else its root path). */
  repo: string;
  /** The absolute local repository root: a card path opens under it (`run-delta/openFile`). */
  root: string;
  delta: RunDelta;
  /** The rules that held the run (the record's `blocked`): the card shows the run as held on them. */
  blocked?: { rules: string[] };
  /** The held run was released by a person (its execution carries the waiver): the hold no longer stands. */
  released?: boolean;
}

/** What a delta is stored with: the synced value and the device's side record. */
export interface StoredRunDelta {
  value: RunDeltaRecordValue;
  local: RunDeltaLocalValue;
}

/** At most this many ignored-override codes are kept. */
export const MAX_DROPPED = 20;

const isLocalValue = (p: unknown): p is RunDeltaLocalValue => !!p && typeof p === "object" && (p as { kind?: unknown }).kind === "local";
const isDeltaValue = (p: unknown): p is RunDeltaRecordValue => !!p && typeof p === "object" && !isLocalValue(p) && !!(p as { delta?: unknown }).delta;

/** The synced deltas of one repository (C10 past scores). */
export const RUN_DELTAS_BY_REPOSITORY = defineRecordIndex<RunDeltaRecordValue>(
  "run-delta", "vscode.runDelta.repository", (row) => (isDeltaValue(row.payload) ? row.payload.repository : undefined),
);
/** Every run-delta row (synced and side record) of one run. */
export const RUN_DELTAS_BY_RUN = defineRecordIndex<RunDeltaRecordValue | RunDeltaLocalValue>(
  "run-delta", "vscode.runDelta.runId", (row) => row.payload?.runId,
);
/** Every run-delta row (synced and side record) of one chat. */
export const RUN_DELTAS_BY_CHAT = defineRecordIndex<RunDeltaRecordValue | RunDeltaLocalValue>(
  "run-delta", "vscode.runDelta.chatId", (row) => row.payload?.chatId,
);

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The repository identity that may leave the device: a remote URL as it is, a local path as `local:<hash>`. */
export function syncedRepository(repo: string): string {
  return path.isAbsolute(repo) || /^[A-Za-z]:[\\/]/.test(repo) ? `local:${sha(repo.replace(/\\/g, "/")).slice(0, 16)}` : repo;
}

/** `invalid:guards.myGuard` → `invalid:guards#<hash>`: the code and section stay, the repo's own names do not. */
export function redactDropped(codes: readonly string[]): string[] {
  const out = codes.slice(0, MAX_DROPPED).map((code) => {
    const colon = code.indexOf(":");
    if (colon < 0) return code.slice(0, 40);
    const head = code.slice(0, colon);
    const rest = code.slice(colon + 1);
    const dot = rest.indexOf(".");
    const section = (dot < 0 ? rest : rest.slice(0, dot)).slice(0, 32);
    return dot < 0 ? `${head}:${section}` : `${head}:${section}#${sha(rest.slice(dot + 1)).slice(0, 8)}`;
  });
  return codes.length > MAX_DROPPED ? [...out, `truncated:${codes.length - MAX_DROPPED}`] : out;
}

/** `changeset:<runId>:<repoKey>` → `run-delta:<runId>:<repoKey>`: the same run and repository key. */
export function runDeltaId(changeSetId: string): string {
  const repoKey = changeSetId.slice(changeSetId.lastIndexOf(":") + 1);
  const runId = changeSetId.slice("changeset:".length, changeSetId.lastIndexOf(":"));
  return `run-delta:${runId}:${repoKey}`;
}

const localIdOf = (deltaId: string): string => `run-delta-local:${deltaId.slice("run-delta:".length)}`;

export const cardOf = (stored: StoredRunDelta): RunDeltaCard => ({
  chatId: stored.value.chatId, runId: stored.value.runId, repo: stored.local.repo, root: stored.local.root, delta: stored.value.delta,
  ...(stored.value.blocked ? { blocked: { rules: [...stored.value.blocked.rules] } } : {}),
});

/** Stores the delta once (and its side record). Returns false when one was already stored for this run and repository. */
export async function storeRunDelta(
  store: LocalFirstStore,
  deps: { deviceId: string; at: string; destination?: EntityDestination },
  stored: StoredRunDelta,
  /** False once the computation was abandoned: checked inside the transaction, so nothing lands after that. */
  live: () => boolean = () => true,
): Promise<boolean> {
  const id = runDeltaId(stored.value.changeSetId);
  let written = false;
  await store.transact(async (tx) => {
    if (!live() || await tx.get("run-delta", id)) return;
    const record = newLocalRecord<RunDeltaRecordValue>({
      id, entityType: "run-delta", deviceId: deps.deviceId, destination: deps.destination ?? { kind: "unbound" },
      occurredAt: deps.at, schemaVersion: 1, payload: stored.value,
    });
    await tx.put(record);
    await tx.append({
      eventId: `run-delta:create:${id}`,
      clientEntityId: id,
      entityType: "run-delta",
      operation: "create",
      schemaVersion: record.schemaVersion,
      occurredAt: deps.at,
      dependsOn: [`change-set:create:${stored.value.changeSetId}`],
      destination: record.destination,
      payload: record.payload,
    });
    // The side record: put, never appended — no journal event, so the sync never carries it.
    await tx.put(newLocalRecord<RunDeltaLocalValue>({
      id: localIdOf(id), entityType: "run-delta", deviceId: deps.deviceId, occurredAt: deps.at, schemaVersion: 1, payload: stored.local,
    }));
    written = true;
  });
  return written;
}

/** The stored deltas of a run, or of every run of a chat, oldest first, joined with their side records. */
export async function readRunDeltas(store: LocalFirstStore, query: { runId?: string; chatId?: number }): Promise<RunDeltaCard[]> {
  if (query.runId === undefined && query.chatId === undefined) return [];
  const values = new Map<string, { at: string; value: RunDeltaRecordValue }>();
  const locals = new Map<string, RunDeltaLocalValue>();
  const released = new Set<string>();
  await store.read(async (tx) => {
    const visit = (row: { id: string; occurredAt: string; deletedAt?: string; payload: RunDeltaRecordValue | RunDeltaLocalValue }): void => {
      if (row.deletedAt) return;
      if (query.runId !== undefined && row.payload.runId !== query.runId) return;
      if (query.chatId !== undefined && row.payload.chatId !== query.chatId) return;
      if (isLocalValue(row.payload)) locals.set(`run-delta:${row.id.slice("run-delta-local:".length)}`, row.payload);
      else if (isDeltaValue(row.payload)) values.set(row.id, { at: row.occurredAt, value: row.payload });
    };
    if (query.runId !== undefined) await scanByIndex(tx, RUN_DELTAS_BY_RUN, query.runId, visit);
    else await scanByIndex(tx, RUN_DELTAS_BY_CHAT, query.chatId!, visit);
    // §12.5: a held run a person released (its execution carries the waiver) shows its blocking cards as released.
    for (const { value } of values.values()) {
      if (!value.blocked || released.has(value.runId)) continue;
      if ((await tx.get<ExecutionValue>("execution", value.runId))?.payload.waiver) released.add(value.runId);
    }
  });
  return [...values]
    .flatMap(([id, { at, value }]) => {
      const local = locals.get(id);
      if (!local) return [];
      const card = cardOf({ value, local });
      return [{ at, card: value.blocked && released.has(value.runId) ? { ...card, released: true } : card }];
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.card.repo.localeCompare(b.card.repo))
    .map((f) => f.card);
}

/** Past blast-radius scores of a repository (C10), from its stored deltas. */
export async function pastBlastScores(store: LocalFirstStore, repository: string): Promise<number[]> {
  const scores: number[] = [];
  await store.read(async (tx) => {
    await scanByIndex<RunDeltaRecordValue>(tx, RUN_DELTAS_BY_REPOSITORY, repository, (row) => {
      const score = row.payload.delta?.blastRadius?.score;
      if (typeof score === "number") scores.push(score);
    });
  });
  return scores;
}
