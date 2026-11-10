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
 * Lift the hold — a later user turn explicitly ORDERS a commit / push / ship / merge / PR.
 * Narrow on purpose: only an affirmative ship order ends a hold the person set, so a
 * follow-up that merely continues the work cannot silently reopen shipping.
 *
 * Two ways a turn is that order:
 *
 * (A) A CLAUSE (split on sentence punctuation and commas) that IS the order, whole:
 *
 *   [acknowledgement…] [go-ahead framing] VERB [publish tail…] <end of clause>
 *
 *  - acknowledgement: "ok", "yes", "lgtm", "looks good", "validated", "please", "now"…
 *  - go-ahead framing (optional): "go ahead and", "you can (now)", "can/could you",
 *    "you are good/clear to", "feel free to", "(it is) ok/fine/safe to", "time to",
 *    "let us", "please".
 *  - VERB: commit · push · ship · merge · land · publish · release · open/raise a PR —
 *    and it must OPEN the clause (after the two parts above), so "fix the push
 *    notification handler" / "update the release notes" never match.
 *  - publish tail: ONLY words naming what is shipped or where ("it", "everything", "the
 *    changes", "up", "to main", "to the feature branch", "and push") or "now"/"please"/
 *    "then" — and nothing else up to the clause end. So a verb used as a noun ("push
 *    notifications are broken", "commit message is too long") never matches, and neither
 *    does an order with a condition hanging off it ("commit it after I check the tests").
 *
 * (B) A bare affirmative ("yes", "go ahead", "do it") answering an assistant turn that
 *     ASKED to publish ("Shall I commit and push?") — the prior assistant turn is read.
 *
 * Either way, a DEFERRAL anywhere in the turn ("not yet", "after", "once", "later",
 * "tomorrow", "until"…) means the order is not for now, and the hold stands. A negated
 * order ("don't push yet") never opens with the verb, and `declinesShipping` re-arms the
 * hold on it anyway.
 */
const PUBLISH_VERB = String.raw`(?:commit|push|ship|merge|land|publish|release|(?:open|raise|create)\s+(?:a|the)\s+(?:pr|pull\s+request))`;

const PUBLISH_TAIL =
  String.raw`(?:it|them|this|that|these|those|everything|all|now|away|up|changes|please|then|too|as\s+well|for\s+me|right\s+away|` +
  String.raw`(?:the|your|my|our)\s+(?:changes?|code|work|fix(?:es)?|branch|commits?|pr|diff|edits?|updates?|lot)|` +
  String.raw`and\s+${PUBLISH_VERB}|` +
  String.raw`to\s+(?:main|master|github|prod(?:uction)?|(?:the\s+)?(?:remote|repo|origin)(?:/[\w./-]+)?|origin/[\w./-]+|the\s+(?:[\w./-]+\s+)?branch|[\w./-]+\s+branch))`;

const ACKNOWLEDGEMENT =
  String.raw`(?:(?:ok(?:ay)?|yes|yep|yeah|sure|great|good|perfect|thanks|thank\s+you|lgtm|looks\s+good|all\s+good|validated|verified|approved|done|now|please|so|then|and|alright)\b[\s!–—-]*)*`;

const GO_AHEAD =
  String.raw`(?:go\s+ahead\s+(?:and\s+)?|you\s+(?:can|may)\s+(?:now\s+)?(?:go\s+ahead\s+and\s+)?|` +
  String.raw`(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:now\s+)?|` +
  String.raw`you(?:['’]re|\s+are)\s+(?:good|clear(?:ed)?|free|ok(?:ay)?|fine)\s+to\s+|` +
  String.raw`feel\s+free\s+to\s+|(?:it\s+is\s+|it['’]?s\s+)?(?:ok(?:ay)?|fine|safe)\s+to\s+|time\s+to\s+|let['’]?s\s+|please\s+)?`;

const SHIP_ORDER = new RegExp(String.raw`^${ACKNOWLEDGEMENT}${GO_AHEAD}${PUBLISH_VERB}(?:\s+${PUBLISH_TAIL})*$`, 'i');

/** A turn that puts the order off: not for now, so the hold stands. */
const DEFERRAL =
  /\b(?:not\s+yet|after|when|once|later|tomorrow|tonight|next|until|till|before|wait|hold\s+off|in\s+a\s+(?:bit|minute|moment|while|few))\b/i;

/** An assistant turn that ASKED whether to publish ("Shall I commit and push?"). */
const ASSISTANT_ASKS_TO_SHIP =
  /\b(?:shall|should|can|may)\s+I\s+(?:go\s+ahead\s+and\s+)?(?:now\s+)?(?:commit|push|ship|merge|land|publish|open\s+(?:a|the)\s+(?:pr|pull\s+request))\b[^?]*\?|\b(?:do\s+you\s+want|want|would\s+you\s+like)\s+me\s+to\s+(?:go\s+ahead\s+and\s+)?(?:commit|push|ship|merge|land|publish|open\s+(?:a|the)\s+(?:pr|pull\s+request))\b[^?]*\?/i;

/** A turn that is ONLY an affirmative — "yes", "go ahead", "do it", "please do"… */
const BARE_AFFIRMATIVE =
  /^(?:(?:yes|yep|yeah|yup|sure|ok(?:ay)?|go\s+ahead|go\s+for\s+it|do\s+it|please\s+do|please|sounds\s+good|lgtm|approved|absolutely|definitely|thanks|thank\s+you)[\s,.!]*)+$/i;

/**
 * Does this person turn order a publish? `priorAssistant` is the assistant turn it
 * answers (when known), so a bare "yes" to "Shall I commit?" lifts.
 */
export function asksToShip(text: string | null | undefined, priorAssistant?: string | null): boolean {
  const turn = (text ?? '').trim();
  if (!turn || DEFERRAL.test(turn)) return false;
  if (priorAssistant && BARE_AFFIRMATIVE.test(turn) && ASSISTANT_ASKS_TO_SHIP.test(priorAssistant)) return true;
  return turn
    .split(/[.!?;:\n,]+/)
    .some((clause) => SHIP_ORDER.test(clause.trim()));
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
export function publishHoldFromPersonTurns(personTurns: ReadonlyArray<{ text: string; priorAssistant?: string }>): PublishHold | null {
  let hold: PublishHold | null = null;
  personTurns.forEach((turn, index) => {
    const text = turn.text;
    if (!text) return;
    if (declinesShipping(text)) hold = { messageNumber: index + 1, text };
    else if (hold && asksToShip(text, turn.priorAssistant)) hold = null;
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
  const turns: Array<{ text: string; priorAssistant?: string }> = [];
  // The assistant turn each person turn answers, so "yes" to "Shall I push?" is read as the order it is.
  let priorAssistant = '';
  for (const m of convo) {
    if (m?.role === 'assistant') {
      const said = userTextOf(m); // any message's text parts — the helper is not user-specific
      if (said) priorAssistant = said;
    } else if (m?.role === 'user' && personTurns.has(m)) {
      turns.push({ text: userTextOf(m), ...(priorAssistant ? { priorAssistant } : {}) });
      priorAssistant = '';
    }
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
