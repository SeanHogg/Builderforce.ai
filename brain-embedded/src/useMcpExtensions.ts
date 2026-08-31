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
 *
 * The fetch + action construction themselves live in {@link ./mcpCatalog} with no
 * React attached, so the headless probe and the offline scenario harness build the
 * SAME tool list this hook does. This file is only the React binding: effects,
 * cancellation, and publishing the count/error for the diagnostics reporter.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBrainConfig } from './config';
import type { BrainTransport } from './streamChatCompletion';
import { useRegisterBrainActions, type BrainAction } from './BrainActionsContext';
import { setMcpToolStatus } from './mcpToolStatus';
import { fetchMcpToolEntries, mcpActionsFrom, type McpToolEntry, type McpToolResultInfo } from './mcpCatalog';

export type { McpToolResultInfo };

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
  /**
   * Where the PLATFORM lives, when that is not where completions go.
   *
   * `config.transport` answers two different questions that used to have one answer:
   * which endpoint streams the model, and which endpoint serves the tool catalogue. A
   * host that runs the model on the user's own machine splits them — the completion goes
   * to a local runtime, while projects, tasks and OKRs still live on the gateway. Left
   * conflated, pinning an on-device model pointed the catalogue fetch at the local
   * runtime, which serves no such route: the Brain silently lost every platform tool and
   * answered "I don't have that data" with an empty trace.
   *
   * Omit it and the model transport is used, which is correct for every host that has
   * only one endpoint.
   */
  transport?: BrainTransport;
}

export function useMcpExtensions(options?: UseMcpExtensionsOptions): { loading: boolean; toolCount: number; error: string | null } {
  const { transport: modelTransport } = useBrainConfig();
  const transport = options?.transport ?? modelTransport;
  const [entries, setEntries] = useState<McpToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Stable key so the fetch effect doesn't re-run on every render from a fresh array.
  const skipKey = (options?.skipExtensionIds ?? []).join(',');
  // Read the result callback through a ref so the actions memo stays stable.
  const onToolResultRef = useRef(options?.onToolResult);
  onToolResultRef.current = options?.onToolResult;

  useEffect(() => {
    let cancelled = false;
    // A failure here is NOT benign: it leaves the Brain with zero data tools, so
    // every answer degrades to "I don't have that data" with no way to tell it
    // apart from a weak model. Record WHY instead of collapsing to an empty list.
    fetchMcpToolEntries(transport, skipKey ? skipKey.split(',') : [])
      .then((tools) => {
        if (cancelled) return;
        setEntries(tools);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setError(e instanceof Error ? e.message : 'tool catalog fetch failed');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [transport, skipKey]);

  const actions = useMemo<BrainAction[]>(
    () => mcpActionsFrom(entries, transport, (info) => onToolResultRef.current?.(info)),
    [entries, transport],
  );

  useRegisterBrainActions(actions);

  // Publish for the diagnostics reporter — "how many tools did the model actually
  // have, and why not more?" must be answerable after the fact, from any surface.
  useEffect(() => {
    setMcpToolStatus({ count: actions.length, error, loading });
  }, [actions.length, error, loading]);

  return { loading, toolCount: actions.length, error };
}
