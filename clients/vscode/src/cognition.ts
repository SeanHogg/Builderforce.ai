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
import type { ToolDef } from "./fileTools";

/** Facts a single `recall_facts` call hands back by default. */
const RECALL_DEFAULT_LIMIT = 5;
const RECALL_MAX_LIMIT = 20;

/**
 * The agent's memory pair, routed through the SHARED project facts store — the editor
 * twins of the cloud/on-prem `memory_recall` / `memory_remember` tools (and of the
 * builderforce-memory MCP a Claude Code session uses).
 *
 * `recall_facts` is the READ side. It was the half that was missing: the run could
 * remember but never ask, so every fact a prior run had written was recalled only by
 * the run-context block at turn start, and a question that arose MID-run — "where does
 * the chat list get its data?" — was answered by re-reading files. Recall costs no disk
 * read and no model tokens beyond the facts themselves; that is the token saving.
 *
 * `remember_fact` is the write side: a fact for the same key supersedes its incumbent
 * (write-through, replace-on-write), and every surface sees it. Closes over the caller's
 * secrets + the active project (the ToolDef `execute` signature can't carry them).
 */
export function cognitionToolDefs(secrets: vscode.SecretStorage, projectId: number | undefined): ToolDef[] {
  return [
    {
      name: "recall_facts",
      description:
        "Recall durable facts previously remembered about this PROJECT — root causes, where a behaviour lives, conventions, decisions — from the shared project memory every agent (cloud/on-prem/editor) writes to. Call this BEFORE searching or re-reading files to rediscover something a prior run may already have learned: it costs no disk read and no re-reading. Pass a short `query` (a topic, symbol, file or question). Returns the best-matching facts with their stable keys; an empty result means this topic has not been recorded yet — remember_fact what you learn so the next run recalls it.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to recall — a topic, symbol, file or question." },
          limit: { type: "number", description: `Max facts to return (default ${RECALL_DEFAULT_LIMIT}, max ${RECALL_MAX_LIMIT}).` },
        },
        required: ["query"],
      },
      mutating: false,
      execute: async (args) => {
        if (!projectId) return JSON.stringify({ ok: false, error: "Select a project first — memory is scoped to the active project." });
        const query = String(args.query ?? "").trim();
        const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : RECALL_DEFAULT_LIMIT;
        const limit = Math.min(RECALL_MAX_LIMIT, Math.max(1, requested));
        const facts = await recallProjectFacts(secrets, projectId, query || undefined, limit);
        return JSON.stringify({
          ok: true,
          query,
          total: facts.length,
          facts: facts.map((f) => ({ key: f.key, content: f.content })),
          ...(facts.length === 0
            ? { note: "No remembered facts match this query — nothing has been recorded about it yet. Work it out from the code, then remember_fact the durable result under a stable key so the next run recalls it instead of re-deriving it." }
            : {}),
        });
      },
    },
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
