/**
 * Present one entity's sync status from the local store (G23).
 *
 * Derivation stays in `@builderforce/local-first` `deriveRecordSyncStatus`. This module
 * does not cache a second status, does not read `platformRequestAccount`, and
 * does not call the network. A later UI slice localizes the code; this file
 * does not call `vscode.l10n.t`.
 *
 * Store status `local` is presented as `pending`. An unsettled journal row is
 * the store's `syncing` (queued or in flight — the store has no second
 * in-flight cache). Presentation precedence, which outranks the store model's
 * conflict-over-dead-letter rule:
 * dead-letter, then conflict, then syncing, then pending, then synced.
 */
import type { LocalEntityType, LocalFirstSnapshot, LocalRecord } from "@builderforce/local-first";
import {
  deriveRecordSyncStatus,
  syncShownAsDone,
  type SyncStatus,
  type SyncStatusInput,
} from "../../../packages/local-first/src/syncStatus.ts";

export const PRESENTED_SYNC_STATUSES = ["pending", "syncing", "synced", "conflict", "dead-letter"] as const;

export type PresentedSyncStatus = (typeof PRESENTED_SYNC_STATUSES)[number];

/** Highest precedence first. Index 0 wins. */
export const PRESENTED_SYNC_PRECEDENCE = [
  "dead-letter",
  "conflict",
  "syncing",
  "pending",
  "synced",
] as const satisfies readonly PresentedSyncStatus[];

export const SYNC_STATUS_SURFACES = ["chat", "ticket", "audit", "run"] as const;

export type SyncStatusSurface = (typeof SYNC_STATUS_SURFACES)[number];

const SURFACE_ENTITY: Record<SyncStatusSurface, LocalEntityType> = {
  chat: "chat",
  ticket: "ticket",
  audit: "audit-run",
  run: "execution",
};

function precedenceRank(status: PresentedSyncStatus): number {
  const rank = PRESENTED_SYNC_PRECEDENCE.indexOf(status);
  if (rank < 0) throw new Error(`sync_status_unknown:${status}`);
  return rank;
}

/**
 * Pick one code. Dead-letter beats conflict, which beats syncing, which beats
 * pending, which beats synced. Input order does not matter.
 */
export function preferPresentedSyncStatus(statuses: readonly PresentedSyncStatus[]): PresentedSyncStatus {
  const winner = statuses.reduce<PresentedSyncStatus | undefined>((best, status) => {
    if (!best || precedenceRank(status) < precedenceRank(best)) return status;
    return best;
  }, undefined);
  if (!winner) throw new Error("sync_status_required");
  return winner;
}

/** Map the store model. `local` is presented as `pending`; the other codes pass through. */
export function presentDerivedSyncStatus(status: SyncStatus): PresentedSyncStatus {
  return status === "local" ? "pending" : status;
}

/**
 * The store model hides a dead letter behind an open conflict. Ask it again
 * with the conflict facts removed so presentation can put the dead letter first.
 */
function deadLetterAsideFromConflict(input: SyncStatusInput): boolean {
  return (
    deriveRecordSyncStatus({
      record: input.record,
      events: input.events,
      receipts: (input.receipts ?? []).filter((receipt) => receipt.status !== "conflict"),
      conflicts: [],
    }) === "dead-letter"
  );
}

/**
 * Status for one store record and its journal facts.
 * Events, receipts, and conflicts for other records are ignored by the store model.
 */
export function presentSyncStatus(input: SyncStatusInput): PresentedSyncStatus {
  const derived = presentDerivedSyncStatus(deriveRecordSyncStatus(input));
  const statuses: PresentedSyncStatus[] = [derived];
  if (derived !== "dead-letter" && deadLetterAsideFromConflict(input)) statuses.push("dead-letter");
  return preferPresentedSyncStatus(statuses);
}

export function presentStoreSyncStatus(
  snapshot: Pick<LocalFirstSnapshot, "records" | "events" | "receipts" | "conflicts">,
  entity: { readonly entityType: LocalEntityType; readonly id: string },
): PresentedSyncStatus | undefined {
  const record = snapshot.records.find((row) => row.entityType === entity.entityType && row.id === entity.id);
  if (!record) return undefined;
  return presentSyncStatus({
    record,
    events: snapshot.events,
    receipts: snapshot.receipts,
    conflicts: snapshot.conflicts,
  });
}

/** Chat, ticket, audit (`audit-run`), or run (`execution`). Missing records are not invented as pending. */
export function presentSurfaceSyncStatus(
  snapshot: Pick<LocalFirstSnapshot, "records" | "events" | "receipts" | "conflicts">,
  surface: SyncStatusSurface,
  id: string,
): PresentedSyncStatus | undefined {
  return presentStoreSyncStatus(snapshot, { entityType: SURFACE_ENTITY[surface], id });
}

function toStoreStatus(status: PresentedSyncStatus): SyncStatus {
  return status === "pending" ? "local" : status;
}

/** A denied, conflicting, or dead-lettered sync is not done. Delegates to the store rule. */
export function presentedSyncShownAsDone(record: LocalRecord, status: PresentedSyncStatus): boolean {
  return syncShownAsDone(record, toStoreStatus(status));
}
