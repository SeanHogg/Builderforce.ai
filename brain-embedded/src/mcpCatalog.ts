/**
 * The gateway MCP catalog — fetching it, and turning it into callable actions.
 *
 * A tenant registers MCP servers in the portal; the gateway advertises their tools at
 * `GET /llm/v1/mcp/tools` and relays calls at `POST /llm/v1/mcp/call` (server-to-server,
 * so the MCP secret never reaches the client). This is the whole of that logic, with NO
 * React in it.
 *
 * It lives apart from {@link useMcpExtensions} — which is now a thin hook over it —
 * because the catalog is the single largest determinant of whether the Brain can answer
 * anything at all, and it therefore has to be reachable from places React is not: the
 * headless VS Code probe that reproduces a chat run from a terminal, and the offline
 * scenario harness that asserts on what a run was offered. Two copies of "how do we
 * build the tool list" would be two copies of the thing most worth testing.
 */

import type { BrainAction } from './BrainActionsContext';
import type { BrainTransport } from './streamChatCompletion';
import { getLastResolvedModel } from './lastResolvedModel';

/** One tool as the gateway advertises it. */
export interface McpToolEntry {
  extensionId: string;
  tool: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Whether the tool writes. Drives the confirm-before-mutate gate. Undefined
   *  (external MCP servers don't advertise it) ⇒ treated as mutating (fail safe). */
  mutates?: boolean;
}

/** What a tool call resolved to — handed to the caller's `onToolResult`. */
export interface McpToolResultInfo {
  /** Flat advertised name the model called (e.g. `builtin_tasks_create`). */
  name: string;
  /** Owning server's tool name + extension id (the relay coordinates). */
  tool: string;
  extensionId: string;
  /** Whether the tool writes (advertised mutates, fail-safe true). */
  mutating: boolean;
  /** True when the relay call succeeded (no transport error / `{error}` result). */
  ok: boolean;
}

// Short-window dedupe of identical create-like tool calls. The Brain occasionally
// emits the SAME create call twice in one turn (it "plans" then "creates"), which
// would double-write. Collapsing an identical create (same extension+tool+args)
// within the window to the first call's promise makes a double-fire idempotent.
// Module-scoped so it survives the per-render actions rebuild. NOT a data cache —
// results aren't retained past the window and errors are dropped so a genuine
// retry isn't blocked.
const CREATE_DEDUPE_MS = 8000;
const recentCreates = new Map<string, { at: number; result: Promise<unknown> }>();

function nowMs(): number {
  return typeof Date !== 'undefined' ? Date.now() : 0;
}

/** The catalog tool that reports which model is serving the conversation. */
const CURRENT_MODEL_TOOL = 'session.current_model';

/**
 * Supply the model the LAST turn actually resolved to as the `model` argument of
 * `session.current_model`.
 *
 * An MCP call is a SEPARATE request from the completion, so the server cannot see which
 * model answered this chat — only the client can (it reads the `x-builderforce-model`
 * response header, recorded by the run store). Without this the tool falls back to the
 * plan default and the assistant answers "probably X" instead of the exact model. The
 * model's own argument wins if it explicitly asked about a specific id.
 */
function withObservedModel(tool: string, args: unknown): unknown {
  if (tool !== CURRENT_MODEL_TOOL) return args;
  const observed = getLastResolvedModel();
  if (!observed) return args;
  const supplied = (args ?? {}) as Record<string, unknown>;
  if (typeof supplied.model === 'string' && supplied.model.trim()) return args;
  return { ...supplied, model: observed };
}

/** Deterministic JSON for the dedupe key (object key order can vary per call). */
function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** A create-like tool whose double-fire should be collapsed (by flat name or `domain.create`). */
function isCreateTool(name: string, tool: string): boolean {
  return /(^|_)create($|_)/.test(name) || tool.endsWith('.create');
}

/** True when a relay result is a recoverable error object (so dedupe lets a retry through). */
function isErrorResult(out: unknown): boolean {
  return !!out && typeof out === 'object' && typeof (out as { error?: unknown }).error === 'string';
}

/**
 * Fetch the tenant's advertised MCP tools.
 *
 * THROWS on any failure rather than resolving to an empty list. That is deliberate: a
 * silent empty catalog leaves the Brain with zero data tools, so every answer degrades
 * to "I don't have that data" — indistinguishable, from the outside, from a weak model.
 * Callers record the reason (the hook publishes it to `mcpToolStatus`; the probe prints
 * it) so a zero is always explained.
 *
 * @param skipExtensionIds extensions the host already registers natively, so the Brain
 * doesn't get the same capability twice.
 */
export async function fetchMcpToolEntries(
  transport: Pick<BrainTransport, 'baseUrl' | 'getToken'>,
  skipExtensionIds: readonly string[] = [],
): Promise<McpToolEntry[]> {
  const token = transport.getToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${transport.baseUrl}/llm/v1/mcp/tools`, { headers });
  if (!res.ok) throw new Error(`tool catalog unavailable (HTTP ${res.status})`);
  const body = (await res.json()) as { tools?: McpToolEntry[] };
  const skip = new Set(skipExtensionIds);
  return (body.tools ?? []).filter((t) => !skip.has(t.extensionId));
}

/**
 * Turn advertised catalog entries into {@link BrainAction}s whose `run()` posts the call
 * through the gateway relay. Pure over its inputs (module-level create-dedupe aside), so
 * the React hook, the headless probe and the offline harness all produce byte-identical
 * tool behaviour.
 */
export function mcpActionsFrom(
  entries: readonly McpToolEntry[],
  transport: Pick<BrainTransport, 'baseUrl' | 'getToken'>,
  onToolResult?: (info: McpToolResultInfo) => void,
): BrainAction[] {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
    // Gate writes off the advertised flag; only an explicit mutates=false is
    // read-only. Undefined (external servers) ⇒ mutating, so the host's
    // confirm-before-mutate gate fires (fail safe).
    mutates: entry.mutates !== false,
    run: (args: unknown) => {
      const mutating = entry.mutates !== false;
      const exec = async (): Promise<unknown> => {
        const token = transport.getToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${transport.baseUrl}/llm/v1/mcp/call`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ extensionId: entry.extensionId, tool: entry.tool, arguments: withObservedModel(entry.tool, args) }),
        });
        const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
        const out = !res.ok ? { error: body.error ?? `MCP call failed (${res.status})` } : (body.result ?? body);
        // Announce the resolved call so the host can refresh live data on writes.
        onToolResult?.({
          name: entry.name, tool: entry.tool, extensionId: entry.extensionId,
          mutating, ok: res.ok && !isErrorResult(out),
        });
        return out;
      };
      // Idempotency guard: collapse a duplicated create within the window.
      if (mutating && isCreateTool(entry.name, entry.tool)) {
        const key = `${entry.extensionId}:${entry.tool}:${stableStringify(args)}`;
        const now = nowMs();
        const prior = recentCreates.get(key);
        if (prior && now - prior.at < CREATE_DEDUPE_MS) return prior.result;
        const result = exec();
        recentCreates.set(key, { at: now, result });
        for (const [k, v] of recentCreates) if (now - v.at >= CREATE_DEDUPE_MS) recentCreates.delete(k);
        // Drop on error so a genuine retry isn't blocked by the window.
        result.then((out) => { if (isErrorResult(out)) recentCreates.delete(key); }).catch(() => recentCreates.delete(key));
        return result;
      }
      return exec();
    },
  }));
}
