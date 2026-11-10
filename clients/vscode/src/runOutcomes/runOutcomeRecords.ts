/**
 * The synced `run-outcome` record on this device (PRD 41 §D1): ONE row per run and repository, holding the run's
 * `RunFeatures` frozen at run end, its per-run commit attribution and its outcome labels — the run-outcomes context's only
 * local copy. Its id is `stableEntityId(runOutcomeKey(runId, repoKey))` (every synced client id is a UUID); its payload
 * carries `kind: 'run-outcome'`, which tells it apart from the device-only gate-ledger rows of the same entity type
 * (brain-embedded `RunOutcomeValue`, keyed by the bare run id and never journaled).
 *
 * Writes go through local-first's ONE journal rule (`journalWrite`): unbound rows journal a marker, bound rows import
 * first. Features never change after the create; attribution and labels are merged in by {@link updateRunOutcome}
 * (labels by THE precedence rule, `mergeLabels`).
 *
 * PRIVACY. The repository is its synced identity (`syncedRepository`: remote URL or `local:<hash>`), never a path; people
 * ids ride under D14's access rules on the server; no code or content is stored.
 */

import {
  defineRecordIndex, journalWrite, newLocalRecord, scanByIndex, stableEntityId,
  type EntityDestination, type LocalFirstStore, type LocalFirstTransaction, type LocalRecord,
} from "@builderforce/local-first";
import {
  isRunOutcomeRecordValue, mergeLabels, runOutcomeKey,
  type CommitAttribution, type RunFeatures, type RunOutcomeLabel, type RunOutcomeRecordValue,
} from "@builderforce/run-delta/predict";

/** The run-outcome rows of one synced repository identity. */
export const RUN_OUTCOMES_BY_REPOSITORY = defineRecordIndex<RunOutcomeRecordValue>(
  "run-outcome", "vscode.runOutcome.repository",
  (row) => (isRunOutcomeRecordValue(row.payload) ? row.payload.repository : undefined),
);

/** The record id of a run's outcome in one repository (`repoKey` as the change set's id carries it). */
export const runOutcomeId = (runId: string, repoKey: string): string => stableEntityId(runOutcomeKey(runId, repoKey));

/** `changeset:<runId>:<repoKey>` → its run-outcome record id. */
export function runOutcomeIdOfChangeSet(changeSetId: string): string {
  const repoKey = changeSetId.slice(changeSetId.lastIndexOf(":") + 1);
  const runId = changeSetId.slice("changeset:".length, changeSetId.lastIndexOf(":"));
  return runOutcomeId(runId, repoKey);
}

const sameAttribution = (a: CommitAttribution, b: CommitAttribution): boolean => a.commitSha === b.commitSha && a.path === b.path;

async function journal(tx: LocalFirstTransaction, record: LocalRecord<RunOutcomeRecordValue>, operation: "create" | "update"): Promise<void> {
  await tx.put(record);
  await journalWrite(tx, record, operation, { key: `run-outcome:${record.id}:v${record.version}` });
}

/** Stores a run's frozen features once. Returns false when that run and repository already has its record. */
export async function recordRunFeatures(
  store: LocalFirstStore,
  input: { id: string; features: RunFeatures; deviceId: string; destination?: EntityDestination; at: string },
): Promise<boolean> {
  let written = false;
  await store.transact(async (tx) => {
    if (await tx.get("run-outcome", input.id)) return;
    const record = newLocalRecord<RunOutcomeRecordValue>({
      id: input.id, entityType: "run-outcome", deviceId: input.deviceId, occurredAt: input.at, schemaVersion: 1,
      ...(input.destination ? { destination: input.destination } : {}),
      payload: {
        kind: "run-outcome", runId: input.features.runId, repository: input.features.repository,
        features: input.features, attribution: [], labels: [],
      },
    });
    await journal(tx, record, "create");
    written = true;
  });
  return written;
}

/**
 * Merges new attribution and labels into a stored run outcome; a write that changes nothing is skipped (no journal event).
 * Returns false when the record does not exist or nothing changed.
 */
export async function updateRunOutcome(
  store: LocalFirstStore,
  id: string,
  change: { attribution?: readonly CommitAttribution[]; labels?: readonly RunOutcomeLabel[]; deviceId: string; at: string },
): Promise<boolean> {
  let written = false;
  await store.transact(async (tx) => {
    const existing = await tx.get<RunOutcomeRecordValue>("run-outcome", id);
    if (!existing || existing.deletedAt || !isRunOutcomeRecordValue(existing.payload)) return;
    const prior = existing.payload;
    const attribution = [...prior.attribution];
    for (const a of change.attribution ?? []) if (!attribution.some((b) => sameAttribution(a, b))) attribution.push(a);
    // A re-computed label that says the same thing (only its `computedAt` moved) is no change: no journal event.
    const same = (a: RunOutcomeLabel, b: RunOutcomeLabel): boolean => JSON.stringify({ ...a, computedAt: "" }) === JSON.stringify({ ...b, computedAt: "" });
    const incoming = (change.labels ?? []).filter((l) => !prior.labels.some((p) => p.kind === l.kind && same(p, l)));
    const labels = mergeLabels(prior.labels, incoming);
    if (attribution.length === prior.attribution.length && JSON.stringify(labels) === JSON.stringify(prior.labels)) return;
    const record: LocalRecord<RunOutcomeRecordValue> = {
      ...existing,
      payload: { ...prior, attribution, labels },
      version: existing.version + 1,
      baseVersion: existing.version,
      occurredAt: change.at,
      updatedAt: change.at,
      provenance: { deviceId: change.deviceId, source: "local" },
    };
    await journal(tx, record, "update");
    written = true;
  });
  return written;
}

/** The live run outcomes of one synced repository identity, with their record ids. */
export async function readRunOutcomes(store: LocalFirstStore, repository: string): Promise<Array<{ id: string; value: RunOutcomeRecordValue }>> {
  const out: Array<{ id: string; value: RunOutcomeRecordValue }> = [];
  await store.read(async (tx) => {
    await scanByIndex<RunOutcomeRecordValue>(tx, RUN_OUTCOMES_BY_REPOSITORY, repository, (row) => {
      if (!row.deletedAt && isRunOutcomeRecordValue(row.payload)) out.push({ id: row.id, value: structuredClone(row.payload) });
    });
  });
  return out.sort((a, b) => a.value.features.finalizedAt.localeCompare(b.value.features.finalizedAt) || a.id.localeCompare(b.id));
}
