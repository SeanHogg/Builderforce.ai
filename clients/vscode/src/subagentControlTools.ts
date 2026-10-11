/**
 * The owner's side of a LIVE delegation — collect, redirect, stop.
 *
 * On the machine a sub-agent runs beside the run that spawned it (`childRunSpawner.ts`),
 * so the owner needs verbs for children it is not blocked on: hear from them when it
 * chooses to wait (`wait_agents`), correct one mid-task (`message_agent`), and cancel
 * (`stop_agent`). Editor-only: the cloud's children run inside one tool call and have
 * nothing to address.
 */

import type { ToolDef } from "./fileTools";
import type { ChildControls } from "./childRunSpawner";

/** Appended to both spawn tools' shared description on this surface. */
export const LIVE_DELEGATION_NOTE =
  "HERE the child runs IN THE BACKGROUND: the call returns its handle (a1, a2, …) at once and you keep working — plan, code, or start more children — while it does its slice. Its messages appear in the chat under its own name, and its report reaches you on its own when it finishes (call wait_agents only when you cannot go on without it). Redirect it with message_agent; cancel it with stop_agent. Do not edit the files a writable child owns while it runs.";

/** The owner's verbs, by name — ONE list the definitions below and the pin guard
 *  (`localToolsAdvertised.test.ts`) both read. */
export const SUBAGENT_CONTROL_TOOL_NAMES = { wait: "wait_agents", message: "message_agent", stop: "stop_agent" } as const;

/** Longest a single wait may hold the owner — it can always wait again. */
const MAX_WAIT_SECONDS = 600;
const DEFAULT_WAIT_SECONDS = 300;

const handlesOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((h): h is string => typeof h === "string" && h.trim() !== "").map((h) => h.trim()) : [];

export function subagentControlToolDefs(children: ChildControls, signal: () => AbortSignal | undefined): ToolDef[] {
  return [
    {
      name: SUBAGENT_CONTROL_TOOL_NAMES.wait,
      description:
        "Wait for your running sub-agents and collect their reports. Use it only when your next step depends on their results (e.g. verifying and committing a fan-out). Pass `agents` to wait for specific handles; omit it to wait for all of yours. Returns the reports that came in and which are still running at the timeout.",
      parameters: {
        type: "object",
        properties: {
          agents: { type: "array", items: { type: "string" }, description: "Handles to wait for, e.g. ['a1','a3']. Omit for all of yours." },
          timeout_seconds: { type: "number", description: `How long to wait (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}).` },
        },
      },
      mutating: false,
      execute: async (args) => {
        const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(args.timeout_seconds) || DEFAULT_WAIT_SECONDS));
        const { reports, running } = await children.wait(handlesOf(args.agents), seconds * 1000, signal());
        const changedFiles = [...new Set(reports.flatMap((r) => r.changedFiles ?? []))];
        return JSON.stringify({
          ok: true,
          reports,
          running,
          // Read by the ticket backstop (`codeChangesOf`) like any delegation result.
          ...(changedFiles.length ? { changedFiles } : {}),
          ...(running.length ? { note: `${running.join(", ")} still running — their reports will reach you when they finish.` } : {}),
        });
      },
    },
    {
      name: SUBAGENT_CONTROL_TOOL_NAMES.message,
      description:
        "Redirect one of your running sub-agents mid-task: narrow its scope, correct a wrong assumption, hand it a fact it lacks. It reads the message before its next step. The message is shown in the chat.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "The child's handle, e.g. 'a2'." },
          message: { type: "string", description: "The direction, standalone — it has none of your conversation." },
        },
        required: ["agent", "message"],
      },
      mutating: false,
      execute: async (args) => {
        const handle = typeof args.agent === "string" ? args.agent.trim() : "";
        const text = typeof args.message === "string" ? args.message.trim() : "";
        if (!handle || !text) return JSON.stringify({ ok: false, error: "agent and message are required" });
        return JSON.stringify(children.message(handle, text, "owner"));
      },
    },
    {
      name: SUBAGENT_CONTROL_TOOL_NAMES.stop,
      description:
        "Stop running sub-agents of yours — one or more by handle, or all of them. A stopped child reports what it had done.",
      parameters: {
        type: "object",
        properties: {
          agents: { type: "array", items: { type: "string" }, description: "Handles to stop. Omit to stop ALL of your running children." },
        },
      },
      mutating: false,
      execute: async (args) => {
        const named = handlesOf(args.agents);
        const stopped = children.stop(named.length ? named : "all");
        return JSON.stringify({ ok: true, stopped });
      },
    },
  ];
}
