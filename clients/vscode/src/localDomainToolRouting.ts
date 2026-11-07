/**
 * Project and ticket tools in the editor are LOCAL — always.
 *
 * Filing a program of tickets through the server MCP tools is two API calls per ticket
 * (`builtin_tasks_create` + `builtin_chats_link_ticket`) fired back to back, which trips
 * the tenant's rate window (shared with the person) — measured on chat #210: 26 tickets,
 * HTTP 429 on both tools. So in the editor the local repository IS the ticket tool,
 * signed in or not, sync granted or not:
 *
 *   • a `ticket-create` writes this device's store and returns at once; the batched
 *     local-first sync (`chatSyncHost.ts`) carries it to the account in the background,
 *     many events in one request, so the server never sees a per-ticket API call;
 *   • the creating chat is stamped onto the ticket by the HOST (`chatClientId`), and sync
 *     links it to that chat as 'created' — the model never makes a link call;
 *   • the server twins of these tools are NOT offered ({@link SERVER_TWIN_TOOL_NAMES}),
 *     so the model has exactly one way to do each job.
 *
 * Pure of `vscode`: the caller supplies how a request is executed, so this is testable
 * headlessly. Read tools (`builtin_tasks_list`, `builtin_chats_list_tickets`, …) are
 * untouched — only the writes the local adapter now does are replaced.
 */

import type { DomainToolRequest } from "./installLocalDomainTools";
import { classifyLocalDomainTool, type LocalDomainToolName } from "./localDomainTools";
import type { ToolDef } from "./fileTools";

/**
 * The server MCP tools whose job the local adapter now does. Hidden from the editor's
 * catalog. Data, not branches: a new local twin is a new name here.
 */
export const SERVER_TWIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "builtin_tasks_create", // → ticket-create
  "builtin_tasks_update", // → ticket-update / ticket-move / ticket-archive
  "builtin_chats_link_ticket", // → ticket-create stamps the creating chat itself
]);

/**
 * Only names the landed library actually implements. `memory-recall` is
 * deliberately absent: `classifyLocalDomainTool` calls it local but there is no
 * repository write behind it, so advertising it would offer the model a tool that
 * always throws `unknown_domain_tool`. Adding one means adding its repository write first.
 */
export const LOCAL_DOMAIN_TOOL_SPECS: readonly (Omit<ToolDef, "execute" | "name"> & {
  name: LocalDomainToolName;
})[] = [
  {
    name: "project-create",
    description:
      "Create a project on this device; it syncs to the account in the background (batched) when sync is on. Returns the local project id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name." },
        key: { type: "string", description: "Optional stable project key." },
        status: { type: "string", description: "Optional project status." },
      },
      required: ["name"],
    },
    mutating: true,
  },
  {
    name: "project-update",
    description: "Patch a project on this device; the change syncs to the account in the background (batched).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local project id to patch." },
        name: { type: "string", description: "New project name." },
        key: { type: "string", description: "New stable project key." },
        status: { type: "string", description: "New project status." },
      },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "project-archive",
    description: "Archive a project on this device (a tombstone); it syncs to the account in the background (batched).",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Local project id to archive." } },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "ticket-create",
    description:
      "Create a ticket on this device; it syncs to the account in the background (batched) when sync is on, and is linked to this chat automatically. Returns the local ticket id — use it as parentTicketId for children. File an epic first (taskType epic), then its tasks under it.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The project the ticket belongs to: the numeric project id you were given, or a local project id.",
        },
        title: { type: "string", description: "Ticket title." },
        description: { type: "string", description: "Optional ticket description." },
        status: { type: "string", description: "Optional ticket status." },
        priority: { type: "string", description: "Optional ticket priority." },
        taskType: { type: "string", enum: ["task", "epic", "gap"], description: "task (default), epic or gap." },
        parentTicketId: {
          type: "string",
          description: "Optional parent ticket: the local id returned by an earlier ticket-create, or a numeric server task id.",
        },
      },
      required: ["projectId", "title"],
    },
    mutating: true,
  },
  {
    name: "ticket-update",
    description: "Patch a ticket on this device; the change syncs to the account in the background (batched).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local ticket id to patch." },
        title: { type: "string", description: "New ticket title." },
        description: { type: "string", description: "New ticket description." },
        priority: { type: "string", description: "New ticket priority." },
        assignedUserId: { type: "string", description: "New assignee." },
      },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "ticket-move",
    description: "Change the status of a ticket on this device; the change syncs to the account in the background (batched).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local ticket id to move." },
        status: { type: "string", description: "New ticket status." },
      },
      required: ["id", "status"],
    },
    mutating: true,
  },
  {
    name: "ticket-archive",
    description: "Archive or restore a ticket on this device; the change syncs to the account in the background (batched).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local ticket id to archive." },
        archived: { type: "boolean", description: "False restores an archived ticket." },
      },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "ticket-delete",
    description: "Delete a ticket on this device (a tombstone); it syncs to the account in the background (batched).",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Local ticket id to delete." } },
      required: ["id"],
    },
    mutating: true,
  },
];

/** The tools whose request is stamped with the run's chat. */
const CHAT_STAMPED: ReadonlySet<LocalDomainToolName> = new Set<LocalDomainToolName>(["ticket-create"]);

/**
 * The args a local tool runs with. The creating chat is the HOST's fact, never the
 * model's: whatever the model sent as `chatClientId` is dropped, and the run's own is
 * stamped (absent when the run has no local chat identity).
 */
function stampedArgs(
  name: LocalDomainToolName,
  args: Record<string, unknown>,
  chatClientId: string | undefined,
): Record<string, unknown> {
  if (!CHAT_STAMPED.has(name)) return args;
  const rest = { ...args };
  delete rest.chatClientId;
  return chatClientId ? { ...rest, chatClientId } : rest;
}

/**
 * The editor's catalog with the project/ticket tools pointed at the local adapter:
 * a supported domain tool writes the device store and its journal event is the sync
 * handoff; the server twins are removed; any other tool (file tools, reads, every
 * other builtin) is never replaced.
 *
 * `run` executes one request on the installed adapter; `chatClientId` is the current
 * run's local chat (its client entity id) — `ticket-create` stamps it on the ticket.
 */
export function routeToLocalDomainTools(
  tools: readonly ToolDef[],
  run: (request: DomainToolRequest) => Promise<unknown>,
  chatClientId?: string,
): readonly ToolDef[] {
  const localExecute = (name: LocalDomainToolName): ToolDef["execute"] => async (args) =>
    JSON.stringify(await run({ tool: name, args: stampedArgs(name, args, chatClientId) }));
  // A catalog entry is a domain tool only if the landed classifier says so; a
  // name that merely looks like one is never repointed at the local writer.
  const routed = tools
    .filter((tool) => !SERVER_TWIN_TOOL_NAMES.has(tool.name))
    .map((tool) =>
      classifyLocalDomainTool(tool.name) === "local"
        ? { ...tool, remote: false, execute: localExecute(tool.name as LocalDomainToolName) }
        : tool,
    );
  const present = new Set(routed.map((tool) => tool.name));
  const added = LOCAL_DOMAIN_TOOL_SPECS.filter((spec) => !present.has(spec.name)).map(
    (spec): ToolDef => ({ ...spec, execute: localExecute(spec.name) }),
  );
  return added.length === 0 ? routed : [...routed, ...added];
}
