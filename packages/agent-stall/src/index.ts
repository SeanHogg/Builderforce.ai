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
 * Every advertised tool identifier appearing in `text`, de-duplicated, in order.
 *
 * Two callers, one pattern — which is the point of putting it here. The stall
 * detector below uses it to recognise a call written as prose; the per-turn tool
 * SELECTOR uses it to find the tools a system prompt instructs the model to call, so
 * a relevance filter can never drop a tool the prompt just promised. Those two must
 * agree on what a tool name looks like, or the loop recovers from a stall the
 * selector caused.
 */
export function toolNamesMentionedIn(text: string): string[] {
  return [...new Set(text.match(new RegExp(TOOL_IDENT, 'gi')) ?? [])];
}

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
 * The THIRD shape of the same stall, and the one that reads most like an answer: the
 * model neither promises nor writes a pseudo-call — it reports that the tool data is
 * MISSING. "The tools required are manager.digest, manager.decisions, manager.census
 * and manager.policy." · "The required tools have not returned results yet, so I have
 * no new data." It never called them; nothing was ever going to return.
 *
 * Measured on the manager's accountability chat (project 11, chat 86, 2026-07-28,
 * `xai-oauth/grok-4.3`): SEVEN model turns, ZERO tool calls, and three of the replies
 * were this shape. It scored as a complete answer because there is no first-person
 * commitment and no invocation syntax to match — so the loop shipped "I have no data"
 * to a person who had asked the manager to account for a dead board.
 *
 * Every alternative below requires the word "tool(s)" next to the missing-data claim.
 * That is the discriminator: an agent that genuinely cannot answer says "I do not have
 * the task status data" (a real answer, left alone), while an agent blaming absent TOOL
 * RESULTS on a turn where it called nothing is describing a call it never made.
 *
 * Scanned over the WHOLE reply, not just the tail — this claim is usually the opening
 * sentence, with the consequences ("so I cannot identify the gate") after it.
 */
/**
 * A tool named the way a CATALOG names it — `manager.digest`, `autonomy.wiring_audit`.
 * Not what the model was advertised (that is {@link TOOL_IDENT}), but exactly what a
 * model reciting a system prompt writes, so it is what shows up in these replies.
 *
 * The lookahead keeps FILE names out: "the build failed — missing package.json" is an
 * answer, not a stall, and a coding agent says it often.
 */
const FILE_EXTENSION = '(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|sql|toml|lock|txt|env|html|css|py|go|rs|sh|png|svg|csv|xml)\\b';
const DOTTED_TOOL_IDENT = `\\b[a-z][a-z0-9_]{2,}\\.(?!${FILE_EXTENSION})[a-z][a-z0-9_]{2,}\\b`;

const UNCALLED_TOOL_CLAIM = new RegExp(
  [
    // "The tools required are X, Y and Z." / "The required tools are …"
    '\\b(?:required tools?\\b|tools? required\\b|tools? (?:i |we )?(?:need|require)\\b)',
    // "…tools have not returned results" / "…the tool has not returned anything yet"
    "\\btools?\\b[^.!?]{0,80}?\\b(?:have|has|had|were|was)(?:n'?t| not)\\s+(?:yet\\s+)?(?:return|returned|provided|available|run|called)",
    // "no tool results", "no results from the tools", "no tool outputs for project 11"
    '\\bno\\s+(?:new\\s+)?tools?\\s+(?:results?|outputs?|data|returns?)\\b',
    '\\bno\\s+results?\\s+(?:from|for)\\s+(?:the\\s+)?tools?\\b',
    // "tool outputs never provided" / "the tool results were never returned"
    '\\btools?\\s+(?:results?|outputs?)\\b[^.!?]{0,40}?\\b(?:never|not)\\s+(?:been\\s+)?(?:provided|returned|available)',
    // "requires the tool outputs" / "awaiting the tool results"
    '\\b(?:requires?|awaiting|waiting on|pending)\\s+(?:those\\s+|the\\s+)?tools?\\s+(?:results?|outputs?)',
    // The same claim with the TOOL NAMED instead of the word "tool" — "no results from
    // manager.digest", "missing builtin_manager_policy results". The name IS the
    // discriminator here: prose does not carry tool identifiers by accident.
    `\\bno\\s+(?:new\\s+)?(?:results?|data|outputs?|returns?)\\s+(?:from|for|on)\\s+(?:the\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`,
    `\\b(?:missing|awaiting|pending|without)\\s+(?:the\\s+|those\\s+)?(?:results?\\s+(?:from|of|for)\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`,
  ].join('|'),
  'i',
);

/**
 * Does this reply blame MISSING TOOL DATA on a turn that called nothing?
 *
 * Exported alongside {@link announcesUntakenAction} because the two are different
 * failure shapes with the same remedy, and a caller reporting WHY it re-prompted
 * should be able to tell them apart.
 */
export function claimsMissingToolData(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return UNCALLED_TOOL_CLAIM.test(t);
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
    // Covers BOTH stall shapes: the promise ("I'll check…") and the missing-data claim
    // ("the required tools have not returned results"). The second wording matters —
    // a model told only "you said you would call a tool" when it never said any such
    // thing tends to repeat the same excuse rather than act.
    'Your last turn made zero tool calls. You either said you would call a tool and did not, or reported'
    + ' that tool results were missing — no results exist because you never made the call.'
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
 * either only promises or blames the absence of results it never asked for? The
 * budget-independent half, so the two gates below cannot drift on WHAT a stall is
 * while disagreeing only on what to do about it.
 */
function isStalledTurn(input: StalledTurnInput): boolean {
  return (
    input.toolCallCount === 0
    && input.availableToolCount > 0
    && (announcesUntakenAction(input.text) || claimsMissingToolData(input.text))
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
 * How many times ONE run may swap MODELS after a model burns its whole stall budget.
 * Small on purpose: each switch replays the turn, and a run that two different models
 * have already failed to act on is not going to be rescued by a third — at that point
 * the honest move is to stop and say so, not to walk the catalog on the tenant's money.
 */
export const MAX_MODEL_FAILOVERS = 2;

/**
 * The run switched models because the previous one would not emit tool calls. Shown
 * on the timeline, so the swap is visible rather than a silent change of who is
 * answering — a chat that quietly changes model is its own support ticket.
 */
export function modelFailoverNotice(from: string | null | undefined, to: string): string {
  const who = from && from !== 'default' ? `\`${from}\`` : 'The previous model';
  return (
    `${who} described tool calls instead of making them, ${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row,`
    + ` so it cannot complete this request. Retrying on \`${to}\`.`
  );
}

/**
 * The user-facing explanation for a run that never emitted a tool call and could not
 * be rescued by switching models either.
 *
 * Names every model tried, because "it didn't work" is unactionable while "these two
 * both refused to act" tells the reader whether to pick a third or to suspect their
 * tool catalog.
 *
 * @param model the model that actually answered last, when the loop resolved one.
 * @param tried every model attempted this run, when the loop failed over.
 */
export function stallExhaustedNotice(model?: string | null, tried?: readonly string[]): string {
  const who = model && model !== 'default' ? `The model \`${model}\`` : 'The model';
  const others = (tried ?? []).filter((m) => m && m !== model);
  return (
    `${who} described tool calls instead of making them, ${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row,`
    + ' so nothing was actually run and the answer above is only a description of intended actions.'
    + (others.length
      ? ` This run already failed over from ${others.map((m) => `\`${m}\``).join(', ')}, so the problem`
        + ' is unlikely to be any single model — check that the tool catalog loaded (see the'
        + ' "Tools available to the model" line in a copied diagnostics report).'
      : ' This is a model limitation, not a configuration error — pick a different model for this chat'
        + ' and send the message again.')
  );
}
