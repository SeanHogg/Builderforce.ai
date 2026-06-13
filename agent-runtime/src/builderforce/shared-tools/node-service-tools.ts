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
import { loadConfig, type BuilderForceAgentsConfig } from "../../config/config.js";
import { resolveConfigSnapshotHash } from "../../config/io.js";
import { extractDeliveryInfo } from "../../config/sessions.js";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { resolveMemoryBackendConfig } from "../../memory/backend-config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import type { MemorySearchResult } from "../../memory/types.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { resolveAgentConfig, resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../../agents/memory-search.js";
import { callGatewayTool } from "../../agents/tools/gateway.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "../../agents/tools/sessions-helpers.js";
import { buildSessionsListToolDef } from "../../agents/tools/sessions-list-tool.js";
import { buildSessionsHistoryToolDef } from "../../agents/tools/sessions-history-tool.js";
import { buildSessionsSendToolDef } from "../../agents/tools/sessions-send-tool.js";
import { buildSessionsSpawnToolDef } from "../../agents/tools/sessions-spawn-tool.js";
import { buildSessionStatusToolDef } from "../../agents/tools/session-status-tool.js";
import { buildSubagentsToolDef } from "../../agents/tools/subagents-tool.js";
import { buildNodesToolDef } from "../../agents/tools/nodes-tool.js";
import { buildCronToolDef } from "../../agents/tools/cron-tool.js";
import { buildTtsToolDef } from "../../agents/tools/tts-tool.js";
import { buildCanvasToolDef } from "../../agents/tools/canvas-tool.js";
import { buildImageToolDef } from "../../agents/tools/image-tool.js";
import { buildMessageToolDef } from "../../agents/tools/message-tool.js";
import { buildBrowserToolDef } from "../../agents/tools/browser-tool.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";

/** The per-run dependency bag a Node service tool may close over. Extensible: new
 *  service tools add the fields they need; a surface supplies what it can back. It
 *  mirrors the options the legacy `createBuilderForceAgentsTools` assembles. */
export interface NodeServiceToolDeps {
  config?: BuilderForceAgentsConfig;
  agentSessionKey?: string;
  /** Explicit agent ID override for cron/hook sessions where session-key parsing fails. */
  requesterAgentIdOverride?: string;
  /** Session/channel routing used by the sessions_* + message tools. */
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Used by the image tool (vision) — it is omitted unless an agentDir is present. */
  agentDir?: string;
  workspaceDir?: string;
  modelHasVision?: boolean;
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

// ── agents_list ────────────────────────────────────────────────────────────────

export function runAgentsList(deps: NodeServiceToolDeps): Record<string, unknown> {
  const cfg = deps.config ?? loadConfig();
  const { mainKey, alias } = resolveMainSessionAlias(cfg);
  const requesterInternalKey =
    typeof deps.agentSessionKey === "string" && deps.agentSessionKey.trim()
      ? resolveInternalSessionKey({ key: deps.agentSessionKey, alias, mainKey })
      : alias;
  const requesterAgentId = normalizeAgentId(
    deps.requesterAgentIdOverride ?? parseAgentSessionKey(requesterInternalKey)?.agentId ?? DEFAULT_AGENT_ID,
  );

  const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
  const allowAny = allowAgents.some((value) => value.trim() === "*");
  const allowSet = new Set(
    allowAgents.filter((value) => value.trim() && value.trim() !== "*").map((value) => normalizeAgentId(value)),
  );

  const configuredAgents = Array.isArray(cfg.agents?.list) ? cfg.agents?.list : [];
  const configuredIds = configuredAgents.map((entry) => normalizeAgentId(entry.id));
  const configuredNameMap = new Map<string, string>();
  for (const entry of configuredAgents) {
    const name = entry?.name?.trim() ?? "";
    if (name) configuredNameMap.set(normalizeAgentId(entry.id), name);
  }

  const allowed = new Set<string>([requesterAgentId]);
  if (allowAny) for (const id of configuredIds) allowed.add(id);
  else for (const id of allowSet) allowed.add(id);

  const rest = Array.from(allowed)
    .filter((id) => id !== requesterAgentId)
    .toSorted((a, b) => a.localeCompare(b));
  const agents = [requesterAgentId, ...rest].map((id) => ({
    id,
    name: configuredNameMap.get(id),
    configured: configuredIds.includes(id),
  }));
  return { requester: requesterAgentId, allowAny, agents };
}

function agentsListToolDef(deps: NodeServiceToolDeps): ToolDefinition {
  return defineTool({
    name: "agents_list",
    description: "List agent ids you can target with sessions_spawn (based on allowlists).",
    parameters: { type: "object", properties: {} },
    requires: ["orchestrate"],
    async execute(): Promise<ToolResult> {
      return { data: runAgentsList(deps) };
    },
  });
}

// ── gateway ────────────────────────────────────────────────────────────────────

const GATEWAY_ACTIONS = ["restart", "config.get", "config.schema", "config.apply", "config.patch", "update.run"];
const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;

function resolveBaseHashFromSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const hashValue = (snapshot as { hash?: unknown }).hash;
  const rawValue = (snapshot as { raw?: unknown }).raw;
  return (
    resolveConfigSnapshotHash({
      hash: typeof hashValue === "string" ? hashValue : undefined,
      raw: typeof rawValue === "string" ? rawValue : undefined,
    }) ?? undefined
  );
}

export async function runGateway(deps: NodeServiceToolDeps, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const action = typeof params.action === "string" ? params.action : "";
  const str = (k: string) => (typeof params[k] === "string" && (params[k] as string).trim() ? (params[k] as string).trim() : undefined);
  const num = (k: string) => (typeof params[k] === "number" && Number.isFinite(params[k]) ? Math.floor(params[k] as number) : undefined);

  try {
    if (action === "restart") {
      if (deps.config?.commands?.restart !== true) {
        return { ok: false, error: "Gateway restart is disabled. Set commands.restart=true to enable." };
      }
      const sessionKey = str("sessionKey") ?? (deps.agentSessionKey?.trim() || undefined);
      const reason = str("reason")?.slice(0, 200);
      const note = str("note");
      const { deliveryContext, threadId } = extractDeliveryInfo(sessionKey);
      const payload: RestartSentinelPayload = {
        kind: "restart",
        status: "ok",
        ts: Date.now(),
        sessionKey,
        deliveryContext,
        threadId,
        message: note ?? reason ?? null,
        doctorHint: formatDoctorNonInteractiveHint(),
        stats: { mode: "gateway.restart", reason },
      };
      try {
        await writeRestartSentinel(payload);
      } catch {
        // best-effort
      }
      return scheduleGatewaySigusr1Restart({ delayMs: num("delayMs"), reason }) as unknown as Record<string, unknown>;
    }

    const gatewayOpts = { gatewayUrl: str("gatewayUrl"), gatewayToken: str("gatewayToken"), timeoutMs: num("timeoutMs") };
    const writeMeta = () => ({ sessionKey: str("sessionKey") ?? (deps.agentSessionKey?.trim() || undefined), note: str("note"), restartDelayMs: num("restartDelayMs") });
    const resolveConfigWrite = async () => {
      const raw = str("raw");
      if (!raw) throw new Error("raw is required for this action.");
      let baseHash = str("baseHash");
      if (!baseHash) baseHash = resolveBaseHashFromSnapshot(await callGatewayTool("config.get", gatewayOpts, {}));
      if (!baseHash) throw new Error("Missing baseHash from config snapshot.");
      return { raw, baseHash, ...writeMeta() };
    };

    if (action === "config.get") return { ok: true, result: await callGatewayTool("config.get", gatewayOpts, {}) };
    if (action === "config.schema") return { ok: true, result: await callGatewayTool("config.schema", gatewayOpts, {}) };
    if (action === "config.apply") return { ok: true, result: await callGatewayTool("config.apply", gatewayOpts, await resolveConfigWrite()) };
    if (action === "config.patch") return { ok: true, result: await callGatewayTool("config.patch", gatewayOpts, await resolveConfigWrite()) };
    if (action === "update.run") {
      const timeoutMs = num("timeoutMs") ?? DEFAULT_UPDATE_TIMEOUT_MS;
      return {
        ok: true,
        result: await callGatewayTool("update.run", { ...gatewayOpts, timeoutMs }, { ...writeMeta(), timeoutMs }),
      };
    }
    return { ok: false, error: `Unknown action: ${action}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function gatewayToolDef(deps: NodeServiceToolDeps): ToolDefinition {
  return defineTool({
    name: "gateway",
    description:
      "Restart, apply config, or update the gateway in-place (SIGUSR1). Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing. Always pass a human-readable completion message via the `note` parameter.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: `One of: ${GATEWAY_ACTIONS.join(", ")}.`, enum: GATEWAY_ACTIONS },
        delayMs: { type: "number" },
        reason: { type: "string" },
        gatewayUrl: { type: "string" },
        gatewayToken: { type: "string" },
        timeoutMs: { type: "number" },
        raw: { type: "string", description: "Full (config.apply) or partial (config.patch) config YAML." },
        baseHash: { type: "string" },
        sessionKey: { type: "string" },
        note: { type: "string", description: "Human-readable completion message delivered after restart." },
        restartDelayMs: { type: "number" },
      },
      required: ["action"],
    },
    requires: ["process"],
    async execute(args): Promise<ToolResult> {
      return { data: await runGateway(deps, args) };
    },
  });
}

/**
 * Build the Node service tools the given deps can back. Deps-independent tools
 * (agents_list, gateway) are always included; config/service-gated tools (memory_*)
 * appear only when their backing resolves — exactly mirroring the legacy factory's
 * `null` returns.
 */
export function buildNodeServiceTools(deps: NodeServiceToolDeps): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    agentsListToolDef(deps),
    gatewayToolDef(deps),
    buildSessionsListToolDef({ agentSessionKey: deps.agentSessionKey, sandboxed: deps.sandboxed }),
    buildSessionsHistoryToolDef({ agentSessionKey: deps.agentSessionKey, sandboxed: deps.sandboxed }),
    buildSessionsSendToolDef({ agentSessionKey: deps.agentSessionKey, agentChannel: deps.agentChannel, sandboxed: deps.sandboxed }),
    buildSessionsSpawnToolDef({
      agentSessionKey: deps.agentSessionKey,
      agentChannel: deps.agentChannel,
      agentAccountId: deps.agentAccountId,
      agentTo: deps.agentTo,
      agentThreadId: deps.agentThreadId,
      agentGroupId: deps.agentGroupId,
      agentGroupChannel: deps.agentGroupChannel,
      agentGroupSpace: deps.agentGroupSpace,
      sandboxed: deps.sandboxed,
      requesterAgentIdOverride: deps.requesterAgentIdOverride,
    }),
    buildSessionStatusToolDef({ agentSessionKey: deps.agentSessionKey, config: deps.config }),
    buildSubagentsToolDef({ agentSessionKey: deps.agentSessionKey }),
    buildNodesToolDef({ agentSessionKey: deps.agentSessionKey, config: deps.config }),
    buildCronToolDef({ agentSessionKey: deps.agentSessionKey }),
    buildTtsToolDef({ config: deps.config, agentChannel: deps.agentChannel }),
    buildCanvasToolDef({ config: deps.config }),
    buildMessageToolDef({
      config: deps.config,
      agentSessionKey: deps.agentSessionKey,
      agentAccountId: deps.agentAccountId,
    }),
    buildBrowserToolDef({}),
  ];
  const imageTool = buildImageToolDef({
    config: deps.config,
    agentDir: deps.agentDir,
    workspaceDir: deps.workspaceDir,
    modelHasVision: deps.modelHasVision,
  });
  if (imageTool) tools.push(imageTool);
  const memoryCtx = resolveMemoryToolContext(deps);
  if (memoryCtx) {
    tools.push(memorySearchToolDef(memoryCtx), memoryGetToolDef(memoryCtx));
  }
  return tools;
}
