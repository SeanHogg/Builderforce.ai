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

import type { LocalFirstStore } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import { LOCAL_TICKET_ID as LOCAL_ID } from "./localTicketScope";

/** Server tool → the arguments that carry a TICKET id (a task id on the account). Data, not branches. */
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

/** The account's id for a local ticket, or undefined while it has not synced. */
export type TicketServerIdLookup = (localId: string) => Promise<string | undefined>;

export function ticketServerIdLookup(store: LocalFirstStore): TicketServerIdLookup {
  return (localId) =>
    store.read(async (tx) => {
      const record = await tx.get("ticket", localId);
      if (!record) return undefined;
      return (await tx.mapping("ticket", localId, record.destination))?.serverId;
    });
}

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
async function awaitMapping(lookup: TicketServerIdLookup, localId: string, wait: UnsyncedWait, signal?: AbortSignal): Promise<string | "stopped" | undefined> {
  const rounds = Math.max(1, Math.ceil(wait.timeoutMs / Math.max(1, wait.intervalMs)));
  for (let round = 0; round < rounds; round += 1) {
    if (signal?.aborted) return "stopped";
    await wait.sleep(wait.intervalMs, signal);
    if (signal?.aborted) return "stopped";
    const serverId = await lookup(localId);
    if (serverId) return serverId;
  }
  return undefined;
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
  const resolve = async (localId: string, toolName: string, signal?: AbortSignal): Promise<string | { refused: string }> => {
    const serverId = await lookup(localId);
    if (serverId) return serverId;
    const syncOn = options.syncOn?.();
    if (syncOn === false) return { refused: localOnly(localId, toolName) };
    if (syncOn === true) {
      const later = await awaitMapping(lookup, localId, wait, signal);
      if (later === "stopped") return { refused: STOPPED };
      if (later) return later;
      return { refused: waitedOut(localId, toolName, wait.timeoutMs) };
    }
    return { refused: unsynced(localId) };
  };
  return tools.map((tool) => {
    const argNames = SERVER_TICKET_ID_ARGS[tool.name];
    if (!argNames) return tool;
    return {
      ...tool,
      parameters: widened(tool.parameters, argNames),
      execute: async (args, root, run) => {
        const next = { ...args };
        for (const name of argNames) {
          const value = next[name];
          if (typeof value !== "string" || !LOCAL_ID.test(value.trim())) continue;
          const serverId = await resolve(value.trim(), tool.name, run?.signal);
          if (typeof serverId !== "string") return serverId.refused;
          next[name] = Number(serverId);
        }
        return tool.execute(next, root, run);
      },
    };
  });
}
