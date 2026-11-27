/**
 * The Brain's host hook for the `runtime.*` tools, kept LIGHT: deciding that a catalog
 * entry is a built-in runtime tool needs only the contract's tool ids, so the Brain bridge
 * (mounted in the root layout) can install it without pulling the browser runtime onto
 * every route's first paint. The router — and the WebContainers runtime behind it — loads
 * only when a runtime tool is actually called (`runtimeToolRouter`).
 */
import { RUNTIME_TOOL_IDS, type RuntimeToolId } from '@builderforce/creation-canvas-contract';
import { platformWireToolName } from '@seanhogg/builderforce-mcp';

/** The gateway extension id the server's built-in tools answer under. */
export const BUILTIN_EXTENSION_ID = 'builtin';

export function isRuntimeTool(tool: string): tool is RuntimeToolId {
  return (RUNTIME_TOOL_IDS as readonly string[]).includes(tool);
}

/** The provider name for a relayed platform tool. Runtime tools retain their local contract. */
export const webPlatformWireToolName: typeof platformWireToolName = (entry) =>
  isRuntimeTool(entry.tool) ? undefined : platformWireToolName(entry);

/**
 * The Brain's host hook (`brain-embedded` `LocalToolRouter`): the catalog's built-in
 * `runtime.*` tools are answered through the run-target router — so a Brain chat in the
 * tab that holds a browser run reaches it — and everything else is relayed as usual.
 */
export function localRuntimeToolRouter(entry: { extensionId: string; tool: string }): ((args: unknown) => Promise<unknown>) | undefined {
  if (entry.extensionId !== BUILTIN_EXTENSION_ID || !isRuntimeTool(entry.tool)) return undefined;
  const tool = entry.tool;
  return async (args) => {
    const { executeRuntimeTool } = await import('./runtimeToolRouter');
    return executeRuntimeTool(tool, args && typeof args === 'object' ? (args as Record<string, unknown>) : {});
  };
}
