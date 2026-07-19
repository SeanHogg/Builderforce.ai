/**
 * Last-known state of the MCP tool catalog fetch — a module singleton, mirroring
 * `lastResolvedModel`.
 *
 * Why this exists: `useMcpExtensions` fetches the gateway's tool catalog, and a
 * failure there (401, 500, network) used to collapse silently to an EMPTY tool
 * list. The Brain then has no data tools, so every answer becomes "I don't have
 * that data" / "calling the tool now" followed by nothing — indistinguishable from
 * a weak model, and invisible in the diagnostics dump.
 *
 * The hook publishes here; the diagnostics reporter reads it, so "how many tools
 * did the model actually have?" is always answerable after the fact.
 */

export interface McpToolStatus {
  /** Tools registered into the Brain's loop (0 = the model can call nothing). */
  count: number;
  /** Why the catalog fetch failed, when it did. Null on success. */
  error: string | null;
  /** True until the first fetch settles. */
  loading: boolean;
}

let status: McpToolStatus = { count: 0, error: null, loading: true };

export function setMcpToolStatus(next: McpToolStatus): void {
  status = next;
}

export function getMcpToolStatus(): McpToolStatus {
  return status;
}
