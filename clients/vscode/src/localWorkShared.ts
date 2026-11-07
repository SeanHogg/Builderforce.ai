/**
 * What the VSIX local work repository's parts share (review G05): the error type, the
 * ticket status enum, the destination rules, and the ONE commit-plus-journal helper that
 * every record mutation goes through.
 *
 * Rules this module owns (see `localWorkRepository.ts` for the repository as a whole):
 *
 *   • No network. `bfApi`, the gateway and `fetch` are NOT imported.
 *   • A decimal `projectId` / `parentTicketId` is a SERVER reference (the model is handed
 *     numeric server ids): stored verbatim, not looked up locally. A UUID must be a live
 *     local record.
 *   • Identity is DATA, not a live lookup. No account argument means the UNBOUND
 *     partition (G10); binding is the explicit `bindDestination`, never inference.
 *   • Every mutation is a compare-and-set on the record version (the store refuses a
 *     stale writer with `ENTITY_VERSION_CONFLICT`) in ONE transaction with its event.
 *   • The journal rule for a BOUND row is the local-first package's (`journalWrite`,
 *     `queueImport`): a row the server has imported is updated against the server's
 *     version; a row whose import is still pending has that import REPLACED by one that
 *     carries the newest state — never an update against a version the server lacks.
 */

import {
  UNBOUND_DESTINATION,
  destinationKey,
  isImported,
  journalWrite,
  queueImport,
  selectPending,
  selectRecords,
  ticketWaitsOn,
  type DestinationBinding,
  type EntityDestination,
  type LocalFirstTransaction,
  type LocalRecord,
  type ProjectValue,
  type TicketValue,
} from "@builderforce/local-first";

/**
 * A DECIMAL id is a SERVER reference (the model is handed numeric server project and
 * ticket ids), never a local one: client ids are UUIDs.
 */
const SERVER_REFERENCE = /^\d+$/;
export const isServerReference = (id: string): boolean => SERVER_REFERENCE.test(id.trim());

export type LocalProject = LocalRecord<ProjectValue>;
export type LocalTicket = LocalRecord<TicketValue>;

/** The `task_status` Postgres enum, in kanban column order (a copy of `frontend/src/lib/taskStatus.ts`). */
export const LOCAL_TICKET_STATUSES = [
  "backlog",
  "todo",
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "done",
] as const;

export type LocalTicketStatus = (typeof LOCAL_TICKET_STATUSES)[number];

export const DEFAULT_TICKET_STATUS: LocalTicketStatus = "backlog";

export type LocalWorkErrorCode =
  | "project_not_found"
  | "ticket_not_found"
  | "project_name_required"
  | "ticket_title_required"
  | "invalid_status"
  | "ticket_archived"
  | "ticket_has_children"
  | "cross_destination"
  | "destination_required"
  | "destination_account_mismatch"
  | "destination_tenant_mismatch"
  | "destination_rebind_refused"
  | "signed_in_tenant_refused";

export class LocalWorkRepositoryError extends Error {
  constructor(
    readonly code: LocalWorkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalWorkRepositoryError";
  }
}

export type WorkEntityType = "project" | "ticket";

export const eventId = (entityType: WorkEntityType, id: string, version: number): string =>
  `${entityType}:${id}:v${version}`;

// ── Destination rules ────────────────────────────────────────────────────────

const SNAPSHOT_FIELDS = ["platformInstance", "accountId", "tenantId", "projectId", "repository"] as const;
type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/**
 * A destination argument that is really "whoever is signed in": a VS Code
 * authentication session, a secrets bag, or a live lookup function. Those are
 * not account snapshots and must not become a binding.
 */
export function isSignedInTenantLure(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  if ("accessToken" in raw || "scopes" in raw || "signedIn" in raw || "secrets" in raw) return true;
  const account = raw.account;
  if (account && typeof account === "object" && "label" in account && !("accountId" in raw)) return true;
  return false;
}

export function refuseSignedInTenant(value: unknown): void {
  if (!isSignedInTenantLure(value)) return;
  throw new LocalWorkRepositoryError(
    "signed_in_tenant_refused",
    "Refusing to invent a tenant from whoever is signed in. Pass an explicit account snapshot, or leave the record unbound.",
  );
}

/**
 * Copy only the known identity fields of a proposed destination. Mirrors
 * `bindingSnapshot` in `packages/local-first/src/destinationBinding.ts`, which is
 * not re-exported from the package index. `kind: 'unbound'` WINS even when identity
 * fields are present. No known field means the unbound partition, never a partial guess.
 */
export function localBindingSnapshot(
  destination: EntityDestination | DestinationBinding | undefined,
): EntityDestination {
  if (!destination || typeof destination !== "object") return UNBOUND_DESTINATION;
  const raw = destination as unknown as Record<string, unknown>;
  if (raw.kind === "unbound") return UNBOUND_DESTINATION;
  const snapshot: { kind: "bound" } & DestinationBinding = { kind: "bound" };
  let known = false;
  for (const field of SNAPSHOT_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) {
      snapshot[field] = value.trim();
      known = true;
    }
  }
  return known ? Object.freeze(snapshot) : UNBOUND_DESTINATION;
}

/**
 * The destination a NEW record may be stamped with. No account id means unbound —
 * a stray project id or platform instance is not an account, and a tenant id
 * without an account is the signed-in-user guess this module refuses.
 */
export function creationDestination(
  proposed: EntityDestination | DestinationBinding | undefined,
): EntityDestination {
  refuseSignedInTenant(proposed);
  const snapshot = localBindingSnapshot(proposed);
  if (snapshot.kind !== "bound") return UNBOUND_DESTINATION;
  if (!snapshot.accountId) {
    if (snapshot.tenantId) {
      throw new LocalWorkRepositoryError(
        "signed_in_tenant_refused",
        "A tenant id without an account is not a destination. Pass the account snapshot, or leave the record unbound.",
      );
    }
    return UNBOUND_DESTINATION;
  }
  return snapshot;
}

function fieldOf(destination: EntityDestination, field: SnapshotField): string | undefined {
  return destination.kind === "bound" ? destination[field] : undefined;
}

/** The refusal code when `proposed` would replace a bound snapshot. null when it would not. */
export function rebindRefusal(
  existing: EntityDestination,
  proposed: EntityDestination,
): "destination_tenant_mismatch" | "destination_account_mismatch" | "destination_rebind_refused" | null {
  if (existing.kind !== "bound") return null;
  if (fieldOf(existing, "tenantId") !== fieldOf(proposed, "tenantId")) return "destination_tenant_mismatch";
  if (fieldOf(existing, "accountId") !== fieldOf(proposed, "accountId")) return "destination_account_mismatch";
  if (destinationKey(existing) !== destinationKey(proposed)) return "destination_rebind_refused";
  return null;
}

// ── Validation and reads ─────────────────────────────────────────────────────

export function requireText(value: string | undefined, code: LocalWorkErrorCode, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new LocalWorkRepositoryError(code, message);
  return trimmed;
}

export function assertStatus(status: string): void {
  if (!(LOCAL_TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new LocalWorkRepositoryError("invalid_status", `Unknown ticket status: ${status}`);
  }
}

/** The live (not tombstoned) records of one type. */
export async function live<T>(tx: LocalFirstTransaction, entityType: WorkEntityType): Promise<LocalRecord<T>[]> {
  return selectRecords<T>(tx, entityType, (record) => !record.deletedAt);
}

export async function projectFor(tx: LocalFirstTransaction, id: string): Promise<LocalProject> {
  const record = await tx.get<ProjectValue>("project", id);
  if (!record || record.deletedAt) {
    throw new LocalWorkRepositoryError("project_not_found", `No such local project: ${id}`);
  }
  return record;
}

export async function ticketFor(tx: LocalFirstTransaction, id: string): Promise<LocalTicket> {
  const record = await tx.get<TicketValue>("ticket", id);
  if (!record || record.deletedAt) {
    throw new LocalWorkRepositoryError("ticket_not_found", `No such local ticket: ${id}`);
  }
  return record;
}

/**
 * The key of the newest event still pending for a record — whatever it currently is (a
 * create, an update, or the `…:import` a bind replaced them with). A child waits on THIS,
 * never on a guessed `…:v1` that a bind may have retired. None pending ⇒ nothing to wait
 * for (the server already holds the record, or it is not a local one).
 */
export async function pendingKeyOf(
  tx: LocalFirstTransaction,
  entityType: LocalRecord["entityType"],
  id: string,
): Promise<string | undefined> {
  const own = await selectPending(tx, (event) => event.clientEntityId === id && event.entityType === entityType);
  return own[own.length - 1]?.eventId;
}

// ── The commit + journal helper ──────────────────────────────────────────────

export interface CommitContext {
  now(): Date;
}

/**
 * Commit a mutated record and its journal event in the caller's transaction.
 * `bind` replaces the record's destination — used ONLY by bindDestination, so the
 * appended update event carries the NEW destination rather than the stale one.
 */
export async function commitRecord<T>(
  ctx: CommitContext,
  tx: LocalFirstTransaction,
  current: LocalRecord<T>,
  payload: T,
  operation: "update" | "delete",
  dependsOn: string[] = [],
  bind?: EntityDestination,
): Promise<LocalRecord<T>> {
  const stamp = ctx.now().toISOString();
  const next: LocalRecord<T> = {
    ...current,
    version: current.version + 1,
    baseVersion: current.version,
    updatedAt: stamp,
    ...(bind ? { destination: bind } : {}),
    ...(operation === "delete" ? { deletedAt: stamp } : {}),
    payload,
  };
  // The store owns the optimistic-concurrency rule: a stale expectedVersion here
  // fails the whole transaction with ENTITY_VERSION_CONFLICT and writes nothing.
  await tx.put(next, current.version);
  const type = next.entityType as WorkEntityType;
  if (!bind && next.destination.kind === "bound") {
    const mapping = await tx.mapping(next.entityType, next.id, next.destination);
    if (isImported(mapping)) {
      // Imported: update against the version the server holds, superseding an older pending one.
      await journalWrite(tx, next, operation, { key: eventId(type, next.id, next.version) });
      return next;
    }
    const pending = await selectPending(tx, (event) => event.clientEntityId === next.id && event.entityType === next.entityType);
    if (pending.some((event) => event.operation === "import")) {
      // Bound by the sync pass but not yet imported: the server has no version to apply an
      // update against, so the pending import is REPLACED by one carrying this newest state
      // (with the same chat / project / parent waits the bind gave it).
      const chatClientId = type === "ticket" ? (payload as TicketValue).chatClientId : undefined;
      const waitsOn = type === "ticket" ? ticketWaitsOn(payload as TicketValue) : [];
      await queueImport(tx, next, chatClientId, waitsOn);
      return next;
    }
  }
  await tx.append({
    eventId: eventId(type, next.id, next.version),
    clientEntityId: next.id,
    entityType: next.entityType,
    operation,
    schemaVersion: next.schemaVersion,
    occurredAt: stamp,
    baseVersion: current.version,
    dependsOn,
    destination: next.destination,
    payload,
  });
  return next;
}

