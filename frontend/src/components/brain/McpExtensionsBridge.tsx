'use client';

/**
 * Mounts the tenant's server-side MCP extensions into the Brain's client tool
 * loop. Rendered (null UI) inside the Brain providers whenever the user is in a
 * workspace, independent of which Brain surface is open — so both the docked
 * drawer and the full Brain Storm page see the tenant's MCP tools.
 */

import { useMcpExtensions } from '@/lib/brain';

export function McpExtensionsBridge() {
  // Skip the gateway's first-party `builtin` platform tools here — the browser
  // Brain already registers those natively (and more richly) via
  // PlatformActionsBridge, so loading them again would double the tool list.
  // External / headless MCP clients still receive them from /v1/mcp/tools.
  useMcpExtensions({ skipExtensionIds: ['builtin'] });
  return null;
}
