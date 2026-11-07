/**
 * VSIX local domain tools (review G06).
 *
 * This module is the LOCAL ADAPTER set: in the editor the local repository IS the
 * project/ticket tool — signed in or not, sync granted or not — and the server twins
 * (`builtin_tasks_create`, …) are not offered (`localDomainToolRouting.ts`). A write
 * lands on this device and the journal event it appended is what the batched
 * local-first sync later carries to the account; no ticket is ever one API request.
 * (The injected `platformPolicy`/`platformTool` path below is for other hosts and
 * tests; the editor host never wires it.)
 *
 * Rules this module owns:
 *
 *   • No network. `bfApi`, `platformTools`, the gateway, `vscode` and `fetch` are
 *     NOT imported. The platform path exists only as an INJECTED caller, so a
 *     denied run cannot reach one by accident — and there is no code path that
 *     turns a local write into a platform request.
 *   • The repository is a PORT (`LocalWorkRepositoryPort`), not an import of a
 *     live singleton: the host passes the G05 repository
 *     (`createLocalWorkRepository`, or the `localWorkManagement` adapter another
 *     slice owns) and a test passes a fake. Nothing here constructs a store or
 *     reads global state.
 *   • Local is the DEFAULT. `platformPolicy` is optional; omitting it — or an
 *     `allows()` that throws, or returns anything but `true` — keeps the write local.
 *     The editor host omits it entirely.
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

import {
  LOCAL_DOMAIN_TOOL_NAMES,
  classifyDomainTool,
  destinationKey,
  normalizeDomainToolName,
  type DomainToolMode,
  type EntityDestination,
  type JournalEvent,
  type LocalDomainToolName,
  type LocalEntityType,
  type LocalFirstStore,
  type LocalRecord,
  type ProjectValue,
  type TicketTaskType,
  type TicketValue,
} from "@builderforce/local-first";
import {
  DEFAULT_TICKET_STATUS,
  LOCAL_TICKET_STATUSES,
  createLocalWorkRepository,
  type LocalWorkRepositoryOptions,
} from "./localWorkRepository";

// The classification table is the package's (`packages/local-first/src/domainToolClass.ts`),
// the ONE copy. This host performs only the names it has a repository write for
// (`LOCAL_DOMAIN_TOOL_SPECS` in `localDomainToolRouting.ts`); the rest of the table's
// "local" names answer `unknown_domain_tool` if one is ever called.
export {
  CONNECTED_ONLY_DOMAIN_TOOL_NAMES,
  LOCAL_DOMAIN_TOOL_NAMES,
  looksLikeServerMcpTool,
  type ConnectedOnlyDomainToolName,
  type LocalDomainToolName,
} from "@builderforce/local-first";

export type LocalDomainToolMode = DomainToolMode;

/** The classification as a plain mode string: "local" | "connected-only" | "unknown". */
export function classifyLocalDomainTool(name: string): LocalDomainToolMode {
  return classifyDomainTool(name).mode;
}

export type LocalDomainToolErrorCode =
  | "unknown_domain_tool"
  | "connected_only_tool"
  | "platform_tool_required"
  | "tool_arguments_required"
  | "invalid_arguments"
  | "invalid_status";

export class LocalDomainToolError extends Error {
  constructor(
    readonly code: LocalDomainToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalDomainToolError";
  }
}

// ── The repository port ──────────────────────────────────────────────────────

export interface LocalCreateTicketArgs {
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  parentTicketId?: string;
  taskType?: TicketTaskType;
  /** The creating chat's client id; stamped by the HOST from the run, never by the model. */
  chatClientId?: string;
  id?: string;
}

export interface LocalTicketPatch {
  title?: string;
  description?: string;
  priority?: string;
  assignedUserId?: string;
}

/**
 * The subset of the G05 repository these tools use. Declared as METHODS so the
 * concrete `LocalWorkRepository` is assignable to it (and a test fake is too),
 * which is what lets the host pass its repository without this module importing
 * a singleton it would then have to configure.
 */
export interface LocalWorkRepositoryPort {
  createProject(input: {
    name: string;
    key?: string;
    status?: string;
    id?: string;
  }): Promise<LocalRecord<ProjectValue>>;
  updateProject(
    id: string,
    patch: Partial<Pick<ProjectValue, "name" | "key" | "status">>,
  ): Promise<LocalRecord<ProjectValue>>;
  deleteProject(id: string): Promise<void>;
  createTicket(input: LocalCreateTicketArgs): Promise<LocalRecord<TicketValue>>;
  updateTicket(id: string, patch: LocalTicketPatch): Promise<LocalRecord<TicketValue>>;
  changeTicketStatus(id: string, status: string): Promise<LocalRecord<TicketValue>>;
  setTicketArchived(id: string, archived: boolean): Promise<LocalRecord<TicketValue>>;
  deleteTicket(id: string): Promise<void>;
}

// ── The sync queue ───────────────────────────────────────────────────────────

/** The journal event handed to sync: exactly what the local transaction appended. */
export interface QueuedLocalSyncEvent {
  eventId: string;
  entityType: LocalEntityType;
  clientEntityId: string;
  operation: JournalEvent["operation"];
  occurredAt: string;
  destination: EntityDestination;
  /** `unbound` until G10/G11 give never-connected work an explicit destination. */
  destinationKey: string;
}

export interface LocalDomainSyncQueue {
  enqueue(events: readonly QueuedLocalSyncEvent[]): void;
}

/** An array-backed queue for hosts that have no writer yet. NOT durable. */
export function createInMemoryLocalSyncQueue(): LocalDomainSyncQueue & { readonly queued: QueuedLocalSyncEvent[] } {
  const queued: QueuedLocalSyncEvent[] = [];
  return {
    enqueue(events) {
      queued.push(...events);
    },
    queued,
  };
}

// ── Policy and the platform caller ───────────────────────────────────────────

export interface LocalDomainPlatformPolicy {
  allows(tool: LocalDomainToolName): boolean;
}

export type LocalDomainPlatformCaller = (
  tool: LocalDomainToolName,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

// ── Results ──────────────────────────────────────────────────────────────────

export interface LocalDomainToolResult {
  kind: "local";
  tool: LocalDomainToolName;
  entityType: "project" | "ticket";
  id: string;
  /** Absent for a tombstoning write (`*-archive` on a project, `ticket-delete`). */
  record?: LocalRecord;
  /** The journal event this write produced and queued for sync. */
  syncEvent: QueuedLocalSyncEvent;
}

export interface PlatformDomainToolResult {
  kind: "platform";
  tool: LocalDomainToolName;
  result: unknown;
}

export type LocalDomainToolExecution = LocalDomainToolResult | PlatformDomainToolResult;

export interface LocalDomainToolsOptions {
  repository: LocalWorkRepositoryPort;
  /** Reads back the journal event the repository's transaction appended. */
  store: LocalFirstStore;
  syncQueue: LocalDomainSyncQueue;
  /** Omitted ⇒ every domain tool is denied. An `allows()` returning non-true denies. */
  platformPolicy?: LocalDomainPlatformPolicy;
  /** Only ever called when policy allows. Denied runs never reach it. */
  platformTool?: LocalDomainPlatformCaller;
}

// ── Argument validation (before the store is touched) ─────────────────────────

function fail(code: LocalDomainToolErrorCode, message: string): never {
  throw new LocalDomainToolError(code, message);
}

function requireString(args: Readonly<Record<string, unknown>>, key: string): string {
  const raw = args[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    fail("tool_arguments_required", `${key} is required and must be a non-empty string.`);
  }
  return raw.trim();
}

function optionalString(
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") fail("invalid_arguments", `${key} must be a string when given.`);
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optionalFlag(args: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const raw = args[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "boolean") fail("invalid_arguments", `${key} must be true or false.`);
  return raw;
}

function statusOf(args: Readonly<Record<string, unknown>>, fallback?: string): string {
  const raw = args.status;
  if (raw === undefined || raw === null) {
    if (fallback === undefined) fail("tool_arguments_required", "status is required.");
    return fallback;
  }
  if (typeof raw !== "string") fail("invalid_arguments", "status must be a string.");
  const status = raw.trim();
  if (!(LOCAL_TICKET_STATUSES as readonly string[]).includes(status)) {
    fail("invalid_status", `Unknown ticket status: ${status}`);
  }
  return status;
}

/** `taskType` when given: task | epic | gap. Absent ⇒ nothing (the ticket reads as a task). */
function taskTypeOf(args: Readonly<Record<string, unknown>>): { taskType?: TicketTaskType } {
  const raw = optionalString(args, "taskType");
  if (raw === undefined) return {};
  if (raw !== "task" && raw !== "epic" && raw !== "gap") {
    fail("invalid_arguments", `taskType must be task, epic or gap (got ${raw}).`);
  }
  return { taskType: raw };
}

// ── The local writes ─────────────────────────────────────────────────────────

type LocalWrite = { entityType: "project" | "ticket"; id: string; record?: LocalRecord };

const SERVER_ID_NUMERIC = /^\d+$/;

/**
 * The panel's selected project (and any ticket the model read from the platform) is
 * surfaced as a NUMERIC server id (see `activeProjectDirective`), but the local store
 * keys records by client UUID. A numeric id resolves to the live client UUID of its
 * mirror when this device has one (the server-id mapping row). With no mirror it passes
 * through VERBATIM: the repository treats a decimal id as a server reference (not looked
 * up locally) and the sync importer resolves it as the tenant's own. An exact local id
 * always wins. Nothing here guesses — a UUID is validated by the repository.
 */
async function resolveLocalReference(
  store: LocalFirstStore,
  entityType: "project" | "ticket",
  reference: string,
): Promise<string> {
  const raw = typeof reference === "string" ? reference.trim() : "";
  if (!SERVER_ID_NUMERIC.test(raw)) return reference;
  const mapped = await store.read((tx) => tx.mappingByServerId(entityType, raw));
  if (mapped) {
    const target = await store.read((tx) => tx.get(entityType, mapped.clientEntityId));
    if (target && !target.deletedAt) return mapped.clientEntityId;
  }
  return raw;
}

async function writeLocally(
  tool: LocalDomainToolName,
  repository: LocalWorkRepositoryPort,
  store: LocalFirstStore,
  args: Readonly<Record<string, unknown>>,
): Promise<LocalWrite> {
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
      const patch: Partial<Pick<ProjectValue, "name" | "key" | "status">> = {};
      const name = optionalString(args, "name");
      if (args.name !== undefined && !name) fail("tool_arguments_required", "name must not be blank.");
      if (name) patch.name = name;
      const key = optionalString(args, "key");
      if (key !== undefined) patch.key = key;
      const status = optionalString(args, "status");
      if (status !== undefined) patch.status = status;
      if (Object.keys(patch).length === 0) fail("tool_arguments_required", "Nothing to update.");
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
        projectId: await resolveLocalReference(store, "project", requireString(args, "projectId")),
        title: requireString(args, "title"),
        status: statusOf(args, DEFAULT_TICKET_STATUS),
        ...(description ? { description } : {}),
        ...(priority ? { priority } : {}),
        ...(parentTicketId ? { parentTicketId: await resolveLocalReference(store, "ticket", parentTicketId) } : {}),
        ...(chatClientId ? { chatClientId } : {}),
        ...taskTypeOf(args),
        ...(id ? { id } : {}),
      });
      return { entityType: "ticket", id: record.id, record };
    }
    case "ticket-update": {
      const id = requireString(args, "id");
      const patch: LocalTicketPatch = {};
      const title = optionalString(args, "title");
      if (args.title !== undefined && !title) fail("tool_arguments_required", "title must not be blank.");
      if (title) patch.title = title;
      if (args.description !== undefined) {
        const description = optionalString(args, "description");
        patch.description = description ?? "";
      }
      const priority = optionalString(args, "priority");
      if (args.priority !== undefined) patch.priority = priority ?? "";
      const assignedUserId = optionalString(args, "assignedUserId");
      if (assignedUserId !== undefined) patch.assignedUserId = assignedUserId;
      if (Object.keys(patch).length === 0) fail("tool_arguments_required", "Nothing to update.");
      return { entityType: "ticket", id, record: await repository.updateTicket(id, patch) };
    }
    case "ticket-move": {
      const id = requireString(args, "id");
      return { entityType: "ticket", id, record: await repository.changeTicketStatus(id, statusOf(args)) };
    }
    case "ticket-archive": {
      const id = requireString(args, "id");
      const archived = optionalFlag(args, "archived", true);
      return { entityType: "ticket", id, record: await repository.setTicketArchived(id, archived) };
    }
    case "ticket-delete": {
      const id = requireString(args, "id");
      await repository.deleteTicket(id);
      return { entityType: "ticket", id };
    }
    default:
      return fail("unknown_domain_tool", `Not a local domain tool: ${String(tool)}`);
  }
}

// ── The sync handoff ─────────────────────────────────────────────────────────

function toQueuedEvent(event: JournalEvent): QueuedLocalSyncEvent {
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
async function queuedEventFor(
  store: LocalFirstStore,
  entityType: LocalEntityType,
  id: string,
): Promise<QueuedLocalSyncEvent> {
  const pending = await store.read((tx) => tx.pending());
  const own = pending.filter((event) => event.clientEntityId === id && event.entityType === entityType);
  const latest = own[own.length - 1];
  if (!latest) {
    throw new LocalDomainToolError(
      "invalid_arguments",
      `The local write produced no journal event for ${entityType} ${id}; refusing to report it as synced work.`,
    );
  }
  return toQueuedEvent(latest);
}

// ── The factory ──────────────────────────────────────────────────────────────

/** The frozen argument record handed to a platform caller. Never the local one. */
function platformArgs(
  tool: LocalDomainToolName,
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({ tool, ...args });
}

/**
 * Build the local domain tool set. `execute` is the tool-catalog seam a host
 * binds; nothing here reaches a platform client.
 */
export function createLocalDomainTools(options: LocalDomainToolsOptions) {
  const allows = (tool: LocalDomainToolName): boolean => {
    if (!options.platformPolicy) return false;
    try {
      return options.platformPolicy.allows(tool) === true;
    } catch {
      // A policy that cannot answer is not a grant.
      return false;
    }
  };

  async function execute(
    tool: string,
    args: Readonly<Record<string, unknown>> = {},
  ): Promise<LocalDomainToolExecution> {
    const mode = classifyLocalDomainTool(tool);
    if (mode === "unknown") fail("unknown_domain_tool", `Not a domain tool: ${String(tool)}`);
    if (mode === "connected-only") {
      fail(
        "connected_only_tool",
        `${tool} needs the platform. It is refused offline and is never queued as local history.`,
      );
    }
    const name = normalizeDomainToolName(tool) as LocalDomainToolName;

    // Resolved BEFORE the write: an explicit grant delegates to the platform and
    // does not write locally, a denial takes the local path and never reaches a
    // platform caller — not even after a local failure.
    if (allows(name)) {
      if (!options.platformTool) fail("platform_tool_required", `${name} is allowed but no platform caller is wired.`);
      return { kind: "platform", tool: name, result: await options.platformTool(name, platformArgs(name, args)) };
    }

    const write = await writeLocally(name, options.repository, options.store, args);
    const syncEvent = await queuedEventFor(options.store, write.entityType, write.id);
    options.syncQueue.enqueue([syncEvent]);
    return Object.freeze({
      kind: "local",
      tool: name,
      entityType: write.entityType,
      id: write.id,
      ...(write.record ? { record: write.record } : {}),
      syncEvent,
    } as LocalDomainToolResult);
  }

  return {
    execute,
    /** The names a host may advertise as local adapters. */
    localTools: LOCAL_DOMAIN_TOOL_NAMES,
    classify: classifyLocalDomainTool,
    /** True only when policy explicitly allows this tool right now. */
    isPlatformAllowed: allows,
  };
}

export type LocalDomainTools = ReturnType<typeof createLocalDomainTools>;

/**
 * Convenience for a host that has a store and a device id but no repository yet:
 * build the G05 repository and the tool set together. Still no platform caller
 * and still not wired into activation — see the module header.
 */
export function createLocalDomainToolsWithRepository(
  options: Omit<LocalDomainToolsOptions, "repository"> & {
    deviceId: string;
    repository?: LocalWorkRepositoryPort;
    repositoryOptions?: Omit<LocalWorkRepositoryOptions, "store">;
  },
): LocalDomainTools {
  const repository =
    options.repository ??
    createLocalWorkRepository({
      store: options.store,
      deviceId: options.deviceId,
      ...(options.repositoryOptions ?? {}),
    });
  return createLocalDomainTools({ ...options, repository });
}