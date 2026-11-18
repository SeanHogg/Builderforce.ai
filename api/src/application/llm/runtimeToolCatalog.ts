/**
 * The RUN LOOP tool catalog (`runtime.*`, PRD 31 §W1 item 8 / §4.7), spread into
 * `builtinMcpService`'s `CATALOG` — grouped as DATA: one row per entry of the shared
 * `RUNTIME_TOOLS` definition, so the name, schema and description the model sees here
 * are the ones the browser executor answers to as well.
 *
 * This is the server-side (container) executor's front door; the browser run's executor
 * lives in the tab that holds it (`frontend/src/lib/runTarget/runtimeTools`).
 */
import { RUNTIME_TOOLS } from '@builderforce/creation-canvas-contract';
import { runContainerRuntimeTool } from '../runtime/runtimePreviewTools';
import type { BuiltinTool } from './builtinToolContext';

export const RUNTIME_PREVIEW_TOOLS: BuiltinTool[] = RUNTIME_TOOLS.map((spec) => ({
  tool: spec.tool,
  mutates: spec.mutates,
  description: spec.description,
  parameters: spec.parameters,
  run: async (ctx, args) => {
    if (!ctx.env) return { ok: false, error: 'the run-loop tools need the worker environment' };
    return runContainerRuntimeTool({
      env: ctx.env, db: ctx.db, tenantId: ctx.tenantId,
      userId: ctx.userId ?? null, role: ctx.role, isAgent: Boolean(ctx.agentRef),
    }, spec.tool, args);
  },
}));
