/**
 * What ONE Canvas turn is allowed to spend, and what it says to a model that has
 * spent it badly.
 *
 * Every number and directive here answers the same question — how far does a turn
 * go before it stops — and each carries the measurement that set it. The step
 * ceiling used to live here too. It does not: a canvas turn passes `budget: {}`,
 * and the kernel's failure streak is the only stop that is not the model finishing
 * or the user cancelling. The remaining numbers lived in
 * `creationCanvasAi.ts` beside the loop that reads them, which meant retuning a
 * budget and rewriting the runner were edits to the same file. They are separate
 * reasons to change: a ceiling moves when a provider or a workload changes, the
 * runner moves when the loop's shape does. The suite asserts against these names,
 * so a budget is verified where it is declared rather than through the runner.
 */

import { effortProfile, type Effort } from '@seanhogg/builderforce-brain-embedded';

/** Two encyclopedic results are enough evidence that repeating differently worded
 * searches will not produce the open-web design sources the user requested. */
export const MAX_NARROW_SEARCHES = 2;

/** Comparison documents and implementation guidance routinely need more than the
 * former 1,600-token ceiling. The durable result still belongs in Canvas objects;
 * this prevents the user-facing handoff from ending in the middle of a sentence. */
export const CANVAS_RESPONSE_TOKENS = 3_200;

/**
 * The output ceiling once a turn is WRITING CODE. 3,200 tokens was sized for the prose
 * handoff and for authoring one card; a source file routinely runs 1,500 tokens and a
 * model asked to build an app sends two or three per response. Measured (session
 * `bf886fc1`, ui 2026.9.13): three of eight completions ended `finishReason: "length"`,
 * each mid-way through a `canvas_write_build_file` whose JSON never closed. A ceiling is
 * a cap, not a spend — the model is billed for what it emits — so raising it only for
 * turns that have already committed to a workspace costs nothing on ordinary turns.
 * Raised, not unbounded: 8K sits under every vendor's own limit in the coding pool.
 *
 * Also the ceiling for the rest of ANY turn once a response is cut off at 3,200. One
 * object can be bigger than that on its own — measured (session `bf886fc1`, ui 2026.9.30):
 * "combine the competitor research into one document" re-sent the same consolidated
 * `canvas_add_object` five times, each cut off at the same place, and delivered nothing.
 */
export const CANVAS_BUILD_RESPONSE_TOKENS = 8_192;

/** The composer's Effort and Thinking, as one canvas turn reads them (the `/` Work panel). */
export interface CanvasRunShaping {
  effort: Effort;
  thinking: boolean;
}

/**
 * What one canvas round-trip asks for, given the composer's run shaping.
 *
 * The ceiling is the canvas's own (`base`: the prose or the build ceiling above), RAISED
 * to the Effort level's when that is higher and never lowered by it — every canvas turn
 * can call tools, and Quick's 2,048 would cut a tool call's JSON off mid-file (the same
 * reason `TOOL_TURN_MIN_MAX_TOKENS` exists). Thinking sends the level's vendor-neutral
 * `reasoning` intent, and nothing at all when off.
 *
 * No shaping ⇒ the canvas's long-standing request (`base`, `reasoning: low`), which is
 * also what the composer's defaults (Quick + Thinking) produce.
 */
export function canvasTurnShape(base: number, shaping: CanvasRunShaping | undefined): { maxTokens: number; reasoning?: { level: 'low' | 'medium' | 'high' } } {
  if (!shaping) return { maxTokens: base, reasoning: { level: 'low' } };
  const profile = effortProfile(shaping.effort);
  return {
    maxTokens: Math.max(base, profile.maxTokens),
    ...(shaping.thinking ? { reasoning: { level: profile.reasoningLevel } } : {}),
  };
}

/**
 * How many tools one canvas completion advertises.
 *
 * A signed-in board carried 541 definitions (116 canvas tools plus the tenant's whole
 * MCP catalog) on every request — roughly 120K tokens of schema before the board or the
 * conversation was counted. No free coder's window holds that, so a FREE-plan turn
 * skipped its entire pool and landed on the funded direct-Anthropic floor on the first
 * completion, then soft-pinned it for the rest of the turn (measured: 16 of 16
 * completions on `claude-sonnet-5`, account "shared"). The standalone Brain has trimmed
 * per turn since its catalog passed ~300 (`brain-embedded/selectTools`); the canvas now
 * uses the SAME selector. Tools the system prompt NAMES are always advertised, tools
 * this turn already CALLED are never dropped, and the rest are chosen by relevance to
 * the request. 96: the canvas prompt names ~50 tools itself, and this stays under the
 * ~128 mark where providers degrade.
 */
export const CANVAS_TOOL_LIMIT = 96;

/**
 * The most context one canvas turn carries before the agent compacts its transcript.
 *
 * A canvas turn has no cost cap — the free pool and a connected account bill the user
 * nothing per token here — so this is not a spend limit; it is the ceiling under which a
 * turn's system blocks, board snapshot, conversation and tool results still fit the
 * smallest window in the gateway's coding pool. The agent's compaction otherwise defaults
 * to the cloud loop's 40K cost cap, which the canvas prompt and a modest board exceed
 * before the first model call.
 */
export const CANVAS_CONTEXT_TOKENS = 128_000;

/**
 * The tool result a call that arrived with unusable arguments gets INSTEAD of
 * being run. The wording, and the truncated-vs-malformed decision, belong to the
 * kernel that sets the flag (`@builderforce/agent-loop`), so this loop and the
 * Brain loop cannot drift — they did, and only this one declined to run the call.
 * What stays here is the CANVAS's own retry advice, true of no other surface:
 * `canvas_update_object` is how a long object gets the rest of itself.
 */
export const CANVAS_TRUNCATED_RETRY_HINT = 'Write one file or one object per response, never several; if that one object is itself long, create it with its essential fields first and add the rest with canvas_update_object.';

/** Pushed once after a round whose LAST call was cut off while the complete ones ran —
 * the whole-response directive below would be false here (most of the response was
 * used), and the remedy is narrower: smaller responses, not a different action. */
export const TRUNCATED_ROUND_DIRECTIVE = 'Your previous response hit the output limit. The complete tool calls in it were executed; the call it was cut off inside was discarded and must be re-sent. From here on send ONE file or ONE object per response.';

/** Act-now escalations before the turn stops asking a stalled model to author. */
export const MAX_MUTATION_RECOVERIES = 2;

/** An INTERRUPTED turn — truncated by the output ceiling, or a tool call the
 * provider could not parse — is retried with the instruction that matches the
 * interruption. Two per turn: enough to clear a one-off, few enough that a model
 * which cannot author inside the ceiling fails over instead of looping. */
export const MAX_INTERRUPTED_TURN_RECOVERIES = 2;

/**
 * The canvas's budget for THE stream client's silence rule (`idleTimeoutMs`): no
 * response headers, or no bytes, for this long ends the round-trip as an interruption
 * the run policy routes around. Shorter than the client's default because the canvas is
 * an interactive surface on free models — a stream that has produced NOTHING for over a
 * minute is not slow, it is gone (measured 2026-08-15: 134 s to return an empty
 * completion behind a four-minute spinner). Every byte re-arms it, tool-call arguments
 * included, so a long authoring response is never cut.
 */
export const CANVAS_STREAM_IDLE_MS = 75_000;

/** A turn that provisioned a workspace (`canvas_create_build`) and then tried to end
 * without writing a file. The model reads the seeded template as the deliverable, so the
 * directive says what the template IS — a placeholder the user can see in the preview —
 * and names the calls that turn it into the app. */
export const BUILD_NOT_AUTHORED_DIRECTIVE = 'You provisioned the workspace but have not written any of the app yet: it still holds only the starter template, and the live preview shows its placeholder page, not what the user asked for. Building the app IS the request. Call canvas_list_build_files, then canvas_read_build_file and canvas_edit_build_file on the starter files (canvas_write_build_file only for genuinely new files) until the app the user described is implemented. Do not reply in prose until those files are written, and do not call canvas_create_build again.';

/** Truncation is an OUTPUT-SIZE failure, so the recovery is to author smaller —
 * the opposite of "answer again", which would truncate identically. The canvas
 * itself is the durable place for length, so splitting across calls costs nothing. */
export const TRUNCATED_TURN_DIRECTIVE = 'Your previous response was cut off at the output limit before it finished, so nothing you sent could be used. Produce less in one step: send ONE file or ONE object per response with the fields that matter (reads are small — keep batching those), keep prose short, and split a long artifact across several calls or several objects rather than sending it all at once.';

/** The model DID choose to act; the arguments were unparseable. Telling it to
 * "answer" here would discard a correct intent, so the directive keeps the action
 * and constrains only the encoding. */
export const MALFORMED_TOOL_CALL_DIRECTIVE = 'Your previous tool call could not be parsed and was discarded. Make the same call again with strictly valid JSON arguments: no comments, no trailing commas, no unescaped newlines or quotes inside string values, and no placeholder text. Send one tool call.';

/**
 * What a canvas turn says to a model that spent a rung of the delivery ladder badly.
 * The MECHANICS — how many times, in what order, when a proven model takes over — are
 * `@builderforce/agent-run`'s (`policy/stall/ladder.ts`); the WORDS are the canvas's, and
 * `canvasDelivery.ts` hands them over as rungs.
 */

/** Said once, with the first act-now re-statement: the research phase is over, and the
 * tools that served it are withdrawn from the menu. */
export const AUTHORING_PHASE_DIRECTIVE = 'The research phase is over. Use the remaining turns only to create or update the requested Canvas artifacts with canvas_* tools. Build from what you already have — you have the board snapshot and do not need to read it again — state any evidence gap inside the artifact, and do not make another search or fetch call.';

/** A degenerate turn — nothing at all, or an earlier reply reproduced. */
export const DEGENERATE_ANSWER_DIRECTIVE = 'Your prior response was empty or repeated an earlier message in this conversation, so it did not answer anything. Do not restate a previous reply, and do not prefix your answer with a speaker name. Answer the user\'s latest message directly now, and call the canvas_* tools for any change it asks for.';

/** The first act-now re-statement for a model that discussed an imperative canvas request. */
export const MUTATION_ACT_NOW_DIRECTIVE = 'Your prior response described or discussed an imperative Canvas request without executing it. Act now with the available canvas_add_object or canvas_update_object tool. If a non-Chat object is selected, update that exact object unless the user explicitly requested another one. For a Website/WYSIWYG change, send the complete authored fields.pages structure and websiteTheme; do not ask another optional question and do not rely on renderer defaults.';

/**
 * The second re-statement runs with research and board re-reads already withdrawn, so
 * repeating "act now" adds nothing. What the first directive never supplies is the reason
 * a model stalls here: it has written the answer in prose and has no idea the prose is
 * not the artifact. Say that, and name the one call left to it.
 */
export const MUTATION_PROSE_IS_NOT_ARTIFACT_DIRECTIVE = 'You have now answered twice in prose without creating anything. Prose in a reply is NOT a canvas artifact and the user cannot keep, edit or export it — only a canvas_add_object call puts it on their board. Make that call now, passing the full text you just wrote as the new object\'s authored content, and write nothing else in this response.';

/** Hand-off wording when the model that would not act is replaced by one that did. */
export const MUTATION_HANDOFF_DIRECTIVE = 'The prior model did not execute the Canvas command after a retry and has been disabled for this session. Stop researching and use canvas_add_object or canvas_update_object now to complete the user\'s requested artifact.';

/** A C-suite teammate request answered without adding the Agent or its deliverable. */
export const EXECUTIVE_ACT_NOW_DIRECTIVE = 'Your prior response did not execute the requested teammate action. Act now: add the named executive Agent, add the fully authored requested deliverable, and connect them with the available Canvas tools. A new canvas is sufficient context; put assumptions and open questions in the deliverable instead of asking a follow-up question.';

/** Hand-off wording for a model that ran past the output limit without finishing. */
export const TRUNCATED_HANDOFF_DIRECTIVE = 'The prior model kept running past the output limit without finishing and has been disabled for this session. Author the requested artifact in small steps.';

/** Hand-off wording for a model whose tool calls the provider could not parse. */
export const MALFORMED_HANDOFF_DIRECTIVE = 'The prior model kept emitting tool calls the provider could not parse and has been disabled for this session.';

/** Hand-off wording for a model that returned an empty or repeated response twice. */
export const DEGENERATE_HANDOFF_DIRECTIVE = 'The prior model returned an empty or repeated response twice and has been disabled for this session.';

/** Hand-off wording for a model that provisioned a workspace and never wrote the app. */
export const BUILD_HANDOFF_DIRECTIVE = `The prior model provisioned the workspace and stopped without writing the app. ${BUILD_NOT_AUTHORED_DIRECTIVE}`;

/** Hand-off wording when the provider broke under a model that had been acting. */
export const PROVIDER_HANDOFF_DIRECTIVE = 'The prior model failed mid-request and has been disabled for this session.';

/** Said when a broken provider's turn is re-asked of the gateway's pool. */
export const PROVIDER_REROUTE_DIRECTIVE = 'The prior model failed mid-request, so this turn now continues on a different model. Continue the user\'s request from where it left off, building on the work already done.';
