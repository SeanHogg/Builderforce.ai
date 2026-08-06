import type { ChatCompletionRequest } from '../llm/LlmProxyService';

/**
 * Canvas tools are descriptions of local, client-side operations. The API never
 * executes them, so they are safe to expose to the metered guest model while
 * tenant and MCP tools remain unavailable to anonymous users.
 */
export const GUEST_CANVAS_TOOL_NAMES = new Set([
  'canvas_read_snapshot',
  // Pure client-side computation over rows already loaded in the guest's own
  // browser. Without it a guest can only be told placeholder numbers.
  'canvas_query_dataset',
  'canvas_add_object',
  'canvas_update_object',
  'canvas_delete_object',
  'canvas_arrange_objects',
  'canvas_set_object_layout',
  'canvas_invoke_object_action',
  'canvas_connect_objects',
  'canvas_update_connection',
  'canvas_delete_connection',
]);

type FunctionTool = {
  type: 'function';
  function: { name: string; description?: string; parameters?: unknown };
};

function isGuestCanvasTool(value: unknown): value is FunctionTool {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; function?: { name?: unknown } };
  return candidate.type === 'function'
    && typeof candidate.function?.name === 'string'
    && GUEST_CANVAS_TOOL_NAMES.has(candidate.function.name);
}

/** Keep only the fixed local-canvas capability set on an anonymous request. */
export function restrictGuestTools(body: ChatCompletionRequest): void {
  const bodyAny = body as Record<string, unknown>;
  const tools = Array.isArray(bodyAny.tools) ? bodyAny.tools.filter(isGuestCanvasTool) : [];
  if (tools.length > 0) {
    bodyAny.tools = tools;
    // Guests may let the model choose among safe canvas tools, but cannot pin a
    // caller-supplied function or require an arbitrary tool.
    bodyAny.tool_choice = 'auto';
    return;
  }
  delete bodyAny.tools;
  delete bodyAny.tool_choice;
}
