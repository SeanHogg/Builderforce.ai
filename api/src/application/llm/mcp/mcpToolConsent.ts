/**
 * Per-tool consent for an external MCP server.
 *
 * Registering a server used to grant every tool it advertises — and keep granting
 * them, because the server chooses its own catalog and can add a tool after the
 * fact. So consent given on Monday was silently broader on Tuesday, over tools
 * whose descriptions are written by somebody else and go straight into the
 * model's context. That is the "per-tool consent" the roadmap entry asked for
 * before a real external-MCP client shipped.
 *
 * The rule is deliberately small enough to hold in one head:
 *
 *   • `allowedTools = null`  → every tool (what every existing row means today,
 *                              so nothing changes until an owner narrows it).
 *   • `allowedTools = [...]` → exactly those names; a tool the server adds later
 *                              is NOT granted until somebody consents to it.
 *   • `allowedTools = []`    → nothing. A server can stay registered with its
 *                              tools withheld, which is different from disabled.
 *
 * Enforced on BOTH sides — the advertise path filters, the call path refuses —
 * because a filter only the catalog respects is a suggestion: a model that
 * remembers a name from an earlier turn, or a caller hitting the relay directly,
 * would otherwise still reach a withheld tool.
 */

/** A tool name is consented when the extension names it, or names nothing. */
export function isToolConsented(allowedTools: string[] | null | undefined, tool: string): boolean {
  if (allowedTools === null || allowedTools === undefined) return true;
  return allowedTools.includes(tool);
}

/** Keep only the consented entries of one server's advertised tools. */
export function filterConsentedTools<T extends { name: string }>(
  allowedTools: string[] | null | undefined,
  tools: readonly T[],
): T[] {
  if (allowedTools === null || allowedTools === undefined) return [...tools];
  return tools.filter((t) => allowedTools.includes(t.name));
}

/** Thrown at the CALL boundary for a tool the tenant has not consented to. */
export class McpToolNotConsentedError extends Error {
  constructor(readonly tool: string) {
    super(`Tool '${tool}' is not approved for this MCP server. Approve it in the server's settings first.`);
    this.name = 'McpToolNotConsentedError';
  }
}

export function assertToolConsented(allowedTools: string[] | null | undefined, tool: string): void {
  if (!isToolConsented(allowedTools, tool)) throw new McpToolNotConsentedError(tool);
}

/**
 * Normalise what an API caller sent for `allowedTools`.
 *
 * `null` (explicitly) clears the restriction back to "everything"; an array is
 * de-duplicated and stripped of blanks so `[]` and `['', ' ']` mean the same
 * thing; anything else is a caller error rather than a silent reset, because
 * silently widening consent is the one mistake this must not make.
 */
export function normalizeAllowedTools(raw: unknown): string[] | null {
  if (raw === null) return null;
  if (!Array.isArray(raw)) throw new Error('allowedTools must be an array of tool names, or null for all tools');
  const names = raw
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim())
    .filter(Boolean);
  return [...new Set(names)];
}
