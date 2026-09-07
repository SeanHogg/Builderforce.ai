/**
 * Which model ACTUALLY answered — per conversation — and how a tool call gets told.
 *
 * The gateway auto-selects per turn (a connected BYO account, the learned reorder, or a
 * cascade failover can all change which model answers), and it reports the winner on the
 * `x-builderforce-model` response header, which `streamChatCompletion` surfaces as
 * `StreamChatResult.resolvedModel`. An MCP call is a SEPARATE request, so the server
 * cannot see which model served this chat — only the client can. Without this the
 * `session.current_model` tool falls back to the plan default and the assistant answers
 * "probably X" about itself.
 *
 * ## Why this is keyed by chat
 *
 * It used to be one module-level string, justified by "both hosts are single-user
 * processes and the tool call lands immediately after the turn that set it". That stopped
 * being true when the VS Code extension moved the agent loop into the extension host so
 * runs survive their tab: several chats now execute AT ONCE, and a single slot means chat
 * A's `session.current_model` can be answered with the model that served chat B — a wrong
 * answer produced with total confidence, about the one subject the tool exists to be
 * authoritative on. Interleaving is not a corner case here; it is the normal shape of two
 * runs sharing a process.
 *
 * ## Why the SHAPER lives here too
 *
 * The web Brain used to fold the observed model into the tool's arguments inside its MCP
 * relay (`mcpCatalog.ts`), which meant the editor — whose platform tools go through their
 * own relay in `clients/vscode/src/platformTools.ts` — never got it at all. Answering that
 * by adding a second copy to the second relay would be two implementations of one rule,
 * and would put the rule in the layer that has no idea which chat is asking. So the rule
 * lives here, beside the value it reads, and is applied ONCE by the run loop — which is
 * the only layer that knows both the chat and the call. Every surface that runs the shared
 * loop gets it, with no relay needing to know this tool exists.
 */

/**
 * Conversations remembered. A host keeps one process across a long session, so this is
 * bounded rather than left to grow with every chat ever opened; the oldest entry is
 * dropped, and a dropped chat simply falls back to the tool's own default on its next
 * call (the value is a convenience, never a correctness input).
 */
const MAX_CHATS = 64;

const byChat = new Map<number, string>();

/** Record the model a completion resolved to, for the chat it served. Ignores empty
 *  values so a turn that reported no model leaves the previous (still-accurate) answer
 *  intact. */
export function setLastResolvedModel(chatId: number, model: string | undefined | null): void {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed) return;
  // Re-insert so the most recently active chat is the newest key — plain insertion-order
  // eviction, which for this map is exactly least-recently-used.
  byChat.delete(chatId);
  byChat.set(chatId, trimmed);
  if (byChat.size > MAX_CHATS) {
    const oldest = byChat.keys().next();
    if (!oldest.done) byChat.delete(oldest.value);
  }
}

/** The model this chat's last completion resolved to, or undefined before any turn. */
export function getLastResolvedModel(chatId: number): string | undefined {
  return byChat.get(chatId);
}

/** Forget a chat — a run store reset must not leave a stale model behind it. */
export function forgetResolvedModels(): void {
  byChat.clear();
}

/**
 * The catalog tool that reports which model is serving the conversation, by both names
 * it can arrive under: the underlying MCP tool id, and the flat, gateway-safe name the
 * model actually sees and the run loop dispatches on.
 */
const CURRENT_MODEL_TOOLS = new Set(['session.current_model', 'builtin_session_current_model']);

/**
 * Supply the model THIS chat's last turn resolved to as the `model` argument of
 * `session.current_model`. Every other call passes through untouched, and a model that
 * explicitly asked about a specific id keeps its own argument — the tool is then being
 * used to look something up, not to introspect.
 */
export function withObservedModel(chatId: number, tool: string, args: unknown): unknown {
  if (!CURRENT_MODEL_TOOLS.has(tool)) return args;
  const observed = getLastResolvedModel(chatId);
  if (!observed) return args;
  const supplied = (args ?? {}) as Record<string, unknown>;
  if (typeof supplied.model === 'string' && supplied.model.trim()) return args;
  return { ...supplied, model: observed };
}
