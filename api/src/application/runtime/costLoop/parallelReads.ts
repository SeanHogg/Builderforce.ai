/**
 * D8 — the durable runner's `isReadOnly` port over the shared read-only table
 * (`readOnlyTools.ts`, which the container image loop reads too, compiled).
 * Lever off ⇒ no port ⇒ the kernel's sequential path, exactly as before.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { ParsedToolCall } from '@builderforce/agent-loop';
import { isReadOnlyCloudTool } from './readOnlyTools';

export { READ_ONLY_CLOUD_TOOLS, isReadOnlyCloudTool } from './readOnlyTools';

/** The kernel port for this tenant: `{ isReadOnly }` while D8 is on, else nothing. */
export function readOnlyDispatchPort(env: unknown, tenantId: number): { isReadOnly?: (call: ParsedToolCall) => boolean } {
  return isCostLeverOn(env, 'd8_parallel_tool_calls', tenantId) ? { isReadOnly: (call) => isReadOnlyCloudTool(call.name) } : {};
}
