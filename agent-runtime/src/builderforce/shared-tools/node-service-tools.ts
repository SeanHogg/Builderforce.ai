/**
 * Node-native SERVICE tool backends (`run*` functions).
 *
 * These on-prem tools depend on per-run configuration/services (the agent config,
 * session key, message channel, …) rather than just the working tree. The pure logic
 * lives here in the `run*` functions; the live native `create*Tool` `AgentTool`s
 * (`agents/tools/*`) delegate to the SAME implementation (DRY). 100% pi-free. (The
 * earlier duplicate `build*ToolDef` `ToolDefinition` wrappers + `buildNodeServiceTools`
 * were deleted with the `builderforce-local` engine — PRD 11 §5.5(a).)
 */

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

// ── gateway ────────────────────────────────────────────────────────────────────

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

