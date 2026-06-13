/**
 * Node-native SERVICE tools, as shared {@link ToolDefinition}s.
 *
 * These on-prem tools depend on per-run configuration/services (the agent config,
 * session key, message channel, …) rather than just the working tree, so they are
 * built by a FACTORY that closes over a {@link NodeServiceToolDeps} bag (Dependency
 * Inversion) — the same options the legacy `createBuilderForceAgentsTools` assembles.
 * A surface registers whichever it can back; a tool that needs config it does not
 * have is simply not produced (parity with the legacy factory returning `null`).
 *
 * The pure logic lives in the `run*` functions so the legacy pi-wrapped tools
 * delegate to the SAME implementation (DRY) until pi is removed — this module stays
 * 100% pi-free.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "@builderforce/agent-tools";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import { resolveMemoryBackendConfig } from "../../memory/backend-config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import type { MemorySearchResult } from "../../memory/types.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../../agents/memory-search.js";

/** The per-run dependency bag a Node service tool may close over. Extensible: new
 *  service tools add the fields they need; a surface supplies what it can back. */
export interface NodeServiceToolDeps {
  config?: BuilderForceAgentsConfig;
  agentSessionKey?: string;
}

// ── memory_search / memory_get ────────────────────────────────────────────────────

interface MemoryToolContext {
  cfg: BuilderForceAgentsConfig;
  agentId: string;
  agentSessionKey?: string;
}

/** Resolve the memory backing for these deps, or null when memory is unavailable
 *  (no config, or memory search disabled for this agent) — the tool is then omitted. */
export function resolveMemoryToolContext(deps: NodeServiceToolDeps): MemoryToolContext | null {
  const cfg = deps.config;
  if (!cfg) return null;
  const agentId = resolveSessionAgentId({ sessionKey: deps.agentSessionKey, config: cfg });
  if (!resolveMemorySearchConfig(cfg, agentId)) return null;
  return { cfg, agentId, agentSessionKey: deps.agentSessionKey };
}

export interface MemorySearchOpts {
  query: string;
  maxResults?: number;
  minScore?: number;
}

export async function runMemorySearch(ctx: MemoryToolContext, opts: MemorySearchOpts): Promise<Record<string, unknown>> {
  const { manager, error } = await getMemorySearchManager({ cfg: ctx.cfg, agentId: ctx.agentId });
  if (!manager) return { results: [], disabled: true, error };
  try {
    const citationsMode = resolveMemoryCitationsMode(ctx.cfg);
    const includeCitations = shouldIncludeCitations({ mode: citationsMode, sessionKey: ctx.agentSessionKey });
    const rawResults = await manager.search(opts.query, {
      maxResults: opts.maxResults,
      minScore: opts.minScore,
      sessionKey: ctx.agentSessionKey,
    });
    const status = manager.status();
    const decorated = decorateCitations(rawResults, includeCitations);
    const resolved = resolveMemoryBackendConfig({ cfg: ctx.cfg, agentId: ctx.agentId });
    const results =
      status.backend === "qmd"
        ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
        : decorated;
    const searchMode = (status.custom as { searchMode?: string } | undefined)?.searchMode;
    return {
      results,
      provider: status.provider,
      model: status.model,
      fallback: status.fallback,
      citations: citationsMode,
      mode: searchMode,
    };
  } catch (err) {
    return { results: [], disabled: true, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface MemoryGetOpts {
  path: string;
  from?: number;
  lines?: number;
}

export async function runMemoryGet(ctx: MemoryToolContext, opts: MemoryGetOpts): Promise<Record<string, unknown>> {
  const { manager, error } = await getMemorySearchManager({ cfg: ctx.cfg, agentId: ctx.agentId });
  if (!manager) return { path: opts.path, text: "", disabled: true, error };
  try {
    const result = await manager.readFile({ relPath: opts.path, from: opts.from ?? undefined, lines: opts.lines ?? undefined });
    return result as unknown as Record<string, unknown>;
  } catch (err) {
    return { path: opts.path, text: "", disabled: true, error: err instanceof Error ? err.message : String(err) };
  }
}

function resolveMemoryCitationsMode(cfg: BuilderForceAgentsConfig): MemoryCitationsMode {
  const mode = cfg.memory?.citations;
  return mode === "on" || mode === "off" || mode === "auto" ? mode : "auto";
}

function decorateCitations(results: MemorySearchResult[], include: boolean): MemorySearchResult[] {
  if (!include) return results.map((entry) => ({ ...entry, citation: undefined }));
  return results.map((entry) => {
    const citation = formatCitation(entry);
    return { ...entry, citation, snippet: `${entry.snippet.trim()}\n\nSource: ${citation}` };
  });
}

function formatCitation(entry: MemorySearchResult): string {
  const lineRange = entry.startLine === entry.endLine ? `#L${entry.startLine}` : `#L${entry.startLine}-L${entry.endLine}`;
  return `${entry.path}${lineRange}`;
}

function clampResultsByInjectedChars(results: MemorySearchResult[], budget?: number): MemorySearchResult[] {
  if (!budget || budget <= 0) return results;
  let remaining = budget;
  const clamped: MemorySearchResult[] = [];
  for (const entry of results) {
    if (remaining <= 0) break;
    const snippet = entry.snippet ?? "";
    if (snippet.length <= remaining) {
      clamped.push(entry);
      remaining -= snippet.length;
    } else {
      clamped.push({ ...entry, snippet: snippet.slice(0, Math.max(0, remaining)) });
      break;
    }
  }
  return clamped;
}

function shouldIncludeCitations(params: { mode: MemoryCitationsMode; sessionKey?: string }): boolean {
  if (params.mode === "on") return true;
  if (params.mode === "off") return false;
  return deriveChatTypeFromSessionKey(params.sessionKey) === "direct";
}

function deriveChatTypeFromSessionKey(sessionKey?: string): "direct" | "group" | "channel" {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed?.rest) return "direct";
  const tokens = new Set(parsed.rest.toLowerCase().split(":").filter(Boolean));
  if (tokens.has("channel")) return "channel";
  if (tokens.has("group")) return "group";
  return "direct";
}

// ── Native shared ToolDefinitions (built per-deps) ───────────────────────────────

function memorySearchToolDef(ctx: MemoryToolContext): ToolDefinition {
  return defineTool({
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search .builderforce/MEMORY.md + .builderforce/memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to recall." },
        maxResults: { type: "number", description: "Maximum snippets to return." },
        minScore: { type: "number", description: "Minimum similarity score (0-1)." },
      },
      required: ["query"],
    },
    requires: ["memory"],
    async execute(args): Promise<ToolResult> {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query.trim()) return { data: { error: "query is required" } };
      return {
        data: await runMemorySearch(ctx, {
          query,
          maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined,
          minScore: typeof args.minScore === "number" ? args.minScore : undefined,
        }),
      };
    },
  });
}

function memoryGetToolDef(ctx: MemoryToolContext): ToolDefinition {
  return defineTool({
    name: "memory_get",
    description:
      "Safe snippet read from .builderforce/MEMORY.md or .builderforce/memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative memory file path." },
        from: { type: "number", description: "1-based start line." },
        lines: { type: "number", description: "Number of lines to read." },
      },
      required: ["path"],
    },
    requires: ["memory"],
    async execute(args): Promise<ToolResult> {
      const relPath = typeof args.path === "string" ? args.path : "";
      if (!relPath) return { data: { error: "path is required" } };
      return {
        data: await runMemoryGet(ctx, {
          path: relPath,
          from: typeof args.from === "number" ? args.from : undefined,
          lines: typeof args.lines === "number" ? args.lines : undefined,
        }),
      };
    },
  });
}

/**
 * Build the Node service tools the given deps can back. Each tool is included only
 * when its dependencies resolve (e.g. memory tools require a config with memory
 * search enabled) — exactly mirroring the legacy factory's `null` returns.
 */
export function buildNodeServiceTools(deps: NodeServiceToolDeps): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const memoryCtx = resolveMemoryToolContext(deps);
  if (memoryCtx) {
    tools.push(memorySearchToolDef(memoryCtx), memoryGetToolDef(memoryCtx));
  }
  return tools;
}
