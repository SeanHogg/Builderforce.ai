/**
 * VSIX local domain tools (review G06).
 *
 * This module is the LOCAL ADAPTER set: in the editor the local repository IS the
 * project/ticket tool — signed in or not, sync granted or not — and the server twins
 * (`builtin_tasks_create`, …) are not offered (`localDomainToolRouting.ts`). A write
 * lands on this device and the journal event it appended is what the batched
 * local-first sync later carries to the account; no ticket is ever one API request.
 *
 * Rules this module owns:
 *
 *   • No network. `bfApi`, `platformTools`, the gateway, `vscode` and `fetch` are
 *     NOT imported, and there is no code path that turns a local write into a
 *     platform request.
 *   • The repository is a PORT (`LocalWorkRepositoryPort`), not an import of a
 *     live singleton: the host passes the G05 repository
 *     (`createLocalWorkRepository`) and a test passes a fake. Nothing here constructs a store or
 *     reads global state.
 *   • A server MCP tool, cloud execution, meeting join and remote session read are
 *     CONNECTED-ONLY: refused with a code, never queued as offline history, and
 *     never silently substituted with a local write (G06's "classify the rest").
 *   • The sync handoff is the SAME journal event the local transaction appended.
 *     `createLocalWorkRepository` commits record + event in one transaction, so
 *     this module reads that event back out of the store's pending journal after
 *     the write and hands it to the injected queue. It never authors a second,
 *     looser copy of the event, and a crash between the write and the enqueue
 *     still leaves the event pending in the store.
 *   • Activation does not call this. Composition into the tool catalog is the run
 *     host's (`brainRunHostPorts.ts` → `localDomainToolRouting.ts`), so the module
 *     imports nothing from `vscode` and stays testable headlessly.
 *
 * Statuses come from `LOCAL_TICKET_STATUSES` (the `task_status` enum copy that
 * `localWorkRepository.ts` owns) rather than a second list, so the tool and the
 * repository cannot disagree about what a valid status is.
 */
import { LOCAL_DOMAIN_TOOL_NAMES, classifyDomainTool, destinationKey, normalizeDomainToolName, } from "@builderforce/local-first";
import { namesServerOnlyRecord, resolveLocalReference, writtenEntityIds } from "./localEntityRefs";
import { createLocalWorkRepository } from "./localWorkRepository";
import { DEFAULT_TICKET_STATUS, LOCAL_TICKET_STATUSES } from "./localWorkShared";
// The classification table is the package's (`packages/local-first/src/domainToolClass.ts`),
// the ONE copy. This host performs only the names it has a repository write for
// (`LOCAL_DOMAIN_TOOL_SPECS` in `localDomainToolRouting.ts`); the rest of the table's
// "local" names answer `unknown_domain_tool` if one is ever called.
export { CONNECTED_ONLY_DOMAIN_TOOL_NAMES, LOCAL_DOMAIN_TOOL_NAMES, looksLikeServerMcpTool, } from "@builderforce/local-first";
/** The classification as a plain mode string: "local" | "connected-only" | "unknown". */
export function classifyLocalDomainTool(name) {
    return classifyDomainTool(name).mode;
}
export class LocalDomainToolError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "LocalDomainToolError";
    }
}
/** An array-backed queue for hosts that have no writer yet. NOT durable. */
export function createInMemoryLocalSyncQueue() {
    const queued = [];
    return {
        enqueue(events) {
            queued.push(...events);
        },
        queued,
    };
}
// ── Argument validation (before the store is touched) ─────────────────────────
function fail(code, message) {
    throw new LocalDomainToolError(code, message);
}
function requireString(args, key) {
    const raw = args[key];
    if (typeof raw !== "string" || raw.trim() === "") {
        fail("tool_arguments_required", `${key} is required and must be a non-empty string.`);
    }
    return raw.trim();
}
function optionalString(args, key) {
    const raw = args[key];
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== "string")
        fail("invalid_arguments", `${key} must be a string when given.`);
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
}
function optionalFlag(args, key, fallback) {
    const raw = args[key];
    if (raw === undefined || raw === null)
        return fallback;
    if (typeof raw !== "boolean")
        fail("invalid_arguments", `${key} must be true or false.`);
    return raw;
}
function statusOf(args, fallback) {
    const raw = args.status;
    if (raw === undefined || raw === null) {
        if (fallback === undefined)
            fail("tool_arguments_required", "status is required.");
        return fallback;
    }
    if (typeof raw !== "string")
        fail("invalid_arguments", "status must be a string.");
    const status = raw.trim();
    if (!LOCAL_TICKET_STATUSES.includes(status)) {
        fail("invalid_status", `Unknown ticket status: ${status}`);
    }
    return status;
}
/** `taskType` when given: task | epic | gap. Absent ⇒ nothing (the ticket reads as a task). */
function taskTypeOf(args) {
    const raw = optionalString(args, "taskType");
    if (raw === undefined)
        return {};
    if (raw !== "task" && raw !== "epic" && raw !== "gap") {
        fail("invalid_arguments", `taskType must be task, epic or gap (got ${raw}).`);
    }
    return { taskType: raw };
}
/**
 * The local id a `ticket-*` write targets. A numeric id is mapped to its local mirror by
 * `resolveLocalReference` (`localEntityRefs.ts`); with no mirror the ticket exists only on the
 * account, which these tools cannot edit — the model is told the tool that can.
 */
async function localTicketId(store, args, scope) {
    const given = requireString(args, "id");
    const id = await resolveLocalReference(store, "ticket", given, scope);
    if (namesServerOnlyRecord(id)) {
        fail("server_only_ticket", `Ticket ${given} exists only on the account (no local copy on this device). Use builtin_tasks_update for it; ticket-* tools edit tickets created on this device.`);
    }
    return id;
}
async function writeLocally(tool, repository, store, args, scope) {
    switch (tool) {
        case "project-create": {
            const key = optionalString(args, "key");
            const status = optionalString(args, "status");
            const id = optionalString(args, "id");
            const record = await repository.createProject({
                name: requireString(args, "name"),
                ...(key ? { key } : {}),
                ...(status ? { status } : {}),
                ...(id ? { id } : {}),
            });
            return { entityType: "project", id: record.id, record };
        }
        case "project-update": {
            const id = requireString(args, "id");
            const patch = {};
            const name = optionalString(args, "name");
            if (args.name !== undefined && !name)
                fail("tool_arguments_required", "name must not be blank.");
            if (name)
                patch.name = name;
            const key = optionalString(args, "key");
            if (key !== undefined)
                patch.key = key;
            const status = optionalString(args, "status");
            if (status !== undefined)
                patch.status = status;
            if (Object.keys(patch).length === 0)
                fail("tool_arguments_required", "Nothing to update.");
            return { entityType: "project", id, record: await repository.updateProject(id, patch) };
        }
        case "project-archive": {
            // A tombstone, never a row removal — the repository cascades to its tickets.
            const id = requireString(args, "id");
            await repository.deleteProject(id);
            return { entityType: "project", id };
        }
        case "ticket-create": {
            const description = optionalString(args, "description");
            const priority = optionalString(args, "priority");
            const parentTicketId = optionalString(args, "parentTicketId");
            const chatClientId = optionalString(args, "chatClientId");
            const id = optionalString(args, "id");
            const record = await repository.createTicket({
                projectId: await resolveLocalReference(store, "project", requireString(args, "projectId"), scope),
                title: requireString(args, "title"),
                status: statusOf(args, DEFAULT_TICKET_STATUS),
                ...(description ? { description } : {}),
                ...(priority ? { priority } : {}),
                ...(parentTicketId ? { parentTicketId: await resolveLocalReference(store, "ticket", parentTicketId, scope) } : {}),
                ...(chatClientId ? { chatClientId } : {}),
                ...taskTypeOf(args),
                ...(id ? { id } : {}),
            });
            return { entityType: "ticket", id: record.id, record };
        }
        case "ticket-update": {
            const id = await localTicketId(store, args, scope);
            const patch = {};
            const title = optionalString(args, "title");
            if (args.title !== undefined && !title)
                fail("tool_arguments_required", "title must not be blank.");
            if (title)
                patch.title = title;
            if (args.description !== undefined) {
                const description = optionalString(args, "description");
                patch.description = description ?? "";
            }
            const priority = optionalString(args, "priority");
            if (args.priority !== undefined)
                patch.priority = priority ?? "";
            const assignedUserId = optionalString(args, "assignedUserId");
            if (assignedUserId !== undefined)
                patch.assignedUserId = assignedUserId;
            const taskType = taskTypeOf(args).taskType;
            if (taskType)
                patch.taskType = taskType;
            if (Object.keys(patch).length === 0)
                fail("tool_arguments_required", "Nothing to update.");
            return { entityType: "ticket", id, record: await repository.updateTicket(id, patch) };
        }
        case "ticket-move": {
            const id = await localTicketId(store, args, scope);
            return { entityType: "ticket", id, record: await repository.changeTicketStatus(id, statusOf(args)) };
        }
        case "ticket-archive": {
            const id = await localTicketId(store, args, scope);
            const archived = optionalFlag(args, "archived", true);
            return { entityType: "ticket", id, record: await repository.setTicketArchived(id, archived) };
        }
        case "ticket-delete": {
            const id = await localTicketId(store, args, scope);
            await repository.deleteTicket(id);
            return { entityType: "ticket", id };
        }
        default:
            return fail("unknown_domain_tool", `Not a local domain tool: ${String(tool)}`);
    }
}
// ── The sync handoff ─────────────────────────────────────────────────────────
function toQueuedEvent(event) {
    return Object.freeze({
        eventId: event.eventId,
        entityType: event.entityType,
        clientEntityId: event.clientEntityId,
        operation: event.operation,
        occurredAt: event.occurredAt,
        destination: event.destination,
        destinationKey: destinationKey(event.destination),
    });
}
/**
 * The event this write produced: the newest pending journal event for that
 * entity, which the repository's transaction appended in the same commit as the
 * record. Absent ⇒ the repository did not journal, which is a defect in the
 * repository, not something to paper over with an invented event.
 */
async function queuedEventFor(store, entityType, id, tombstone = false) {
    const pending = await store.read((tx) => tx.pending());
    const own = pending.filter((event) => event.clientEntityId === id && event.entityType === entityType);
    const latest = own[own.length - 1];
    // A tombstone of a row the server never imported journals NOTHING (there is nothing to
    // undo there): not a defect, and nothing to queue.
    if (!latest && tombstone)
        return undefined;
    if (!latest) {
        throw new LocalDomainToolError("invalid_arguments", `The local write produced no journal event for ${entityType} ${id}; refusing to report it as synced work.`);
    }
    return toQueuedEvent(latest);
}
// ── The factory ──────────────────────────────────────────────────────────────
const CREATE_NOTE = "This is a LOCAL id (a UUID): use it with the ticket-* / project-* tools and as parentTicketId. It syncs to the account in the background; builtin_* tools accept it once synced.";
/**
 * Build the local domain tool set. `execute` is the tool-catalog seam a host
 * binds; nothing here reaches a platform client.
 */
export function createLocalDomainTools(options) {
    async function execute(tool, args = {}) {
        const mode = classifyLocalDomainTool(tool);
        if (mode === "unknown")
            fail("unknown_domain_tool", `Not a domain tool: ${String(tool)}`);
        if (mode === "connected-only") {
            fail("connected_only_tool", `${tool} needs the platform. It is refused offline and is never queued as local history.`);
        }
        const name = normalizeDomainToolName(tool);
        const write = await writeLocally(name, options.repository, options.store, args, options.scope?.());
        const syncEvent = await queuedEventFor(options.store, write.entityType, write.id, write.record === undefined);
        if (syncEvent)
            options.syncQueue.enqueue([syncEvent]);
        const { localId, syncId, serverId } = await writtenEntityIds(options.store, write.record);
        const creates = name === "ticket-create" || name === "project-create";
        return Object.freeze({
            kind: "local",
            tool: name,
            entityType: write.entityType,
            id: write.id,
            ...(write.record ? { record: write.record } : {}),
            ...(syncEvent ? { syncEvent } : { note: "nothing to sync — never left this device" }),
            ...(serverId ? { serverId } : {}),
            ...(creates && localId ? { localId } : {}),
            ...(creates && syncId !== undefined ? { syncId } : {}),
            ...(creates ? { note: CREATE_NOTE } : {}),
        });
    }
    return {
        execute,
        /** The names a host may advertise as local adapters. */
        localTools: LOCAL_DOMAIN_TOOL_NAMES,
        classify: classifyLocalDomainTool,
    };
}
/**
 * Convenience for a host that has a store and a device id but no repository yet:
 * build the G05 repository and the tool set together. Still not wired into
 * activation — see the module header.
 */
export function createLocalDomainToolsWithRepository(options) {
    const repository = options.repository ??
        createLocalWorkRepository({
            store: options.store,
            deviceId: options.deviceId,
            ...(options.repositoryOptions ?? {}),
        });
    return createLocalDomainTools({ ...options, repository });
}
//# sourceMappingURL=localDomainTools.js.map