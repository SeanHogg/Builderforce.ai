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
// Deterministic JSON for the dedupe key (object key order can vary per call) — shared
// with the run loop's read-repeat guard, so both fingerprint arguments the same way.
import { stableStringify } from '@builderforce/agent-tools';

import { createMcpRelay, relayDispatchCatalog, requiresWriteApproval, type RelayCallResult, type RelayDispatchToolEntry as McpToolEntry } from "@seanhogg/builderforce-mcp";
export type { RelayDispatchToolEntry as McpToolEntry } from "@seanhogg/builderforce-mcp";

/**
 * The host's say over where a catalog tool runs: return a runner for a tool the host
 * answers itself (it decides, e.g. by where the app runs), or undefined to relay it
 * through the gateway as usual. Kept generic so the package stays portable.
 */
export type LocalToolRouter = (entry: McpToolEntry) => ((args: unknown) => Promise<unknown>) | undefined;
export type McpToolWireName = (entry: McpToolEntry) => string | undefined;

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
// would double-write. Collapsing an identical authenticated relay create within
// the same scope to the first call's promise makes a double-fire idempotent.
// Module-scoped so it survives the per-render actions rebuild. NOT a data cache —
// results aren't retained past the window and errors are dropped so a genuine
// retry isn't blocked.
const CREATE_DEDUPE_MS = 8000;
const recentCreates = new Map<string, { at: number; result: Promise<unknown> }>();

function nowMs(): number {
  return typeof Date !== 'undefined' ? Date.now() : 0;
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
  const tools = await createMcpRelay({
    baseUrl: transport.baseUrl, token: transport.getToken(), catalogNames: 'canonical',
  }).list();
  const skip = new Set(skipExtensionIds);
  // Catalog names are provider-facing. Brain actions and host callbacks keep their policy IDs.
  return relayDispatchCatalog(tools.filter((tool) => !skip.has(tool.extensionId)));
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
  localTools?: LocalToolRouter,
  toolWireName?: McpToolWireName,
): BrainAction[] {
  return entries.map((entry) => ({
    name: entry.name,
    wireName: toolWireName ? toolWireName(entry) : entry.wireName,
    description: entry.description,
    parameters: entry.parameters,
    // Gate writes off the advertised flag; only an explicit mutates=false is
    // read-only. Undefined (external servers) ⇒ mutating, so the host's
    // confirm-before-mutate gate fires (fail safe).
    mutates: requiresWriteApproval(entry),
    run: async (args: unknown) => {
      const mutating = requiresWriteApproval(entry);
      const local = localTools?.(entry);
      const token = local ? null : transport.getToken();
      const exec = async (): Promise<unknown> => {
        // A tool the HOST can answer where the work lives (a browser run's `runtime.*`
        // tools, answered in the tab that holds the run) is routed there; the host's
        // router falls back to the gateway itself when it cannot.
        if (local) {
          const out = await local(args);
          onToolResult?.({ name: entry.name, tool: entry.tool, extensionId: entry.extensionId, mutating, ok: !isErrorResult(out) });
          return out;
        }
        const relay = createMcpRelay({ baseUrl: transport.baseUrl, token });
        const res = await relay.call({ extensionId: entry.extensionId, tool: entry.tool, arguments: args });
        const body = (await res.json().catch(() => ({}))) as RelayCallResult;
        const out = !res.ok ? { error: body.error ?? `MCP call failed (${res.status})` } : (body.result ?? body);
        // Announce the resolved call so the host can refresh live data on writes.
        onToolResult?.({
          name: entry.name, tool: entry.tool, extensionId: entry.extensionId,
          mutating, ok: res.ok && !isErrorResult(out),
        });
        return out;
      };
      // Idempotency guard: collapse a duplicated create within the window.
      if (token && mutating && isCreateTool(entry.name, entry.tool)) {
        const key = JSON.stringify([transport.baseUrl, token, entry.extensionId, entry.tool, stableStringify(args)]);
        const now = nowMs();
        const prior = recentCreates.get(key);
        if (prior && now - prior.at < CREATE_DEDUPE_MS) return prior.result;
        const result = exec();
        recentCreates.set(key, { at: now, result });
        for (const [k, v] of recentCreates) if (now - v.at >= CREATE_DEDUPE_MS) recentCreates.delete(k);
        // Drop on error so a genuine retry isn't blocked by the window.
        const drop = () => { if (recentCreates.get(key)?.result === result) recentCreates.delete(key); };
        result.then((out) => { if (isErrorResult(out)) drop(); }).catch(drop);
        return result;
      }
      return exec();
    },
  }));
}
