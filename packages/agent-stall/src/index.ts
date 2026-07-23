/**
 * Announced-but-untaken tool call — detection + recovery, shared by every agent loop.
 *
 * The failure it fixes: a model ends its turn saying what it is ABOUT to do —
 * `"I'll search the codebase for the handler."`, `"Calling the tool now."` — with
 * `stopReason: stop` and ZERO tool calls. A loop that treats "no tool calls" as
 * "done" then hands the user a promise instead of a result, and the run is over.
 * Observed on `xai-oauth/grok-4.3` in a VS Code Brain chat, but it is a
 * model-behaviour class, not a vendor bug.
 *
 * Deliberately zero-dependency, framework-free and free of Node builtins: the Brain
 * run loop imports this into a BROWSER bundle (VS Code webview / Next.js client)
 * while the on-prem + cloud agent loop imports it into Node and the Worker.
 */

/**
 * First-person commitment to act. REQUIRED — this is the discriminator that makes a
 * broad verb list safe. "I'll search…" / "Let me check…" is a stall; the very same
 * verb aimed at the user ("You can call the API", "Check the gateway logs") is a
 * finished answer. `let(?:'?s| me| us)` has no space before the contraction so
 * "Let's dig in" matches alongside "Let me dig in"; the leading `\b` keeps
 * "outlets"/"tablets" out.
 */
const ANNOUNCE_SUBJECT =
  "\\b(?:i(?: will|'ll| am going to|'m going to| am about to| plan to)|let(?:'?s| me| us)|going to|about to|next,? i'?l?l?|now)";

/** Optional hedges/adverbs models slip between the subject and the verb. */
const ANNOUNCE_FILLER =
  '(?:\\s+(?:now|then|first|next|quickly|briefly|just|also|actually|go ahead and|try to|attempt to))*';

/**
 * Broad on purpose — the subject prefix above carries the discrimination. An earlier
 * narrow list (call/use/invoke/run/query/fetch/retrieve/look up/pull/check/get)
 * missed the phrasings models actually stall with: "I'll SEARCH the codebase",
 * "Let me LOOK AT the PRs", "Let me FIND the agents", "Let me DO that now",
 * "Let me START by examining …". Excludes "know" so "Let me know if …" — a complete
 * answer inviting follow-up — stays out.
 */
const ANNOUNCE_VERB =
  '(?:call|use|invoke|run|execute|trigger|query|fetch|retrieve|request|look|search|scan|find|locate|examine|inspect|review|read|list|check|verify|confirm|get|grab|pull|load|open|gather|dig|explore|investigate|analy[sz]e|start|begin|take|do|see|walk|trace|map)';

/** Bare gerund sign-offs ("Searching now.", "Pulling the data.") — no subject at all. */
const ANNOUNCE_GERUND =
  '(?:searching|fetching|retrieving|querying|loading|checking|looking|scanning|reading|listing|gathering|pulling|examining|inspecting|reviewing|analy[sz]ing)';

const ANNOUNCED_ACTION = new RegExp(
  [
    'calling (the|this|that|a|it|them|these) [\\w\\s-]*?(tool|function|api|now)',
    `${ANNOUNCE_SUBJECT}${ANNOUNCE_FILLER}\\s+${ANNOUNCE_VERB}\\b`,
    '(one|just a) (moment|second|sec)\\b',
    `${ANNOUNCE_GERUND} (it|that|this|these|those|the [\\w-]+|now|for)\\b`,
    'stand ?by\\b',
  ].join('|'),
  'i',
);

/** How much of the reply's tail is considered. Only the sign-off matters — a
 *  mid-answer "let me check that" inside an otherwise complete answer is not a stall. */
const TAIL_CHARS = 240;

/**
 * Does this reply PROMISE a tool call rather than make one?
 *
 * A false positive costs one extra model turn; a false negative strands the user
 * holding a promise — so the bias runs toward catching the stall.
 */
export function announcesUntakenAction(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return ANNOUNCED_ACTION.test(t.slice(-TAIL_CHARS));
}

/**
 * How many times ONE run may re-prompt a model that announced a tool call and then
 * ended the turn without making one. Each costs a model turn, so it stays small —
 * but >1, because the stall repeats: the models that promise "I'll search…" tend to
 * promise it twice. Callers keep their own iteration ceiling as the outer bound.
 */
export const MAX_ANNOUNCEMENT_RECOVERIES = 3;

/**
 * The re-prompt. One wording for every surface, so a stalling model gets the same
 * correction in a Brain chat as in an autonomous cloud run.
 *
 * @param lastChance the caller has exhausted {@link MAX_ANNOUNCEMENT_RECOVERIES} —
 * escalate, because after this turn the reply is shown to the user as-is.
 */
export function stallRecoveryNudge(lastChance: boolean): string {
  return (
    'You said you would call a tool but did not actually call one — your last turn made zero tool calls.'
    + ' Make the call NOW in this turn, then answer using its result. If no tool can give you that data,'
    + ' say plainly which data you are missing and answer with what you already have.'
    + ' Do not announce another call.'
    + (lastChance
      ? ' This is your last chance to act: you have now stated an intention without acting several times in'
        + ' a row. Either emit a tool call in this turn, or give your complete final answer from what you'
        + ' already know — an answer that only describes what you are about to do will be shown to the user as-is.'
      : '')
  );
}

/**
 * Should this turn be re-prompted instead of accepted as the final answer?
 *
 * Folds the whole gate — tools were actually offered, the budget is not spent, the
 * turn made no tool calls, and its text is an announcement — so no caller
 * re-implements the branching condition.
 */
export function shouldRecoverStalledTurn(input: {
  /** Text the assistant produced this turn. */
  text: string;
  /** Tool calls the assistant made this turn. Non-empty means it acted — never a stall. */
  toolCallCount: number;
  /** How many tools the turn was offered. Zero means it had nothing to call. */
  availableToolCount: number;
  /** Recoveries already spent in this run. */
  recoveriesUsed: number;
}): boolean {
  return (
    input.toolCallCount === 0
    && input.availableToolCount > 0
    && input.recoveriesUsed < MAX_ANNOUNCEMENT_RECOVERIES
    && announcesUntakenAction(input.text)
  );
}
