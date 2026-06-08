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

import { useEffect, useMemo, useState } from 'react';
import { useBrainConfig } from './config';
import { useRegisterBrainActions, type BrainAction } from './BrainActionsContext';

interface McpToolEntry {
  extensionId: string;
  tool: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface UseMcpExtensionsOptions {
  /**
   * Extension ids to drop from the fetched tool list. A host that already
   * registers some of the gateway's tools natively (e.g. first-party platform
   * actions exposed under a `builtin` extension) passes those ids here so the
   * Brain doesn't get the same capability twice.
   */
  skipExtensionIds?: string[];
}

export function useMcpExtensions(options?: UseMcpExtensionsOptions): { loading: boolean; toolCount: number } {
  const { transport } = useBrainConfig();
  const [entries, setEntries] = useState<McpToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Stable key so the fetch effect doesn't re-run on every render from a fresh array.
  const skipKey = (options?.skipExtensionIds ?? []).join(',');

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
        run: async (args: unknown) => {
          const token = transport.getToken();
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers.Authorization = `Bearer ${token}`;
          const res = await fetch(`${transport.baseUrl}/llm/v1/mcp/call`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ extensionId: entry.extensionId, tool: entry.tool, arguments: args }),
          });
          const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
          if (!res.ok) return { error: body.error ?? `MCP call failed (${res.status})` };
          return body.result ?? body;
        },
      })),
    [entries, transport],
  );

  useRegisterBrainActions(actions);

  return { loading, toolCount: actions.length };
}
