/**
 * Auto-generated placeholder names like "Untitled 1773010025035" (an empty-name
 * caller falling back to `Untitled <Date.now()>`) — the word "untitled" alone or
 * followed only by a number/separator. A real name that merely STARTS with
 * "Untitled" (e.g. "Untitled Symphony") is NOT matched, so its slug is kept.
 */
const PLACEHOLDER_NAME = /^untitled[\s-]*\d*$/i;

/**
 * Canonical project-key derivation, shared by the HTTP create route and the
 * first-party MCP server (builtinMcpService) so both mint identical keys.
 * Format: `<tenantId>-<SLUG>` capped at 50 chars. An auto-generated placeholder
 * name collapses to the `PROJECT` fallback so keys never carry junk timestamps
 * (`1-UNTITLED-1773010025035` → `1-PROJECT`).
 */
export function buildProjectKey(tenantId: number, name: string): string {
  const trimmed = name.trim();
  const slug = (PLACEHOLDER_NAME.test(trimmed) ? '' : trimmed)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'PROJECT';
  return `${tenantId}-${slug}`.slice(0, 50);
}
