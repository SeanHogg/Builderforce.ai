/**
 * The model id the most recent completion ACTUALLY resolved to.
 *
 * The gateway auto-selects per turn (a connected BYO account, the learned reorder, or
 * a cascade failover can all change which model answers), and it reports the winner on
 * the `x-builderforce-model` response header — which `streamChatCompletion` already
 * surfaces as `StreamChatResult.resolvedModel`. That value was previously only used for
 * after-the-fact triage, so the assistant itself had no way to answer "what model are
 * you running on?" — it would guess, or say it didn't know.
 *
 * Recording it here lets the `builtin_session_current_model` MCP tool be answered with
 * the EXACT model that served the turn instead of the plan default: the MCP bridge reads
 * this and passes it as the tool's `model` argument (an MCP call is a separate request,
 * so the server cannot see the chat's resolved model on its own).
 *
 * Module-level by design, matching the surface: both hosts (the web Brain and the VS
 * Code extension) are single-user processes, and the tool call always lands immediately
 * after the turn that set this. It is therefore "the active conversation's last model" in
 * practice. Deliberately NOT per-chat state — that would need threading through every
 * hook for no behavioural gain at this granularity.
 */

let lastResolvedModel: string | undefined;

/** Record the model a completion resolved to. Ignores empty values so a turn that
 *  reported no model leaves the previous (still-accurate) answer intact. */
export function setLastResolvedModel(model: string | undefined | null): void {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (trimmed) lastResolvedModel = trimmed;
}

/** The model the last completion resolved to, or undefined before any turn has run. */
export function getLastResolvedModel(): string | undefined {
  return lastResolvedModel;
}
