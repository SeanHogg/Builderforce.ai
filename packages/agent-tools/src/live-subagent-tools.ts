/**
 * The owner's side of a LIVE delegation — collect, redirect, stop.
 *
 * Where a surface runs its sub-agents beside the run that spawned them (capability
 * `orchestrate.live`: the editor's run host, the durable cloud runner), the owner needs
 * verbs for children it is not blocked on: hear from them when it chooses to wait
 * (`wait_agents`), correct one mid-task (`message_agent`), and cancel (`stop_agent`).
 * ONE definition of each, and of the words an owner and a child read from each other,
 * so a model that delegates in the editor delegates identically in the cloud.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";
import type { ChildReportLike, LiveChildControls } from "./capabilities.js";

/** Appended to both spawn tools' description on a surface whose children run live. */
export const LIVE_DELEGATION_NOTE =
  "HERE the child runs IN THE BACKGROUND: the call returns its handle at once and you keep working — plan, code, or start more children — while it does its slice. Its messages appear in the chat under its own name, and its report reaches you on its own when it finishes (call wait_agents only when you cannot go on without it). Redirect it with message_agent; cancel it with stop_agent. Do not edit the files a child is working on while it runs.";

/** What a parent is told once a fan-out has STARTED (not finished). */
export const LIVE_FANOUT_NEXT =
  "Keep working on anything not delegated; when their reports are in (they arrive on their own, or call wait_agents), check the combined result, fix anything the slices broke between them, and report per workstream and ticket.";

/** The owner's verbs, by name — ONE list every surface's catalog and pin guard read. */
export const SUBAGENT_CONTROL_TOOL_NAMES = { wait: "wait_agents", message: "message_agent", stop: "stop_agent" } as const;

/** Why a wait ended before its children did: the person spoke to the owner. A wait
 *  never stands between the person and the run they are talking to. */
export const WAIT_INTERRUPTED_NOTE =
  "The person sent you a message — answer it now. Your sub-agents keep running, and their reports still reach you when they finish.";

/** Longest a single wait may hold the owner — it can always wait again. */
export const MAX_WAIT_SECONDS = 600;
const DEFAULT_WAIT_SECONDS = 300;

/** Direction from an owner, as the child reads it — the convention its brief names. */
export function ownerDirectionText(ownerName: string, text: string): string {
  return `[${ownerName}] ${text.trim()}`;
}

/**
 * Longest child answer carried back to its owner; the chat holds the whole of it. ONE
 * number for every surface. A research child's report IS its deliverable — at the editor's
 * old 4K the owner read reports cut mid-list and spawned more researchers to recover what
 * was lost (VS Code chat #6). The owner's `wait_agents` result is budgeted to hold four.
 */
export const SUBAGENT_REPORT_CHARS = 8_000;

/** A child's answer at the length its owner is handed, marked when it was cut. Applied
 *  once, where each surface builds its `ChildReportLike`. */
export function clipChildOutput(output: string): string {
  return output.length > SUBAGENT_REPORT_CHARS
    ? `${output.slice(0, SUBAGENT_REPORT_CHARS)}… [report cut at ${SUBAGENT_REPORT_CHARS} of ${output.length} chars — the full text is in the chat]`
    : output;
}

/** A child's report as its owner reads it in its inbox. */
export function childReportText(report: ChildReportLike): string {
  const head = `[Sub-agent ${report.handle} · ${report.name} — ${report.state}] ${report.label}${report.ticket ? ` (ticket ${report.ticket})` : ""}`;
  const files = report.changedFiles?.length ? `Changed: ${report.changedFiles.join(", ")}` : "";
  return [head, report.output, files].filter(Boolean).join("\n\n");
}

const handlesOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((h): h is string => typeof h === "string" && h.trim() !== "").map((h) => h.trim()) : [];

const live = (ctx: { caps: { orchestration?: { live?: LiveChildControls } } }): LiveChildControls | null =>
  ctx.caps.orchestration?.live ?? null;

const unavailable = (): ToolResult => ({ data: { ok: false, error: "this surface runs no background sub-agents" } });

export const waitAgentsTool: ToolDefinition = defineTool({
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
  requires: ["orchestrate.live"],
  async execute(args, ctx): Promise<ToolResult> {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(args.timeout_seconds) || DEFAULT_WAIT_SECONDS));
    const { reports, running, note } = await controls.wait(handlesOf(args.agents), seconds * 1000, ctx.signal);
    const changedFiles = [...new Set(reports.flatMap((r) => r.changedFiles ?? []))];
    return {
      data: {
        ok: true,
        reports,
        running,
        // Read by the ticket backstop (`codeChangesOf`) like any delegation result.
        ...(changedFiles.length ? { changedFiles } : {}),
        ...(note
          ? { note }
          : running.length ? { note: `${running.join(", ")} still running — their reports will reach you when they finish.` } : {}),
      },
    };
  },
});

export const messageAgentTool: ToolDefinition = defineTool({
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
  requires: ["orchestrate.live"],
  async execute(args, ctx): Promise<ToolResult> {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const handle = typeof args.agent === "string" ? args.agent.trim() : "";
    const text = typeof args.message === "string" ? args.message.trim() : "";
    if (!handle || !text) return { data: { ok: false, error: "agent and message are required" } };
    const out = await controls.message(handle, text);
    return { data: out as unknown as Record<string, unknown> };
  },
});

export const stopAgentTool: ToolDefinition = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.stop,
  description:
    "Stop running sub-agents of yours — one or more by handle, or all of them. A stopped child reports what it had done.",
  parameters: {
    type: "object",
    properties: {
      agents: { type: "array", items: { type: "string" }, description: "Handles to stop. Omit to stop ALL of your running children." },
    },
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx): Promise<ToolResult> {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const named = handlesOf(args.agents);
    const stopped = await controls.stop(named.length ? named : "all");
    return { data: { ok: true, stopped } };
  },
});

/** The owner's verbs, for a surface that grants `orchestrate.live`. */
export const SUBAGENT_CONTROL_TOOLS: readonly ToolDefinition[] = [waitAgentsTool, messageAgentTool, stopAgentTool];
