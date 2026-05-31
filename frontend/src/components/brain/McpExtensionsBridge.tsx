'use client';

/**
 * Mounts the tenant's server-side MCP extensions into the Brain's client tool
 * loop. Rendered (null UI) inside the Brain providers whenever the user is in a
 * workspace, independent of which Brain surface is open — so both the docked
 * drawer and the full Brain Storm page see the tenant's MCP tools.
 */

import { useMcpExtensions } from '@/lib/brain';

export function McpExtensionsBridge() {
  useMcpExtensions();
  return null;
}
