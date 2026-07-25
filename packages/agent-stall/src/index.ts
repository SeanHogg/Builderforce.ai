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

/**
 * A tool identifier exactly as the catalog advertises it — `builtin_chats_list_tickets`,
 * `mcp__server__tool`. Nothing in ordinary prose looks like this: a model types it only
 * when transcribing a call from definitions it was handed.
 */
const TOOL_IDENT = '(?:builtin_[a-z0-9]+(?:_[a-z0-9]+)+|mcp__[a-z0-9_]+)';

/**
 * A PSEUDO-CALL — the model writing the call ITSELF as plain text, with no
 * first-person subject for {@link ANNOUNCE_SUBJECT} to catch:
 * `run tool builtin_chats_list_tickets with chatId is 85`.
 *
 * This is the tail of the same degradation as the announcements above, and it was the
 * hole that made the whole recovery useless in practice. Measured on VS Code chat #85
 * (`xai-oauth/grok-4.3`): turns 1-2 promised in the first person ("I'll call the tool…")
 * and WERE recovered, then the model dropped the narration and emitted the bare call —
 * which scored as a COMPLETE ANSWER, ended the run, and showed the user
 * `call builtin_chats_list_tickets with chatId is 85` as the reply. That is the reported
 * "it doesn't execute, it just dies".
 *
 * Requires an invocation SHAPE, never a bare mention, so an answer that legitimately
 * names a tool ("the builtin_tasks_create tool creates a task", "builtin_x: creates …")
 * is left alone.
 */
const PSEUDO_CALL = [
  // "call builtin_x", "run tool builtin_x", "invoke the function mcp__srv__x"
  `(?:call|run|invoke|execute)\\s+(?:the\\s+)?(?:tool\\s+|function\\s+)?${TOOL_IDENT}`,
  // "builtin_x({…})" / "builtin_x(" — the call written as code
  `${TOOL_IDENT}\\s*[({]`,
  // "builtin_x with chatId is 85" — the call written as an argument clause
  `${TOOL_IDENT}\\s+(?:with|args|arguments)\\b`,
];

const ANNOUNCED_ACTION = new RegExp(
  [
    'calling (the|this|that|a|it|them|these) [\\w\\s-]*?(tool|function|api|now)',
    `${ANNOUNCE_SUBJECT}${ANNOUNCE_FILLER}\\s+${ANNOUNCE_VERB}\\b`,
    '(one|just a) (moment|second|sec)\\b',
    `${ANNOUNCE_GERUND} (it|that|this|these|those|the [\\w-]+|now|for)\\b`,
    'stand ?by\\b',
    ...PSEUDO_CALL,
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

/** The facts a loop knows about the turn it just finished. */
export interface StalledTurnInput {
  /** Text the assistant produced this turn. */
  text: string;
  /** Tool calls the assistant made this turn. Non-empty means it acted — never a stall. */
  toolCallCount: number;
  /** How many tools the turn was offered. Zero means it had nothing to call. */
  availableToolCount: number;
  /** Recoveries already spent in this run. */
  recoveriesUsed: number;
}

/**
 * Is this turn a stall at all — tools were offered, none were called, and the text
 * only promises? The budget-independent half, so the two gates below cannot drift on
 * WHAT a stall is while disagreeing only on what to do about it.
 */
function isStalledTurn(input: StalledTurnInput): boolean {
  return (
    input.toolCallCount === 0
    && input.availableToolCount > 0
    && announcesUntakenAction(input.text)
  );
}

/**
 * Should this turn be re-prompted instead of accepted as the final answer?
 *
 * Folds the whole gate — tools were actually offered, the budget is not spent, the
 * turn made no tool calls, and its text is an announcement — so no caller
 * re-implements the branching condition.
 */
export function shouldRecoverStalledTurn(input: StalledTurnInput): boolean {
  return isStalledTurn(input) && input.recoveriesUsed < MAX_ANNOUNCEMENT_RECOVERIES;
}

/**
 * The stall SURVIVED every recovery: same signals, no attempts left.
 *
 * This is the branch that decides whether a run dies loudly or quietly. Without it the
 * loop persists the final promise as the assistant's answer and returns normally, so
 * the user is shown `call builtin_chats_list_tickets with chatId is 85` as a reply and
 * has no idea the model never acted — the reported "it doesn't execute, it just dies".
 * Callers should still show the text (it is what the model said) and additionally
 * surface {@link stallExhaustedNotice}.
 */
export function isExhaustedStall(input: StalledTurnInput): boolean {
  return isStalledTurn(input) && input.recoveriesUsed >= MAX_ANNOUNCEMENT_RECOVERIES;
}

/**
 * The user-facing explanation for a run that never emitted a tool call. Names the
 * model, because the ONLY effective remedy is switching to one that emits structured
 * `tool_calls` — no amount of re-prompting fixes a model that will not.
 *
 * @param model the model that actually answered, when the loop resolved one.
 */
export function stallExhaustedNotice(model?: string | null): string {
  const who = model && model !== 'default' ? `The model \`${model}\`` : 'The model';
  return (
    `${who} described tool calls instead of making them, ${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row,`
    + ' so nothing was actually run and the answer above is only a description of intended actions.'
    + ' This is a model limitation, not a configuration error — pick a different model for this chat'
    + ' and send the message again.'
  );
}
