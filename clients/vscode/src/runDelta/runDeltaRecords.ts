/**
 * The `run-delta` local-first record (PRD 41 §C14): one per run and repository, id `stableEntityId('run-delta:<runId>:<repoKey>')`
 * (a UUID, as every synced client id is; the payload carries `runId`, `repoKey` and `projectId` for the server), written once
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
import { defineRecordIndex, newLocalRecord, scanByIndex, stableEntityId, type EntityDestination, type LocalFirstStore, type LocalFirstTransaction } from "@builderforce/local-first";
import type { ComputedRunDeltaCard, RunDelta } from "@builderforce/run-delta";
import { syncedRepositoryIdentity } from "../repoIdentity";
import { droppedOverrides } from "./droppedOverrides";
import { readRunHolds, withHold, type RunHoldState } from "./runHoldState";
import type { RunPredictionValue } from "./runDeltaPredictions";
import type { RunDeltaScheduleValue } from "./dynamicSchedule";

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
   * IGNORED, no longer written (§12.5): records stored before the hold moved to the execution carried the rules that held
   * their run here. Whether a run is held is its execution's `hold` (`runHoldState.ts`), never this field.
   */
  blocked?: { rules: string[] };
  /** Ignored `.builderforce/delta.json` entries, redacted ({@link redactDropped}). */
  overridesDropped?: string[];
  /** The run's repository key (the change set's): the server keys the delta by (run, repo key), never by the record id. */
  repoKey?: string;
  /** The server project the run's chat belonged to, when the host knew one (the server re-gates it to the tenant). */
  projectId?: number;
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
  /** The transcript message the run produced (its last reply, a local message id): the card's anchor. */
  at?: number;
}

/**
 * A computed card (the contract's {@link ComputedRunDeltaCard}): what `run-delta/card` carries and `run-delta/get` answers
 * with once the delta is stored. Local data, never synced.
 */
export type RunDeltaCard = ComputedRunDeltaCard;

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
/** Every run-delta row of one run: synced, side record and prediction row (`runDeltaPredictions.ts`). */
export const RUN_DELTAS_BY_RUN = defineRecordIndex<RunDeltaRecordValue | RunDeltaLocalValue | RunPredictionValue | RunDeltaScheduleValue>(
  "run-delta", "vscode.runDelta.runId", (row) => row.payload?.runId,
);
/** Every run-delta row of one chat: synced, side record and prediction row. */
export const RUN_DELTAS_BY_CHAT = defineRecordIndex<RunDeltaRecordValue | RunDeltaLocalValue | RunPredictionValue>(
  "run-delta", "vscode.runDelta.chatId", (row) => row.payload?.chatId,
);

/** sha256 hex of a text (redacted codes, the schedule rows' repository key). */
export const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The repository identity that may leave the device: a remote URL without credentials, a local path as `local:<hash>` (`repoIdentity.ts`). */
export function syncedRepository(repo: string): string {
  return syncedRepositoryIdentity(repo);
}

/**
 * `invalid:guards.myGuard` → `invalid:guards#<hash>`: the code and section stay, the repo's own names do not. An
 * `unsafe-regex:<section>.<reason>` keeps its reason: a fixed code (`UnsafeReason`), never the pattern.
 */
export function redactDropped(codes: readonly string[]): string[] {
  const out = codes.slice(0, MAX_DROPPED).map((code) => {
    const colon = code.indexOf(":");
    if (colon < 0) return code.slice(0, 40);
    const head = code.slice(0, colon);
    const rest = code.slice(colon + 1);
    const dot = rest.indexOf(".");
    const section = (dot < 0 ? rest : rest.slice(0, dot)).slice(0, 32);
    if (head === "unsafe-regex" && dot >= 0 && /^[a-z][a-z-]{0,31}$/.test(rest.slice(dot + 1))) return `${head}:${section}.${rest.slice(dot + 1)}`;
    return dot < 0 ? `${head}:${section}` : `${head}:${section}#${sha(rest.slice(dot + 1)).slice(0, 8)}`;
  });
  return codes.length > MAX_DROPPED ? [...out, `truncated:${codes.length - MAX_DROPPED}`] : out;
}

/** `changeset:<runId>:<repoKey>` → the natural key `run-delta:<runId>:<repoKey>`: the same run and repository key. */
export function runDeltaKey(changeSetId: string): string {
  const repoKey = changeSetId.slice(changeSetId.lastIndexOf(":") + 1);
  const runId = changeSetId.slice("changeset:".length, changeSetId.lastIndexOf(":"));
  return `run-delta:${runId}:${repoKey}`;
}

/** The synced record id: `stableEntityId(runDeltaKey(...))` — every client entity id the sync accepts is a UUID. */
export function runDeltaId(changeSetId: string): string {
  return stableEntityId(runDeltaKey(changeSetId));
}

const repoKeyOf = (key: string): string => key.slice(key.lastIndexOf(":") + 1);
/** The device-only rows keep the natural key (they are never synced). */
const localIdOf = (key: string): string => `run-delta-local:${key.slice("run-delta:".length)}`;

function cardExtrasOf({ value, local }: StoredRunDelta): Pick<RunDeltaCard, "at" | "overrides"> {
  const overrides = droppedOverrides(value.overridesDropped);
  return { ...(typeof local.at === "number" ? { at: local.at } : {}), ...(overrides ? { overrides } : {}) };
}

/**
 * The repository as a card names (and displays) it: a remote through {@link syncedRepositoryIdentity} — never a URL with a
 * token in it — and a local repository by its own path (a `local:<hash>` reads as nothing to a person; a path that carries
 * userinfo is hashed like any other). The raw identity stays in the side record for the device's own lookups.
 */
export function cardRepository(repo: string): string {
  const synced = syncedRepositoryIdentity(repo);
  return synced.startsWith("local:") && !repo.includes("@") ? repo : synced;
}

/**
 * A stored delta's card: anchored to its run's reply (`at`), with the overrides it ran without (redacted). Its hold state
 * is not the record's: readers add it from the run's execution (`runHoldState.withHold`).
 */
export const cardOf = (stored: StoredRunDelta): RunDeltaCard => ({
  chatId: stored.value.chatId, runId: stored.value.runId, repo: cardRepository(stored.local.repo), root: stored.local.root, delta: stored.value.delta,
  ...cardExtrasOf(stored),
});

/** Stores the delta once (and its side record). Returns false when one was already stored for this run and repository. */
export async function storeRunDelta(
  store: LocalFirstStore,
  deps: { deviceId: string; at: string; destination?: EntityDestination },
  stored: StoredRunDelta,
  /** False once the computation was abandoned: checked inside the transaction, so nothing lands after that. */
  live: () => boolean = () => true,
): Promise<boolean> {
  const key = runDeltaKey(stored.value.changeSetId);
  const id = stableEntityId(key);
  let written = false;
  await store.transact(async (tx) => {
    if (!live() || await tx.get("run-delta", id)) return;
    const record = newLocalRecord<RunDeltaRecordValue>({
      id, entityType: "run-delta", deviceId: deps.deviceId, destination: deps.destination ?? { kind: "unbound" },
      occurredAt: deps.at, schemaVersion: 1, payload: { ...stored.value, repoKey: repoKeyOf(key) },
    });
    await tx.put(record);
    await tx.append({
      eventId: `run-delta:create:${id}`,
      clientEntityId: id,
      entityType: "run-delta",
      operation: "create",
      schemaVersion: record.schemaVersion,
      occurredAt: deps.at,
      // No `dependsOn` on the change set: the server importer never reads it, and a change set's id
      // (`changeset:<runId>:<repoKey>`) is not a UUID, so the push refuses its event; a dependency on it would hold
      // this delta `dependency_pending` forever.
      dependsOn: [],
      destination: record.destination,
      payload: record.payload,
    });
    // The side record: put, never appended — no journal event, so the sync never carries it.
    await tx.put(newLocalRecord<RunDeltaLocalValue>({
      id: localIdOf(key), entityType: "run-delta", deviceId: deps.deviceId, occurredAt: deps.at, schemaVersion: 1, payload: stored.local,
    }));
    await putBlastScore(tx, deps, key, stored.value);
    written = true;
  });
  return written;
}

/**
 * Supersedes a stored delta with its FINAL revision (PRD 41 §6 "Agent run": the L3 analyzers settled after the static delta
 * was stored with them `pending`): the same record, its delta (and so its digest) replaced, version + 1, journaled as an
 * `update` so the sync carries the revision. False when the record is gone, or already carries this delta.
 */
export async function reviseRunDelta(
  store: LocalFirstStore, deps: { at: string }, stored: StoredRunDelta,
): Promise<boolean> {
  const key = runDeltaKey(stored.value.changeSetId);
  const id = stableEntityId(key);
  let written = false;
  await store.transact(async (tx) => {
    const existing = await tx.get<RunDeltaRecordValue>("run-delta", id);
    if (!existing || existing.payload.delta.digest === stored.value.delta.digest) return;
    const payload: RunDeltaRecordValue = { ...existing.payload, delta: stored.value.delta, computedMs: stored.value.computedMs };
    await tx.put<RunDeltaRecordValue>({ ...existing, version: existing.version + 1, updatedAt: deps.at, payload }, existing.version);
    await tx.append({
      eventId: `run-delta:revise:${id}:${stored.value.delta.digest}`,
      clientEntityId: id,
      entityType: "run-delta",
      operation: "update",
      schemaVersion: existing.schemaVersion,
      occurredAt: deps.at,
      dependsOn: [`run-delta:create:${id}`],
      destination: existing.destination,
      payload,
    });
    written = true;
  });
  return written;
}

/**
 * The stored deltas of a run, or of every run of a chat, oldest first, joined with their side records — each with its
 * run's hold state as the run's EXECUTION says it (§12.5, `runHoldState.ts`): held, released, or neither.
 */
export async function readRunDeltas(store: LocalFirstStore, query: { runId?: string; chatId?: number }): Promise<RunDeltaCard[]> {
  if (query.runId === undefined && query.chatId === undefined) return [];
  const values = new Map<string, { at: string; value: RunDeltaRecordValue }>();
  const locals = new Map<string, RunDeltaLocalValue>();
  let holds = new Map<string, RunHoldState>();
  await store.read(async (tx) => {
    const visit = (row: { id: string; occurredAt: string; deletedAt?: string; payload: RunDeltaRecordValue | RunDeltaLocalValue | RunPredictionValue }): void => {
      if (row.deletedAt) return;
      if (query.runId !== undefined && row.payload.runId !== query.runId) return;
      if (query.chatId !== undefined && row.payload.chatId !== query.chatId) return;
      if (isLocalValue(row.payload)) locals.set(stableEntityId(`run-delta:${row.id.slice("run-delta-local:".length)}`), row.payload);
      else if (isDeltaValue(row.payload)) values.set(row.id, { at: row.occurredAt, value: row.payload });
    };
    if (query.runId !== undefined) await scanByIndex(tx, RUN_DELTAS_BY_RUN, query.runId, visit);
    else await scanByIndex(tx, RUN_DELTAS_BY_CHAT, query.chatId!, visit);
    // §12.5: held or released is the execution's hold / waiver, never the record's own flag.
    holds = await readRunHolds(tx, [...values.values()].map(({ value }) => value.runId));
  });
  return [...values]
    .flatMap(([id, { at, value }]) => {
      const local = locals.get(id);
      if (!local) return [];
      return [{ at, card: withHold(cardOf({ value, local }), holds.get(value.runId)) }];
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.card.repo.localeCompare(b.card.repo))
    .map((f) => f.card);
}

/** At most this many past blast-radius scores (the newest) feed a delta's ranking (C10). */
export const MAX_PAST_SCORES = 200;

/**
 * The device-only score row, `run-delta-score:<runId>:<repoKey>`: one number per stored delta, indexed by repository, so
 * the ranking reads a repository's scores without loading a single delta payload. Put with the delta (never journaled).
 */
export interface RunDeltaScoreValue {
  kind: "score";
  /** As synced ({@link RunDeltaRecordValue.repository}). */
  repository: string;
  score: number;
  /** When the delta was stored (ISO): the newest {@link MAX_PAST_SCORES} are read. */
  at: string;
}

const isScoreValue = (p: unknown): p is RunDeltaScoreValue => !!p && typeof p === "object" && (p as { kind?: unknown }).kind === "score";

/** The score rows of one repository (C10 past scores). */
export const RUN_DELTA_SCORES_BY_REPOSITORY = defineRecordIndex<RunDeltaScoreValue>(
  "run-delta", "vscode.runDelta.scoreRepository", (row) => (isScoreValue(row.payload) ? row.payload.repository : undefined),
);

async function putBlastScore(
  tx: Pick<LocalFirstTransaction, "put">, deps: { deviceId: string; at: string }, deltaKey: string, value: RunDeltaRecordValue,
): Promise<void> {
  const score = value.delta.blastRadius?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return;
  await tx.put(newLocalRecord<RunDeltaScoreValue>({
    id: `run-delta-score:${deltaKey.slice("run-delta:".length)}`, entityType: "run-delta", deviceId: deps.deviceId,
    occurredAt: deps.at, schemaVersion: 1, payload: { kind: "score", repository: value.repository, score, at: deps.at },
  }));
}

/** Past blast-radius scores of a repository (C10): the newest {@link MAX_PAST_SCORES}, from its score rows alone. */
export async function pastBlastScores(store: LocalFirstStore, repository: string, limit = MAX_PAST_SCORES): Promise<number[]> {
  const rows: Array<{ at: string; score: number }> = [];
  await store.read(async (tx) => {
    await scanByIndex<RunDeltaScoreValue>(tx, RUN_DELTA_SCORES_BY_REPOSITORY, repository, (row) => {
      rows.push({ at: row.payload.at, score: row.payload.score });
    });
  });
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit).map((r) => r.score);
}
