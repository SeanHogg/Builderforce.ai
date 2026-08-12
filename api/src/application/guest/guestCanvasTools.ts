import { GUEST_CANVAS_TOOL_NAMES } from '@builderforce/creation-canvas-contract';
import type { ChatCompletionRequest } from '../llm/LlmProxyService';

/**
 * The fixed tool vocabulary an anonymous canvas turn may use is declared ONCE, in
 * `@builderforce/creation-canvas-contract`, because two packages enforce it: the
 * browser decides what to ADVERTISE to the model and this gateway decides what to
 * ACCEPT. Maintained as two hand-written lists they drifted — the canvas advertised 24
 * canvas tools while this filter allowed 12, so the model planned around capabilities
 * (a connected mailbox, `canvas_read_object`) that were deleted before dispatch and
 * returned prose with zero tool calls. See the contract module for the measurement.
 *
 * This filter remains the SECURITY boundary regardless: a guest token may never reach
 * a tenant resource, and the client is not trusted to enforce that. It just no longer
 * owns a second, divergent copy of the vocabulary.
 */
export { GUEST_CANVAS_TOOL_NAMES };

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
