/**
 * The bridge between the ids the editor's agent holds and the ids the account's tools take.
 *
 * `ticket-create` hands the model a LOCAL id (a client UUID). The account's own tools
 * (`builtin_tasks_update`, `builtin_kanban_*`, dispatch, …) take the NUMERIC server id,
 * which exists only once a sync receipt mapped the ticket. This module is the one place that
 * knows which of those tools take a ticket id and in which argument, and rewrites a local id
 * to its server id before the call — or says plainly that the ticket has not synced yet,
 * instead of letting the server answer "not found".
 *
 * Pure of `vscode`; the id lookup is a port so it is testable headlessly.
 */

import { entityIdResolver, isLocalId, parseSyncId, syncIdText, type EntityScope, type LocalFirstStore, type SyncId } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";

/**
 * The ticket-id arguments the catalog's schema cannot name on its own. Every other one is
 * DERIVED from the tool's schema ({@link ticketIdArgsOf}): an argument named `taskId` /
 * `ticketId` / `<x>TaskId` / `<x>TicketId` typed as a number. What is listed here is the floor:
 * `builtin_tasks_*` take the ticket as a bare `id` (not derivable by name), and the rest keep
 * the bridge on when a catalog arrives without typed properties.
 */
export const SERVER_TICKET_ID_ARGS: Readonly<Record<string, readonly string[]>> = {
  builtin_tasks_get: ["id"],
  builtin_tasks_update: ["id", "parentTaskId"],
  builtin_tasks_delete: ["id"],
  builtin_tasks_move: ["id"],
  builtin_tasks_add_dependency: ["taskId", "predecessorTaskId"],
  builtin_repos_pull_request_diff_summary: ["taskId"],
  builtin_tickets_from_delta: ["taskId"],
  builtin_tickets_lifecycle: ["taskId"],
  builtin_kanban_signoff: ["taskId"],
  builtin_kanban_audit: ["taskId"],
  builtin_kanban_participants: ["taskId"],
  builtin_kanban_accountability: ["taskId"],
  builtin_kanban_assess_resource: ["taskId"],
  builtin_kanban_assign_participant: ["taskId"],
  builtin_kanban_remove_participant: ["taskId"],
  builtin_kanban_coordinate: ["taskId"],
  builtin_kanban_materialize_work_items: ["taskId"],
  builtin_chats_dispatch_agent: ["taskId"],
  builtin_chats_execute_as_agent: ["taskId"],
  builtin_executions_submit: ["taskId"],
  builtin_executions_list_for_task: ["taskId"],
  builtin_executions_task_file_changes: ["taskId"],
  builtin_reviews_record: ["taskId"],
  builtin_objectives_add_link: ["taskId"],
  builtin_specs_import: ["taskId"],
  builtin_cron_create: ["taskId"],
  builtin_meetings_schedule: ["ticketId"],
  builtin_marketplace_publish_ticket: ["ticketId"],
  builtin_marketplace_unpublish_ticket: ["ticketId"],
};

/** The ticket-id naming contract of the account's tools. */
const TICKET_ID_NAME = /^(?:task|ticket)Id$|[a-z0-9](?:Task|Ticket)Id$/;

const isNumericType = (type: unknown): boolean =>
  type === "number" || type === "integer" || (Array.isArray(type) && (type.includes("number") || type.includes("integer")));

/**
 * The arguments of one tool that carry a TICKET id: its schema's numeric properties named by
 * the ticket-id contract, plus the {@link SERVER_TICKET_ID_ARGS} floor. A new account tool that
 * takes a `taskId` is bridged without anyone editing a list.
 */
export function ticketIdArgsOf(tool: Pick<ToolDef, "name" | "parameters" | "remote">): readonly string[] {
  // Only the ACCOUNT's tools take server ids; a local tool's ids are already local.
  const properties = (tool.remote ? tool.parameters?.properties ?? {} : {}) as Record<string, { type?: unknown } | undefined>;
  const derived = Object.entries(properties)
    .filter(([name, prop]) => TICKET_ID_NAME.test(name) && isNumericType(prop?.type))
    .map(([name]) => name);
  const floor = SERVER_TICKET_ID_ARGS[tool.name] ?? [];
  return [...new Set([...floor, ...derived])];
}

/** The account's id (SyncId as text, `syncIdText`) for a local ticket, or undefined while it has not synced. */
export type TicketServerIdLookup = (localId: string) => Promise<string | undefined>;

/**
 * The lookup over the store: the ONE resolver's `syncIdOf`. No mapping, or a mapping with no SyncId, is "not synced".
 * `scope` is the active account, read per call: the account's tools act in that tenant, so another
 * tenant's mapping is not a server id they can take.
 */
export function ticketServerIdLookup(store: LocalFirstStore, scope?: () => EntityScope | undefined): TicketServerIdLookup {
  const resolver = entityIdResolver(store);
  return async (localId) => {
    if (!isLocalId(localId)) return undefined;
    const sync = await resolver.syncIdOf("ticket", localId, scope?.());
    return sync === null ? undefined : syncIdText(sync);
  };
}

/** The SyncId a lookup answers, re-checked: anything that is not one is "not synced yet", never `Number()`-guessed. */
const syncIdVia = async (lookup: TicketServerIdLookup, localId: string): Promise<SyncId | null> => parseSyncId(await lookup(localId));

const unsynced = (id: string): string =>
  JSON.stringify({
    ok: false,
    error: `ticket ${id} has not synced to the account yet; sync runs within seconds when sync is on — retry shortly, or keep working with ticket-update`,
  });

/**
 * Sync is off in this mode: the ticket will not reach the account, so a retry is a loop
 * (chat #61651: `builtin_reviews_record` failed 10 of 12 times on "retry shortly" until the
 * repeat-failure guard tripped). Say so, and name the local tools that do the job.
 */
const localToolsHint = (id: string, toolName: string): string =>
  toolName === "builtin_reviews_record"
    ? `Record the verdict on the local ticket instead: write it into the ticket with ticket-update (id ${id}) and set its status with ticket-move.`
    : `Keep working on it with the local ticket tools (ticket-update, ticket-move) by this local id.`;

const localOnly = (id: string, toolName: string): string =>
  JSON.stringify({
    ok: false,
    retryable: false,
    error: `ticket ${id} lives only on this device: sync is off in this mode, so ${toolName} cannot reach it and retrying will not help. ${localToolsHint(id, toolName)}`,
  });

/** Sync is on, and the call already waited for the receipt: another try is not the way forward. */
const waitedOut = (id: string, toolName: string, waitMs: number): string =>
  JSON.stringify({
    ok: false,
    retryable: false,
    error: `ticket ${id} has not synced to the account: its server id did not arrive within ${Math.round(waitMs / 1000)} s of waiting, so ${toolName} cannot reach it now. ${localToolsHint(id, toolName)}`,
  });

/** The run was stopped while the call waited for a receipt. */
const STOPPED = JSON.stringify({ ok: false, aborted: true, error: "the run was stopped" });

/** How long a call waits for a ticket's sync receipt when sync is on, before it gives up. */
export interface UnsyncedWait {
  timeoutMs: number;
  intervalMs: number;
  /** The timer; injectable so a test drives it with fake timers. Resolves early when `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const DEFAULT_UNSYNCED_WAIT: UnsyncedWait = {
  timeoutMs: 5_000,
  intervalMs: 250,
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const done = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
    }),
};

export interface BridgeOptions {
  /** Whether sync is on now (the platform's `synchronize` capability). Absent: unknown — no wait, the plain "not synced yet". */
  syncOn?: () => boolean;
  wait?: Partial<UnsyncedWait>;
}

/** Poll the lookup until the mapping appears, the wait runs out, or the run is stopped. */
async function awaitMapping(lookup: TicketServerIdLookup, localId: string, wait: UnsyncedWait, signal?: AbortSignal): Promise<SyncId | "stopped" | null> {
  const rounds = Math.max(1, Math.ceil(wait.timeoutMs / Math.max(1, wait.intervalMs)));
  for (let round = 0; round < rounds; round += 1) {
    if (signal?.aborted) return "stopped";
    await wait.sleep(wait.intervalMs, signal);
    if (signal?.aborted) return "stopped";
    const sync = await syncIdVia(lookup, localId);
    if (sync !== null) return sync;
  }
  return null;
}

/** Let a ticket-id argument also be given as a local id (the schema says number; the model may hold a UUID). */
function widened(parameters: Record<string, unknown>, argNames: readonly string[]): Record<string, unknown> {
  const properties = parameters.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return parameters;
  const next: Record<string, Record<string, unknown>> = { ...properties };
  for (const name of argNames) {
    const prop = next[name];
    if (!prop) continue;
    const type = prop.type;
    // `number` or `integer`, or a nullable union such as ["number","null"] (tasks_update parentTaskId).
    if (type === "number" || type === "integer") next[name] = { ...prop, type: ["number", "string"] };
    else if (Array.isArray(type) && (type.includes("number") || type.includes("integer"))) next[name] = { ...prop, type: [...type.filter((t) => t !== "number" && t !== "integer"), "number", "string"] };
  }
  return { ...parameters, properties: next };
}

/** Wrap the catalog's server tools that take a ticket id so a local id is translated first. */
export function bridgeLocalTicketIds(tools: readonly ToolDef[], lookup: TicketServerIdLookup, options: BridgeOptions = {}): readonly ToolDef[] {
  const wait: UnsyncedWait = { ...DEFAULT_UNSYNCED_WAIT, ...options.wait };
  // Sync off: the ticket stays on this device — say so. Sync on: the receipt is usually seconds away — wait for it.
  // Unknown (no predicate): the plain "not synced yet".
  const resolve = async (localId: string, toolName: string, signal?: AbortSignal): Promise<SyncId | { refused: string }> => {
    const sync = await syncIdVia(lookup, localId);
    if (sync !== null) return sync;
    const syncOn = options.syncOn?.();
    if (syncOn === false) return { refused: localOnly(localId, toolName) };
    if (syncOn === true) {
      const later = await awaitMapping(lookup, localId, wait, signal);
      if (later === "stopped") return { refused: STOPPED };
      if (later !== null) return later;
      return { refused: waitedOut(localId, toolName, wait.timeoutMs) };
    }
    return { refused: unsynced(localId) };
  };
  return tools.map((tool) => {
    const argNames = ticketIdArgsOf(tool);
    if (argNames.length === 0) return tool;
    return {
      ...tool,
      parameters: widened(tool.parameters, argNames),
      execute: async (args, root, run) => {
        const next = { ...args };
        for (const name of argNames) {
          const value = next[name];
          if (typeof value !== "string" || !isLocalId(value.trim())) continue;
          const sync = await resolve(value.trim(), tool.name, run?.signal);
          if (typeof sync !== "number") return sync.refused;
          next[name] = sync;
        }
        return tool.execute(next, root, run);
      },
    };
  });
}
