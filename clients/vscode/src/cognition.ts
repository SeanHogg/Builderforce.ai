/**
 * Evermind Write-Through Cognition for the IDE agent — SHARED, not local disk.
 *
 * Gives the in-editor agent the same self-updating memory the cloud/on-prem agents
 * have, backed by the SHARED per-project facts store on the server
 * (`/api/projects/:id/facts`, migration 0276) — NOT a `<workspace>/.builderforce`
 * file. So a fact the editor remembers is recalled by the cloud + on-prem runs on
 * that project, and vice versa: one project memory, every surface. Write-through
 * (replace-on-write by stable key) is enforced server-side.
 */

import * as vscode from "vscode";
import { recallProjectFacts, rememberProjectFact } from "./bfApi";
import type { ChatMessage } from "./gateway";
import type { ToolDef } from "./fileTools";

/** A `system` message of shared project facts relevant to `query`, or null when
 *  none / no project selected / unavailable. */
export async function recallSystemMessage(
  secrets: vscode.SecretStorage,
  projectId: number | undefined,
  query: string,
): Promise<ChatMessage | null> {
  if (!projectId || !query.trim()) return null;
  const facts = await recallProjectFacts(secrets, projectId, query, 5);
  if (facts.length === 0) return null;
  return {
    role: "system",
    content: `[Project memory — facts recalled for this request]\n${facts.map((f) => `- ${f.content}`).join("\n")}`,
  };
}

/**
 * The agent's write side: a `remember_fact` tool routed through the SHARED project
 * facts store, so a fact about the same key supersedes its incumbent (write-through,
 * replace-on-write) and every surface — cloud, on-prem, editor — sees it. Mirrors the
 * cloud/on-prem `memory_remember` tool. Closes over the caller's secrets + the active
 * project (the ToolDef `execute` signature can't carry them).
 */
export function cognitionToolDefs(secrets: vscode.SecretStorage, projectId: number | undefined): ToolDef[] {
  return [
    {
      name: "remember_fact",
      description:
        "Persist a durable fact about this PROJECT under a STABLE key (e.g. 'auth-flow', 'pkg:foo') to the shared project memory every agent (cloud/on-prem/editor) reads. A new fact for the same key supersedes the old one (write-through, replace-on-write). Use for decisions, conventions, and locations worth recalling across runs and surfaces.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Stable subject key identifying what the fact is about." },
          content: { type: "string", description: "The fact to remember." },
        },
        required: ["key", "content"],
      },
      mutating: false,
      execute: async (args) => {
        if (!projectId) return "Select a project first — memory is scoped to the active project.";
        const ok = await rememberProjectFact(secrets, projectId, String(args.key ?? ""), String(args.content ?? ""));
        return ok
          ? `Remembered '${String(args.key)}' for this project (shared with all agents).`
          : "Project memory is unavailable right now.";
      },
    },
  ];
}
