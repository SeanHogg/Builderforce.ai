import { RUNTIME_TOOLS, runtimeToolFunctionName, type RuntimeToolId } from '@builderforce/creation-canvas-contract';
import { advertiseName, normalizeInputSchema, type McpToolEntry } from '@seanhogg/builderforce-mcp';
import { createMcpServer, withInProcessMcp } from '@seanhogg/builderforce-mcp/server';
import type { ActiveRun } from '../activeRun';
import { runBrowserRuntimeTool, VERIFY_BUDGET_MS, type BrowserToolDeps } from './browserRuntimeTools';

const tools = new Map<RuntimeToolId, McpToolEntry>(RUNTIME_TOOLS.map((tool) => [tool.tool, {
  name: advertiseName('webcontainer', runtimeToolFunctionName(tool.tool)),
  description: tool.description,
  effect: tool.mutates ? 'write' : 'read',
  inputSchema: normalizeInputSchema(tool.parameters),
  surfaces: ['browser'],
}]));

/** The browser run stays bound to the owning tab and the host's approved call. */
export async function callBrowserRuntimeMcp(
  run: ActiveRun,
  tool: RuntimeToolId,
  args: Record<string, unknown>,
  deps: BrowserToolDeps,
): Promise<Record<string, unknown>> {
  const descriptor = tools.get(tool);
  if (!descriptor) return { ok: false, error: 'Unknown browser runtime tool.' };
  let screenshot: string | undefined;
  const server = createMcpServer({
    list: () => [descriptor],
    async callPrepared(_entry, input) {
      const output = await runBrowserRuntimeTool(run, tool, input, deps);
      const { imageDataUrl, ...metadata } = output;
      // Captured image bytes stay in the host and return to the existing image renderer.
      if (tool === 'runtime.preview_screenshot' && typeof imageDataUrl === 'string') screenshot = imageDataUrl;
      return { content: [], structuredContent: metadata };
    },
  }, {
    info: { name: 'builderforce-browser-runtime', version: '1.0.0' },
    // This private server is created only for the call the host already chose to dispatch.
    gate: { approveWrite: () => true },
  });
  const result = await withInProcessMcp(server, (client) => client.callTool({
    name: descriptor.name, arguments: args,
  }, undefined, { timeout: (deps.verifyBudgetMs ?? VERIFY_BUDGET_MS) + 15_000 }));
  const data = result.structuredContent;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const message = Array.isArray(result.content) ? result.content.find((block) => block.type === 'text')?.text : undefined;
    return { ok: false, error: message ?? 'Browser runtime MCP did not return a result.' };
  }
  return screenshot === undefined ? data as Record<string, unknown> : { ...data, imageDataUrl: screenshot };
}
