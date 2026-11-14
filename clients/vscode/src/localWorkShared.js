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
import { UNBOUND_DESTINATION, destinationKey, isImported, journalWrite, parseSyncId, queueImport, selectPending, selectRecords, ticketWaitsOn, } from "@builderforce/local-first";
/**
 * A DECIMAL id is a SERVER reference (the model is handed numeric server project and
 * ticket ids), never a local one: client ids are UUIDs. `parseSyncId` is the one parse.
 */
export const isServerReference = (id) => parseSyncId(id.trim()) !== null;
/** The `task_status` Postgres enum, in kanban column order (a copy of `frontend/src/lib/taskStatus.ts`). */
export const LOCAL_TICKET_STATUSES = [
    "backlog",
    "todo",
    "ready",
    "in_progress",
    "in_review",
    "blocked",
    "done",
];
export const DEFAULT_TICKET_STATUS = "backlog";
export class LocalWorkRepositoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "LocalWorkRepositoryError";
    }
}
export const eventId = (entityType, id, version) => `${entityType}:${id}:v${version}`;
// ── Destination rules ────────────────────────────────────────────────────────
const SNAPSHOT_FIELDS = ["platformInstance", "accountId", "tenantId", "projectId", "repository"];
/**
 * A destination argument that is really "whoever is signed in": a VS Code
 * authentication session, a secrets bag, or a live lookup function. Those are
 * not account snapshots and must not become a binding.
 */
export function isSignedInTenantLure(value) {
    if (typeof value === "function")
        return true;
    if (!value || typeof value !== "object")
        return false;
    const raw = value;
    if ("accessToken" in raw || "scopes" in raw || "signedIn" in raw || "secrets" in raw)
        return true;
    const account = raw.account;
    if (account && typeof account === "object" && "label" in account && !("accountId" in raw))
        return true;
    return false;
}
export function refuseSignedInTenant(value) {
    if (!isSignedInTenantLure(value))
        return;
    throw new LocalWorkRepositoryError("signed_in_tenant_refused", "Refusing to invent a tenant from whoever is signed in. Pass an explicit account snapshot, or leave the record unbound.");
}
/**
 * Copy only the known identity fields of a proposed destination. Mirrors
 * `bindingSnapshot` in `packages/local-first/src/destinationBinding.ts`, which is
 * not re-exported from the package index. `kind: 'unbound'` WINS even when identity
 * fields are present. No known field means the unbound partition, never a partial guess.
 */
export function localBindingSnapshot(destination) {
    if (!destination || typeof destination !== "object")
        return UNBOUND_DESTINATION;
    const raw = destination;
    if (raw.kind === "unbound")
        return UNBOUND_DESTINATION;
    const snapshot = { kind: "bound" };
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
export function creationDestination(proposed) {
    refuseSignedInTenant(proposed);
    const snapshot = localBindingSnapshot(proposed);
    if (snapshot.kind !== "bound")
        return UNBOUND_DESTINATION;
    if (!snapshot.accountId) {
        if (snapshot.tenantId) {
            throw new LocalWorkRepositoryError("signed_in_tenant_refused", "A tenant id without an account is not a destination. Pass the account snapshot, or leave the record unbound.");
        }
        return UNBOUND_DESTINATION;
    }
    return snapshot;
}
function fieldOf(destination, field) {
    return destination.kind === "bound" ? destination[field] : undefined;
}
/** The refusal code when `proposed` would replace a bound snapshot. null when it would not. */
export function rebindRefusal(existing, proposed) {
    if (existing.kind !== "bound")
        return null;
    if (fieldOf(existing, "tenantId") !== fieldOf(proposed, "tenantId"))
        return "destination_tenant_mismatch";
    if (fieldOf(existing, "accountId") !== fieldOf(proposed, "accountId"))
        return "destination_account_mismatch";
    if (destinationKey(existing) !== destinationKey(proposed))
        return "destination_rebind_refused";
    return null;
}
// ── Validation and reads ─────────────────────────────────────────────────────
export function requireText(value, code, message) {
    const trimmed = value?.trim() ?? "";
    if (!trimmed)
        throw new LocalWorkRepositoryError(code, message);
    return trimmed;
}
export function assertStatus(status) {
    if (!LOCAL_TICKET_STATUSES.includes(status)) {
        throw new LocalWorkRepositoryError("invalid_status", `Unknown ticket status: ${status}`);
    }
}
/** The live (not tombstoned) records of one type. */
export async function live(tx, entityType) {
    return selectRecords(tx, entityType, (record) => !record.deletedAt);
}
export async function projectFor(tx, id) {
    const record = await tx.get("project", id);
    if (!record || record.deletedAt) {
        throw new LocalWorkRepositoryError("project_not_found", `No such local project: ${id}`);
    }
    return record;
}
export async function ticketFor(tx, id) {
    const record = await tx.get("ticket", id);
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
export async function pendingKeyOf(tx, entityType, id) {
    const own = await selectPending(tx, (event) => event.clientEntityId === id && event.entityType === entityType);
    const latest = own[own.length - 1];
    return latest ? (latest.idempotencyKey ?? latest.eventId) : undefined;
}
/**
 * The key a NEW record must wait on for the record it references: its newest pending event,
 * and only while the server has not imported it. An imported record (or one that is not a
 * local record at all) is nothing to wait for.
 */
export async function waitKeyOf(tx, entityType, id) {
    const record = await tx.get(entityType, id);
    if (!record)
        return undefined;
    if (isImported(await tx.mapping(entityType, id, record.destination)))
        return undefined;
    return pendingKeyOf(tx, entityType, id);
}
/**
 * Commit a mutated record and its journal event in the caller's transaction.
 * `bind` replaces the record's destination — used ONLY by bindDestination, so the
 * appended update event carries the NEW destination rather than the stale one.
 */
export async function commitRecord(ctx, tx, current, payload, operation, dependsOn = [], bind) {
    const stamp = ctx.now().toISOString();
    const next = {
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
    const type = next.entityType;
    if (!bind && next.destination.kind === "bound") {
        const mapping = await tx.mapping(next.entityType, next.id, next.destination);
        if (isImported(mapping)) {
            // Imported: update against the version the server holds, superseding an older
            // pending write (the chat journal's rule). Superseding drops the prior pending event,
            // so there is nothing left for the update to wait on.
            await journalWrite(tx, next, operation, { key: eventId(type, next.id, next.version) });
            return next;
        }
        // NOT imported — still pending, held back, or dead-lettered: the server has no version
        // to apply an update against, so the row is (re)IMPORTED with its newest state, with the
        // same chat / project / parent waits the bind gave it. A delete sends nothing.
        const chatClientId = type === "ticket" ? payload.chatClientId : undefined;
        const waitsOn = type === "ticket" ? ticketWaitsOn(payload) : [];
        await queueImport(tx, next, chatClientId, waitsOn);
        return next;
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
//# sourceMappingURL=localWorkShared.js.map