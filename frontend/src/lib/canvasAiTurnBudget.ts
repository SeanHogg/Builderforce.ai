/**
 * What ONE Canvas turn is allowed to spend, and what it says to a model that has
 * spent it badly.
 *
 * Every number and directive here answers the same question — how far does a turn
 * go before it stops — and each carries the measurement that set it. They lived in
 * `creationCanvasAi.ts` beside the loop that reads them, which meant retuning a
 * budget and rewriting the runner were edits to the same file. They are separate
 * reasons to change: a ceiling moves when a provider or a workload changes, the
 * runner moves when the loop's shape does. The suite asserts against these names,
 * so a budget is verified where it is declared rather than through the runner.
 */

/**
 * Model round-trips one composer submit may take before the loop gives up.
 *
 * This was 3, which is enough to author an object and answer, and NOT enough to
 * research anything: the pipeline the canvas system prompt prescribes is search →
 * fetch a source → fetch another → create the Dataset → geocode it → materialize
 * the visual, so a research turn ran out of rounds mid-pipeline and returned a
 * half-built board. These extra rounds are tool continuations of ONE user turn —
 * the guest allowance charges per turn (idempotent on `guestTurnId`), so a deeper
 * loop costs the visitor nothing from their message budget.
 */
export const MAX_CANVAS_TOOL_TURNS = 8;

/** Keep enough of a bounded turn to author the requested Canvas artifacts after
 * research. Without this reservation, a model can spend all eight continuations
 * retrying a narrow search backend and never reach canvas_add_object. */
export const RESERVED_AUTHORING_TURNS = 2;

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
 */
export const CANVAS_BUILD_RESPONSE_TOKENS = 8_192;

/**
 * The step budget once a turn is writing code. One file is one step, and the seeded
 * starter project needs list → read → several writes before it is the user's app, so
 * the eight steps sized for research-then-author ran out with the app half-written and
 * the runner reporting that nothing had happened. Sixteen is enough for a small app
 * with room for a diagnostics read; a bigger one continues on the next turn, and the
 * `stepsExhausted` notice tells the user exactly that.
 */
export const MAX_CANVAS_BUILD_TURNS = 16;

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

/** The tool result a call that arrived with unusable arguments gets INSTEAD of being run. */
export const TRUNCATED_CALL_RESULT = 'This tool call was cut off by the output limit before its arguments were complete, so it was NOT executed. Re-issue it in your next response as ONE call with complete JSON — one file or one object per response, never several.';
export const MALFORMED_CALL_RESULT = 'This tool call\'s arguments were not valid JSON, so it was NOT executed. Re-issue it with strictly valid JSON: no comments, no trailing commas, no unescaped newlines or quotes inside string values.';

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

/** Silent round-trips tolerated on one model before the turn routes around it. Two:
 *  a stall is usually a single bad connection, and a model that swallows two requests
 *  in a row will swallow the third too. */
export const MAX_STALLED_STREAMS = 2;

/** Truncation is an OUTPUT-SIZE failure, so the recovery is to author smaller —
 * the opposite of "answer again", which would truncate identically. The canvas
 * itself is the durable place for length, so splitting across calls costs nothing. */
export const TRUNCATED_TURN_DIRECTIVE = 'Your previous response was cut off at the output limit before it finished, so nothing you sent could be used. Produce less in one step: make ONE canvas_* tool call at a time with the fields that matter, keep prose short, and split a long artifact across several calls or several objects rather than sending it all at once.';

/** The model DID choose to act; the arguments were unparseable. Telling it to
 * "answer" here would discard a correct intent, so the directive keeps the action
 * and constrains only the encoding. */
export const MALFORMED_TOOL_CALL_DIRECTIVE = 'Your previous tool call could not be parsed and was discarded. Make the same call again with strictly valid JSON arguments: no comments, no trailing commas, no unescaped newlines or quotes inside string values, and no placeholder text. Send one tool call.';
