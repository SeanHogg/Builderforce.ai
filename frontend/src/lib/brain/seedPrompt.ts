/**
 * Where a one-shot SEED prompt lands.
 *
 * A seed is a prompt the user typed somewhere other than the Brain composer —
 * the home/landing page handed off through auth, a page-published `?prompt=`
 * deep link — and it is always the START of a new train of thought.
 *
 * The Brain drawer deliberately restores the chat you were last in (see
 * BrainContext's sessionStorage rehydration), so without this a returning
 * visitor's fresh idea was appended to a conversation from days ago: the reply
 * was answered in the wrong context and the old thread was polluted. A seed
 * therefore clears the restored selection FIRST and then sends, which makes the
 * conversation hook create a brand-new chat for it.
 *
 * The two exceptions are seeds that already name their chat: a `?chat=` deep
 * link, and an auto-linked work item (`?ticket=`) whose chat was just created
 * for it. Those send into the chat they were paired with.
 *
 * Pure so the (necessarily effect-driven) caller stays a two-liner.
 */
export type SeedPromptStep =
  /** Nothing to do yet — no prompt, not ready, or already handled. */
  | 'wait'
  /** Drop the restored chat selection; the next pass sends into a fresh chat. */
  | 'clear-selection'
  /** Send now. */
  | 'send';

export interface SeedPromptState {
  /** The seed itself. Blank/absent means there is nothing to place. */
  prompt?: string;
  /** False while a prerequisite (chat list load, ticket auto-link) is in flight. */
  ready: boolean;
  /** True once this seed has been sent — a seed is single-use. */
  alreadySent: boolean;
  /** A chat named by the caller (`?chat=`), which the seed belongs in. */
  targetChatId?: number | null;
  /** A work item auto-linked to a chat, which the seed belongs in. */
  targetTicket?: unknown;
  /** The chat currently selected (restored from the previous visit, or picked). */
  activeChatId: number | null;
  /** True once the selection has been cleared, so we never clear twice. */
  selectionCleared: boolean;
}

export function nextSeedPromptStep(state: SeedPromptState): SeedPromptStep {
  if (!state.prompt?.trim() || !state.ready || state.alreadySent) return 'wait';
  // The seed names its own chat — send into it, whatever is selected.
  if (state.targetChatId != null || state.targetTicket != null) return 'send';
  if (state.activeChatId == null) return 'send';
  // A chat is still selected: clear it once, then wait for the re-render that
  // reports `activeChatId === null` before sending (so the send can't race a
  // stale selection into the old conversation).
  return state.selectionCleared ? 'wait' : 'clear-selection';
}
