/**
 * Canonical project-key derivation, shared by the HTTP create route and the
 * first-party MCP server (builtinMcpService) so both mint identical keys.
 * Format: `<tenantId>-<SLUG>` capped at 50 chars.
 */
export function buildProjectKey(tenantId: number, name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'PROJECT';
  return `${tenantId}-${slug}`.slice(0, 50);
}
