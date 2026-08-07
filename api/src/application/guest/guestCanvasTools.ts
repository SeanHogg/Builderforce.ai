import type { ChatCompletionRequest } from '../llm/LlmProxyService';

/**
 * The fixed tool vocabulary an anonymous canvas turn may use. Two kinds, both safe for
 * a guest for different reasons:
 *
 *  • `canvas_*` — descriptions of LOCAL, client-side operations on the guest's own
 *    in-browser document. The API never executes them.
 *  • `builtin_web_*` / `builtin_geo_*` — RESEARCH. These do run server-side, but only
 *    through the public guest research surface (`/api/guest/research/*`), which takes a
 *    signed guest token, charges its own daily allowance, uses the PLATFORM search
 *    backing rather than any tenant's key, and fetches behind the same SSRF guard as
 *    every other surface. They are on this list because a canvas that cannot look
 *    anything up answers research questions from the model's weights and invents its
 *    numbers — which is exactly what an anonymous visitor asks it to do first.
 *
 * Every other tenant, MCP, filesystem and caller-invented tool stays unavailable.
 */
export const GUEST_CANVAS_TOOL_NAMES = new Set([
  'canvas_read_snapshot',
  // Pure client-side computation over rows already loaded in the guest's own
  // browser. Without it a guest can only be told placeholder numbers.
  'canvas_query_dataset',
  'canvas_read_document',
  'canvas_add_object',
  'canvas_update_object',
  'canvas_delete_object',
  'canvas_arrange_objects',
  'canvas_set_object_layout',
  'canvas_invoke_object_action',
  'canvas_connect_objects',
  'canvas_update_connection',
  'canvas_delete_connection',
  // Research. The names MUST match the advertised `builtin_*` names the authed canvas
  // gets from the MCP catalog, because ONE system prompt names these tools for both
  // surfaces (see prompt-tool-name contract, api/scripts/check-prompt-tool-names.mjs).
  'builtin_web_search',
  'builtin_web_fetch',
  'builtin_geo_geocode',
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
