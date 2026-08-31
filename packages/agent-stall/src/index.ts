/**
 * Untaken tool call — detection + recovery, shared by every agent loop.
 *
 * Recovery has two halves and BOTH live in this file: the re-prompt budget with its
 * user-facing notices, and the MODEL FAILOVER section at the bottom. They were split
 * across two packages once — the selector lived in a React package — and the server
 * reply loop, unable to import it, hand-rolled its own and shipped a failover branch
 * that could not run. See {@link chooseStallFailover}.
 *
 * The failure it fixes: a turn ends with `stopReason: stop` and ZERO tool calls while
 * tools were available, and a loop that treats "no tool calls" as "done" hands the user
 * words instead of a result. It wears four faces, all of them observed in production and
 * all of them a model-behaviour class rather than a vendor bug:
 *
 *   1. the PROMISE — `"I'll search the codebase for the handler."`
 *   2. the PSEUDO-CALL — `"run tool builtin_chats_list_tickets with chatId is 85"`
 *   3. the MISSING-DATA CLAIM — `"The required tools have not returned results yet."`
 *   4. the BLANK TURN — nothing at all: no call, no words.
 *
 * The third is the one that reads like an answer, and it is why the manager's
 * accountability chat shipped "I have no data" to a person asking it to account for a
 * dead board (project 11 / chat 86, 2026-07-28: 7 turns, 102 tools, 0 calls). The
 * fourth is the one that reads like a blip, and it is why the same chat answered a
 * 400 saying "this usually clears on a retry" four days running (2026-07-31).
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
  "\\b(?:i(?: will|'ll| am going to|'m going to| am about to| plan to|'d need to| would need to| will need to| need to)|let(?:'?s| me| us)|going to|about to|next,? i'?l?l?|now)";

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
 *
 * `i(?:'d| would| will)? need to` is here rather than in ANNOUNCE_SUBJECT's contraction
 * list because it is the CONDITIONAL form of the same stall — "I would need to call the
 * digest first" is a promise with the commitment filed off, and a run that ends on it has
 * exactly as little data as one that ends on "I'll call the digest". It still requires an
 * ANNOUNCE_VERB, so "I need to know your budget" (verb excluded) stays out.
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

/**
 * Every CATALOG-style tool id in `text` (`manager.digest`), de-duplicated, in order —
 * the counterpart to {@link toolNamesMentionedIn}, which finds the ADVERTISED form.
 *
 * The pair is a DIAGNOSIS, not a curiosity, and it is the distinction a shipped report
 * got wrong. A stalled reply naming `manager.digest` was told to call a string the model
 * never had (the prompt / persisted-persona name mismatch, fixed by migration 0379). A
 * stalled reply naming `builtin_manager_digest` was told correctly and could not comply —
 * the tool list is fine and the MODEL is the problem. Identical transcripts, opposite
 * fixes; a report that asserts the first while the evidence says the second sends the
 * reader to re-audit prompts and migrations that were already right.
 */
export function catalogToolNamesMentionedIn(text: string): string[] {
  return [...new Set(text.match(new RegExp(DOTTED_TOOL_IDENT, 'gi')) ?? [])];
}

const UNCALLED_TOOL_CLAIM = new RegExp(
  [
    // "The tools required are X, Y and Z." / "The required tools are …"
    '\\b(?:required tools?\\b|tools? required\\b|tools? (?:i |we )?(?:need|require)\\b)',
    // "…tools have not returned results" / "…the tool has not returned anything yet"
    "\\btools?\\b[^.!?]{0,80}?\\b(?:have|has|had|were|was)(?:n'?t| not)\\s+(?:yet\\s+)?(?:return|returned|provided|available|run|called)",
    // "no tool results", "no results from the tools", "no tool outputs for project 11"
    '\\bno\\s+(?:new\\s+)?tools?\\s+(?:results?|outputs?|data|returns?)\\b',
    // "No other tools provide the needed data." — the same claim aimed at the CATALOG
    // rather than at the results: an inventory of what it would need, from a turn that
    // called none of it. Observed as the closing sentence of the measured replies.
    '\\bno\\s+other\\s+tools?\\b[^.!?]{0,40}?\\b(?:provide|provides|give|gives|return|returns|have|has|offer|offers)\\b',
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
    'Your last turn made zero tool calls. You either said you would call a tool and did not, reported'
    + ' that tool results were missing — no results exist because you never made the call — or returned'
    + ' nothing at all.'
    + ' Make the call NOW in this turn, then answer using its result. If no tool can give you that data,'
    + ' say plainly which data you are missing and answer with what you already have.'
    + ' Do not announce another call, and do not reply with an empty message.'
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
 * The FOURTH shape, and the emptiest: the model produced no tool call AND no words.
 *
 * It reads like a transient blip and is treated as one — every loop here breaks out and
 * either shows "No response." or asks the same model for one more, tool-free, synthesis.
 * But a turn offered tools, asked a question, and answering with silence is not a
 * finished answer under any reading; it is the same "would not act" failure with the
 * narration stripped off, and the same remedy (re-prompt, then a different model) works
 * on it. Measured on the manager's accountability chat, 2026-07-31: the connected account
 * errored, the run landed on another model, that model returned an empty turn, the
 * tool-free synthesis re-asked THE SAME model and got another one — and the operator got
 * a 400 reading "produced no reply … this usually clears on a retry" for the fourth time
 * in four days. Nothing had retried anything.
 *
 * Requires `availableToolCount > 0` like the others: a turn with nothing to call is a
 * plain completion, and an empty one there is the caller's problem, not a stall.
 */
export function isEmptyTurn(input: StalledTurnInput): boolean {
  return input.toolCallCount === 0 && input.availableToolCount > 0 && input.text.trim() === '';
}

/**
 * Is this turn a stall at all — tools were offered, none were called, and the model
 * either only promised, blamed the absence of results it never asked for, or said
 * nothing whatsoever? The budget-independent half, so the two gates below cannot drift
 * on WHAT a stall is while disagreeing only on what to do about it.
 */
function isStalledTurn(input: StalledTurnInput): boolean {
  return (
    input.toolCallCount === 0
    && input.availableToolCount > 0
    && (
      announcesUntakenAction(input.text)
      || claimsMissingToolData(input.text)
      || isEmptyTurn(input)
    )
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
 * WHAT the spent model actually did, in the notices' words.
 *
 * Split out because the notices below assert it and there are now two answers. Telling an
 * operator a model "described tool calls instead of making them" when it in fact returned
 * a blank turn sends them looking for narration that is not in the transcript — the same
 * class of misdirection as a report naming the wrong cause. One phrase, both notices.
 */
function whatItDid(emptyTurn: boolean): string {
  return emptyTurn
    ? `returned an empty turn — no tool call and no words — ${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row`
    : `described tool calls instead of making them, ${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row`;
}

/**
 * The run switched models because the previous one would not emit tool calls. Shown
 * on the timeline, so the swap is visible rather than a silent change of who is
 * answering — a chat that quietly changes model is its own support ticket.
 *
 * @param emptyTurn the spent model returned nothing at all rather than narrating.
 */
export function modelFailoverNotice(from: string | null | undefined, to: string, emptyTurn = false): string {
  const who = from && from !== 'default' ? `\`${from}\`` : 'The previous model';
  return `${who} ${whatItDid(emptyTurn)}, so it cannot complete this request. Retrying on \`${to}\`.`;
}

/**
 * The user-facing explanation for a run that never emitted a tool call and could not
 * be rescued by switching models either.
 *
 * Names every model tried, because "it didn't work" is unactionable while "these two
 * both refused to act" tells the reader whether to pick a third or to suspect their
 * tool catalog.
 *
 * What it must NOT do is name a cause it has not established. This notice used to end
 * "This is a model limitation, not a configuration error — pick a different model", and
 * that sentence was wrong in the one case it most needed to be right: a self-hosted
 * runtime rejecting every request (a prompt over its KV budget, say) yields the same
 * empty turns as a model that will not call tools, and the reader was told to go change
 * a setting that was never the problem while the actual reason sat in their server log.
 * From here the two are genuinely indistinguishable, so the notice now says so and points
 * at the evidence that separates them.
 *
 * @param model the model that actually answered last, when the loop resolved one.
 * @param tried every model attempted this run, when the loop failed over.
 * @param emptyTurn the run ended on blank turns rather than on narration.
 */
export function stallExhaustedNotice(model?: string | null, tried?: readonly string[], emptyTurn = false): string {
  const who = model && model !== 'default' ? `The model \`${model}\`` : 'The model';
  const others = (tried ?? []).filter((m) => m && m !== model);
  return (
    `${who} ${whatItDid(emptyTurn)}, so nothing was actually run and `
    + (emptyTurn ? 'there is no answer above to show you.' : 'the answer above is only a description of intended actions.')
    + (others.length
      ? ` This run already failed over from ${others.map((m) => `\`${m}\``).join(', ')}, so the problem`
        + ' is unlikely to be any single model — check that the tool catalog loaded (see the'
        + ' "Tools available to the model" line in a copied diagnostics report).'
      : ' Before switching models, check your runtime or gateway log for this turn: a request'
        + ' REJECTED upstream — a prompt over the context limit, an exhausted quota — produces'
        + ' exactly these symptoms, and no other model will fix it. If the log is clean, this is'
        + ' a model limitation and a different model is the answer.')
  );
}

// ---------------------------------------------------------------------------
// MODEL FAILOVER — which model takes over once the recovery budget above is spent.
//
// In this module rather than its own file because the package is consumed as SOURCE by a
// Node16-resolution build (agent-runtime) as well as by three bundlers, and its export map
// is a single entry; a relative import here would have to carry a `.js` extension that the
// four resolvers disagree about. It began life in `brain-embedded`, a React package, which
// put it out of reach of the SERVER reply loop — see `chooseStallFailover` for what that
// loop hand-rolled instead.
// ---------------------------------------------------------------------------

/**
 * The gateway model surface, as `/llm/v1/models` returns it and both browser hosts
 * cache it. Structurally a superset of what `classifyModelFunding` takes, so one
 * cached object feeds both. A SERVER caller composes the same shape from the pool
 * constants it already has (see `BrainService.agentReply`).
 */
export interface ModelFallbackSurface {
  /** The plan pool — every model this tenant may select. */
  data?: Array<{ id?: string }>;
  /** The curated tool-calling / coding subset of the pool. */
  codingModels?: string[];
  /** Models reachable through the tenant's OWN connected accounts (BYO). */
  byo?: { models?: Array<{ id?: string; vendor?: string }> };
}

/** Non-empty ids from a list of `{ id }` records, in surface order. */
function ids(list: Array<{ id?: string }> | undefined): string[] {
  return (list ?? []).map((m) => m.id).filter((id): id is string => !!id);
}

/**
 * The next model to try, or undefined when nothing untried is left.
 *
 * Preference order, and why:
 *  1. **BYO ∩ coding pool** — the tenant's own connected account (so the retry costs
 *     nothing against the plan allowance) AND curated for tool calling, which is the
 *     capability that just failed. Best on both axes.
 *  2. **Coding pool** — curated for tool calling, plan-funded. We are failing over
 *     *because of* tool calling, so this outranks an arbitrary BYO model.
 *  3. **Anything else untried** — BYO first, then the rest of the plan pool.
 *
 * A caller driving an AGENTIC turn should leave `data` unset: tier 4 is the general
 * plan pool, and falling a tool-loop onto a non-coder produces a run that flails and
 * ships nothing (the same reasoning as the gateway's coding-only backstop chain).
 *
 * `tried` holds every model already attempted this run, including the original pin.
 * A caller that pinned nothing (gateway auto-select) should pass its resolved model,
 * so the failover cannot hand back the model that just failed.
 */
export function nextFallbackModel(
  surface: ModelFallbackSurface | null | undefined,
  tried: readonly string[],
): string | undefined {
  if (!surface) return undefined;
  const used = new Set(tried.filter(Boolean));
  const byo = ids(surface.byo?.models);
  const byoSet = new Set(byo);
  const coding = (surface.codingModels ?? []).filter(Boolean);
  const pool = ids(surface.data);

  const tiers = [
    coding.filter((m) => byoSet.has(m)),
    coding,
    byo,
    pool,
  ];
  for (const tier of tiers) {
    const hit = tier.find((m) => !used.has(m));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * How many times ONE run may swap MODELS after a model burns its whole stall budget.
 * Small on purpose: each switch replays the turn, and a run that two different models
 * have already failed to act on is not going to be rescued by a third — at that point
 * the honest move is to stop and say so, not to walk the catalog on the tenant's money.
 *
 * Lives beside the selector it bounds (and is re-exported from `./index`), so a caller
 * cannot reach the budget without also reaching the picker that spends it — which is how
 * one loop ended up enforcing the budget over a failover that never happened.
 */
export const MAX_MODEL_FAILOVERS = 2;

/** What a loop knows when a model has just burned its whole stall budget. */
export interface StallFailoverInput {
  /** The model the loop ASKED for this turn — undefined on a gateway auto-select turn. */
  activeModel?: string | null;
  /** The model that actually ANSWERED, as the gateway resolved it. */
  resolvedModel?: string | null;
  /** Models already burned this run. MUTATED: the two above are appended. */
  tried: string[];
  /** Failovers already spent this run. */
  failoversUsed: number;
  /**
   * Where a replacement comes from. A caller that HOLDS the model surface passes
   * `surface`; a caller whose host owns the choice (the browser run loop, which is
   * handed a `pickFallbackModel` by whichever app mounted it) passes `pick`. `pick`
   * wins when both are present. Neither ⇒ no failover, which is the correct answer for
   * a host that never wired one up.
   */
  surface?: ModelFallbackSurface | null;
  pick?: ((tried: readonly string[]) => string | undefined) | undefined;
}

/**
 * The whole "this model is spent — who takes over?" decision, in one place.
 *
 * Three steps that must happen together, and did not:
 *
 *  1. **Record both ids.** An unpinned turn asked for nothing, so `activeModel` is
 *     undefined and `resolvedModel` is the ONLY id naming the model to skip. Recording
 *     just one leaves the failover free to hand back the model that just failed.
 *  2. **Check the budget.** {@link MAX_MODEL_FAILOVERS}: a run two models have already
 *     failed is not rescued by a third, and walking the catalog costs the tenant money.
 *  3. **Pick a genuinely different model** — never "unpin and hope the cascade differs".
 *
 * Both the browser run loop and the server addressed-reply loop had hand-written copies
 * of this. The server's got step 3 wrong (`if (budget && activeModel) { activeModel =
 * undefined }`), which reads as a failover and is unreachable on the unpinned default
 * path — the ONE path a tenant with a connected account takes. The observable result was
 * a chat that burned 11 turns on a single model, never failed over, and closed by telling
 * the user to go pick a different model by hand.
 *
 * Returns the model to switch to, or `undefined` when the run should stop and say so.
 */
export function chooseStallFailover(input: StallFailoverInput): string | undefined {
  for (const m of [input.activeModel, input.resolvedModel]) {
    if (m && m !== 'default' && !input.tried.includes(m)) input.tried.push(m);
  }
  if (input.failoversUsed >= MAX_MODEL_FAILOVERS) return undefined;
  const next = input.pick
    ? input.pick(input.tried)
    : nextFallbackModel(input.surface, input.tried);
  // A `pick` supplied by a host is outside this package's control, so the promise the
  // caller relies on — "never the model that just failed" — is enforced here rather
  // than assumed of every implementation.
  return next && !input.tried.includes(next) ? next : undefined;
}
