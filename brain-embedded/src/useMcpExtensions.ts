'use client';

/**
 * Bridges SERVER-side MCP extensions into the client tool loop.
 *
 * A tenant registers custom MCP servers in the portal; the gateway advertises
 * their tools at `GET /llm/v1/mcp/tools` and relays calls at `POST /llm/v1/mcp/call`
 * (server-to-server, so the MCP secret never reaches the browser). This hook
 * fetches those tools and registers each as a `BrainAction` whose `run()` posts
 * the call back through the relay. Mount it once inside a BrainProvider +
 * BrainActionsProvider and the Brain can use the tenant's MCP extensions exactly
 * like any in-app action.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBrainConfig } from './config';
import { useRegisterBrainActions, type BrainAction } from './BrainActionsContext';
import { getLastResolvedModel } from './lastResolvedModel';

interface McpToolEntry {
  extensionId: string;
  tool: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Whether the tool writes. Drives the confirm-before-mutate gate. Undefined
   *  (external MCP servers don't advertise it) ⇒ treated as mutating (fail safe). */
  mutates?: boolean;
}

/** What a tool call resolved to — handed to {@link UseMcpExtensionsOptions.onToolResult}. */
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

export interface UseMcpExtensionsOptions {
  /**
   * Extension ids to drop from the fetched tool list. A host that already
   * registers some of the gateway's tools natively (e.g. first-party platform
   * actions exposed under a `builtin` extension) passes those ids here so the
   * Brain doesn't get the same capability twice.
   */
  skipExtensionIds?: string[];
  /**
   * Called after every relay tool call resolves. Lets the host react to writes —
   * e.g. dispatch a "brain data changed" event so the page rendering that domain
   * refetches live instead of going stale. Replaces the per-cap announce wrapper
   * the app used to apply in its native manifest, so catalog tools refresh the UI
   * the same way. Kept generic (no app types) so the package stays portable.
   */
  onToolResult?: (info: McpToolResultInfo) => void;
}

// Short-window dedupe of identical create-like tool calls. The Brain occasionally
// emits the SAME create call twice in one turn (it "plans" then "creates"), which
// would double-write. Collapsing an identical create (same extension+tool+args)
// within the window to the first call's promise makes a double-fire idempotent.
// Module-scoped so it survives the per-render actions rebuild. NOT a data cache —
// results aren't retained past the window and errors are dropped so a genuine
// retry isn't blocked. Mirrors the guard the app's native manifest used.
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

export function useMcpExtensions(options?: UseMcpExtensionsOptions): { loading: boolean; toolCount: number } {
  const { transport } = useBrainConfig();
  const [entries, setEntries] = useState<McpToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Stable key so the fetch effect doesn't re-run on every render from a fresh array.
  const skipKey = (options?.skipExtensionIds ?? []).join(',');
  // Read the result callback through a ref so the actions memo stays stable.
  const onToolResultRef = useRef(options?.onToolResult);
  onToolResultRef.current = options?.onToolResult;

  useEffect(() => {
    let cancelled = false;
    const token = transport.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const skip = new Set(skipKey ? skipKey.split(',') : []);

    fetch(`${transport.baseUrl}/llm/v1/mcp/tools`, { headers })
      .then((res) => (res.ok ? res.json() : { tools: [] }))
      .then((body: { tools?: McpToolEntry[] }) => {
        if (!cancelled) setEntries((body.tools ?? []).filter((t) => !skip.has(t.extensionId)));
      })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [transport, skipKey]);

  const actions = useMemo<BrainAction[]>(
    () =>
      entries.map((entry) => ({
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
            onToolResultRef.current?.({
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
      })),
    [entries, transport],
  );

  useRegisterBrainActions(actions);

  return { loading, toolCount: actions.length };
}
