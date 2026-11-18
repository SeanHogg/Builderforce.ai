/**
 * The `runtime.*` tools as a browser agent's tool host: the shared definitions
 * (`RUNTIME_TOOLS`) as the model sees them, and each call routed to the executor of
 * the target the app runs on (`executeRuntimeTool`).
 */
import { RUNTIME_TOOLS, runtimeToolFunctionName, runtimeToolOfFunctionName } from '@builderforce/creation-canvas-contract';
import type { BrowserToolHost, ToolSchema } from '@/lib/browserRuntime/toolLoop';
import { DEFAULT_ROUTES, executeRuntimeTool, type RuntimeToolRoutes } from './runtimeToolRouter';

export function createRuntimeToolHost(routes: RuntimeToolRoutes = DEFAULT_ROUTES): BrowserToolHost {
  const schemas: ToolSchema[] = RUNTIME_TOOLS.map((spec) => ({
    type: 'function',
    function: { name: runtimeToolFunctionName(spec.tool), description: spec.description, parameters: spec.parameters },
  }));
  return {
    schemas: () => schemas,
    async execute(name, args) {
      const tool = runtimeToolOfFunctionName(name);
      if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
      return executeRuntimeTool(tool, args, routes);
    },
  };
}
