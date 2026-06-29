'use client';

/**
 * Mounts the gateway's MCP tool catalog into the Brain's client tool loop —
 * BOTH the tenant's external MCP servers AND the first-party `builtin` platform
 * catalog (projects/tasks/OKRs/…). This is the SAME source the VS Code chat
 * consumes, so the two brains share one tool catalog (no duplicated lists).
 *
 * The first-party `builtin` tools used to be skipped here because the browser
 * Brain registered them natively via PlatformActionsBridge. That native manifest
 * is being collapsed into the catalog: PlatformActionsBridge now DROPS every
 * capability the catalog already owns (see its excludeToolKeys), so registering
 * `builtin` here is what actually surfaces those — each capability lives in
 * exactly one place. Writes are announced on the brain-data bus so views refetch.
 */

import { useMcpExtensions } from '@/lib/brain';
import { dispatchBrainDataChanged } from '@/lib/brain/brainDataEvent';
import type { McpToolResultInfo } from '@seanhogg/builderforce-brain-embedded';

export function McpExtensionsBridge() {
  useMcpExtensions({
    // Announce successful writes so the page rendering that domain refetches live
    // (the catalog-path equivalent of the native manifest's per-cap announce).
    onToolResult: (info: McpToolResultInfo) => {
      if (!info.mutating || !info.ok) return;
      const dot = info.tool.indexOf('.');
      const domain = dot > 0 ? info.tool.slice(0, dot) : info.tool;
      const method = dot > 0 ? info.tool.slice(dot + 1) : '';
      dispatchBrainDataChanged({ domain, method });
    },
  });
  return null;
}
