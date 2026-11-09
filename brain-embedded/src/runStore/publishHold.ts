/**
 * PUBLISH HOLD — a CHAT-scoped standing hold that refuses every commit / push / PR
 * until the person who set it lifts it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Incident chat #56886 (server #217): the user said "don't commit the code until I
 * have validated all the changes", and a sub-agent (A7) still ran `git_commit` +
 * `git_push` to `main`. Three holes let it through:
 *
 *  (a) `declinesShipping()` reads only the CURRENT run's request text. A sub-agent's
 *      request is its parent's brief, so `runPreamble` gave it the
 *      `selfReviewShipDirective` and `deliveryGates`' unshipped nudge pushed it to ship.
 *  (b) Follow-up turns ("Continue with guidance") drop the phrase, so the root session
 *      regained the ship mandate on the very next turn.
 *  (c) The hold was prose only — nothing REFUSED the tool. In `acceptEdits` mode
 *      `nativeNeedsConfirm` waives commit/push, and children inherit `acceptEdits`
 *      through `childRunHost.autoApproveOf`.
 *
 * The fix makes the hold DATA, not prose:
 *   - A standing hold per chat, SET only by a real user turn that declines shipping
 *     (`declinesShipping`, reused) and LIFTED only by a later real user turn that
 *     explicitly asks to ship (`asksToShip`). Injected nudges, child reports and wake
 *     turns are never person turns, so they can neither set nor lift it.
 *   - While held, `runPreamble` swaps the ship directive for a hold directive, and
 *     `deliveryGates`' unshipped gate stays quiet.
 *   - `callPreflight` refuses `git_commit` / `git_push` / `open_pull_request` and any
 *     `run_command` whose command is a raw `git commit|push` — BEFORE the confirm gate,
 *     so neither `acceptEdits` nor a sub-agent context can waive it.
 *
 * Per-chat state lives on the root chat's CELL (`RunCell.publishHold`), written once
 * per run by `runPreamble` and read by every consumer through the run's ROOT chat
 * (`savedChatOf(runKey, lineage)` — the same lookup `childRunHost.autoApproveOf`
 * uses), so a CHILD can never lift its owner's hold. The cell is the transcript's
 * home; the transcript itself is the durable record (the VSIX journal persists every
 * person turn), so the hold re-derives from a reloaded chat's person turns exactly
 * like `chatAsks` does.
 *
 * Framework-free (strings, Maps, predicates) so it is safe in every bundle.
 */

import { declinesShipping } from '../selfReviewShip';
import { personTurns } from './chatAsks';
import { userTextOf } from './convoText';
import { gitCommandPattern, PUBLISH_TOOLS } from '@builderforce/run-guards';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { BrainTraceEvent } from '../brainTriage';

/** One held chat: which user turn set it, and that turn's words (named on a refusal). */
export interface PublishHold {
  /** 1-based position of the user turn that set the hold, for "set by message #N". */
  messageNumber: number;
  /** The turn's text — quoted on a refusal so the model sees the exact instruction. */
  text: string;
}

/**
 * Lift the hold — a later user turn explicitly asked to commit / push / ship / open a
 * PR. Narrow on purpose: only an affirmative ship order ends a hold the person set,
 * so a follow-up that merely continues the work cannot silently reopen shipping.
 */
const ASKS_TO_SHIP =
  /\b(?:commit|push|ship|merg\w*|land|publish|release)\b/i;

export function asksToShip(text: string | null | undefined): boolean {
  return ASKS_TO_SHIP.test(text ?? '');
}

/** A raw shell `git commit` / `git push`, however git's own options precede the verb. */
const RAW_PUBLISH = gitCommandPattern('commit|push');

/**
 * Is this call a publish the hold must refuse? The declared publish tools by name, and
 * a `run_command` (any — background included) whose command is a raw git commit/push.
 */
export function isPublishCall(name: string, args: unknown): boolean {
  if (PUBLISH_TOOLS.has(name)) return true;
  if (name !== 'run_command') return false;
  const a = args as { command?: unknown; cmd?: unknown } | undefined;
  const command = typeof a?.command === 'string' ? a.command : typeof a?.cmd === 'string' ? a.cmd : '';
  return RAW_PUBLISH.test(command);
}

/**
 * Fold the run's person turns into a publish hold. Walks OLDEST → newest so the SET
 * (a decline) and the LIFT (a later ship order) resolve in order: each decline arms
 * the hold, each later ship order clears it, and the LAST relevant turn wins. Returns
 * null while the chat is not held.
 */
export function publishHoldFromPersonTurns(personTurns: ReadonlyArray<{ text: string }>): PublishHold | null {
  let hold: PublishHold | null = null;
  personTurns.forEach((turn, index) => {
    const text = turn.text;
    if (!text) return;
    if (declinesShipping(text)) hold = { messageNumber: index + 1, text };
    else if (hold && asksToShip(text)) hold = null;
  });
  return hold;
}

/**
 * This chat's publish hold, derived from its transcript exactly like {@link chatAsks}
 * re-derives its asks from a reloaded chat: only PERSON-marked user turns can set or lift
 * it, so an injected nudge, a child report or a wake turn never moves it. Computed per
 * run (cheap: the fold over person turns) rather than persisted — the transcript is the
 * durable record.
 */
export function publishHold(convo: readonly ChatCompletionMessage[]): PublishHold | null {
  const turns: Array<{ text: string }> = [];
  for (const m of convo) {
    if (m?.role === 'user' && personTurns.has(m)) turns.push({ text: userTextOf(m) });
  }
  return publishHoldFromPersonTurns(turns);
}

/** Did this run attempt a publish its chat's hold refused? For the preamble's trace. */
export function attemptedPublishWhileHeld(hold: PublishHold | null, events: readonly BrainTraceEvent[]): boolean {
  if (!hold) return false;
  return events.some((e) => e.category === 'tool' && isPublishCall(e.label, e.args));
}

/**
 * The trace of a publish call the hold refused, for diagnostics: which run and which
 * tool, once, the first time it happens. Returns null before the first refusal.
 */
export function recordPublishRefusal(runKey: number, name: string, args: unknown, events: readonly BrainTraceEvent[]): { runKey: number; tool: string } | null {
  for (const e of events) {
    const r = e.result;
    if (r && typeof r === 'object' && (r as { publishHold?: unknown }).publishHold) {
      return { runKey, tool: e.label };
    }
  }
  return isPublishCall(name, args) ? { runKey, tool: name } : null;
}

/** The directive a held run gets INSTEAD of the ship directive. */
export function publishHoldDirective(): string {
  return (
    'PUBLISH HOLD — the user is holding all commits, pushes and pull requests until they have validated the changes. ' +
    'Do NOT run git_commit, git_push or open_pull_request, and do not publish through a raw `git commit`/`git push` shell command — the tool gate will refuse them. ' +
    'Leave every change uncommitted. Finish your turn with a list of the changed paths and what still needs validation, so the user can review.'
  );
}

/** The refusal a held run's publish call gets back from `callPreflight`. */
export function publishHoldRefusal(hold: PublishHold): { ok: false; error: string } {
  return {
    ok: false,
    error:
      'Publish hold is ON for this chat (set by user message #' + hold.messageNumber + ': "' + hold.text + '"). ' +
      'The user is holding all commits/pushes until they validate the changes. Leave the changes uncommitted; ' +
      'finish with a list of changed paths for review. The hold is lifted only when the user explicitly asks to commit, push or ship.',
  };
}
