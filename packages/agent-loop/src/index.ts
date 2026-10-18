export { runAgentLoop } from "./loop.js";
export { DEFAULT_TOOL_FAILURE_STREAK } from "./types.js";
export { MAX_SUBAGENT_DEPTH, subagentSystemPrompt, type SubagentLiveOwner, type SubagentPersona } from "./subagent.js";
export { asToolArgs, parseToolArgs, parseToolCall } from "./parseToolCall.js";
// The other half of the kernel's bad-JSON policy: `parseToolCall` sets the flag,
// this decides what to do with it. Exported together so a consumer cannot take
// the parse without the handling (which is how the Brain loop ran `{}` calls).
export { malformedCallOutcome, malformedCallLabel, MALFORMED_CALL_RESULT, TRUNCATED_CALL_RESULT } from "./malformedCall.js";
// A model stuck repeating one block of prose. The kernel trims looped turns itself; the
// Brain's stream client cuts a live stream with it; the api trims its tool-free replies.
export { detectRepetitionLoop, trimRepetitionLoop } from "./repetitionLoop.js";
// Agent mid-turn narration ("Let me check…") — stripped before a raw run text trains an
// Evermind head, and flagged by the Evermind console on what it already learned.
export { looksLikeRunNarration, stripRunNarration, NARRATION_MIN_CHARS } from "./runNarration.js";
export type { StrippedNarration } from "./runNarration.js";
// The structural half: a persisted mid-turn block is MARKED, and the learn gate skips it.
export { isMidTurnMetadata, MID_TURN_META_KEY } from "./turnPhase.js";
export { stepRow, STEP_RESULT_CAP, type StepRowInput } from "./stepRow.js";
export { subagentReportMessage, type SubagentReportLike } from "./subagentReport.js";
// A chat's linked-ticket progress — the ONE rollup the api, the ticket rail and the
// Sessions tree share. Consumers import it from here directly; no published package
// re-exports it, so the declaration-rollup one-hop rule does not apply.
export {
  rollupChatTicketHealth,
  isExcludedFromChatHealth,
  displayChatProgressPct,
  chatProgressIsStale,
  UNSUPPORTED_DELIVERY_PROGRESS_CAP,
  type ChatTicketHealth,
  type ChatTicketHealthInput,
} from "./chatTicketHealth.js";
// Open vs closed tickets (done, cancelled, archived) — ONE rule for the api's progress
// and list scope and the VSIX Tasks / Closed sections. Imported directly, like the above.
export {
  TASK_CLOSED_STATUSES,
  TASK_LIST_SCOPES,
  isClosedTaskStatus,
  isCancelledTaskStatus,
  isClosedTask,
  parseTaskListScope,
  taskInScope,
  scopeNeedsArchived,
  type TaskClosedFacts,
  type TaskListScope,
} from "./taskClosedState.js";
// The reasoning channel — one reading of what a turn SAID versus what it THOUGHT, and
// the policies each surface applies to it. Written four times before this, disagreeing
// on whether an unclosed block counts and whether a tag inside a code fence does; see
// `reasoning.ts`. Consumers import it from this package DIRECTLY rather than through a
// published re-export, so no declaration rollup has to inline it.
export {
  answerTextOf,
  canonicalReasoningText,
  replayTextOf,
  splitReasoningSegments,
  splitVendorReasoning,
  stripReasoningScratchpad,
  stripReasoningTagsFromText,
  thoughtTextOf,
} from "./reasoning.js";
export type {
  ChoiceMessageLike,
  ReasoningSegment,
  ReasoningSplit,
  ReasoningTagMode,
  ReasoningTagTrim,
} from "./reasoning.js";
export { defaultToolRowSerializer, openAiChatCodec, readOpenAiToolCalls, toOpenAiToolCall } from "./openaiCodec.js";
export type { OpenAiAssistantRow, OpenAiToolCallRow, OpenAiToolRow, ToolRowSerializer } from "./openaiCodec.js";
export type {
  AfterDispatchDecision,
  DispatchDecision,
  LoopBudget,
  LoopCodec,
  LoopControl,
  LoopDispatchResult,
  LoopHooks,
  LoopPorts,
  LoopResult,
  LoopRunArgs,
  LoopToolCall,
  LoopTurn,
  LoopTurnResult,
  NoToolCallsDecision,
  ParsedToolCall,
  RepetitionLoop,
  StopDecision,
  TurnContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// THE ask-user protocol — one definition of the question an agent asks, shared by
// every loop that can ask one and every transcript that renders one.
//
// When an agent genuinely cannot proceed without a human decision it calls the
// `ask_user` tool. That call is TERMINAL: the loop stops and the reply carries a
// fenced ```ask-user block, which the transcript lifts back out and renders as
// clickable options (brain-ui's <QuestionCard> / <PendingQuestionBanner>). A
// schema-validated tool call is far more reliable than asking a weak model to
// hand-format JSON in prose — the exact failure this exists to prevent (questions
// rendered as unactionable text the reader cannot answer with a click).
//
// Both halves live together because they are one contract. They were written twice —
// the producer's block builder + tool schema in the api's Brain reply loop, the
// consumer's parser + serializer in the shared UI package — with the same trim rules
// and the same "a card needs a prompt and 2+ options" threshold restated in each. Two
// definitions of one wire format drift silently: the producer accepts a payload the
// consumer then declines to render, and the question is swallowed.
//
// It is declared HERE rather than in a sibling module because of how it reaches the
// UI. `brain-embedded` re-exports it so the React packages layered on top read the
// same definition, and that package is published through a DECLARATION ROLLUP which
// inlines only the module a bare specifier resolves to: a sibling `./askUser.js`
// re-exported from this barrel came out as a dangling relative import, so every one of
// these symbols arrived typeless downstream (the same trap documented in
// `brain-embedded/tsup.config.ts` for `@builderforce/agent-stall`). The contract this
// package exports must therefore BE in the file the specifier names.
// ---------------------------------------------------------------------------

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserPayload {
  question: string;
  options: AskUserOption[];
  /** Allow more than one option to be chosen (checkboxes + submit) instead of a
   *  single click. */
  multiSelect?: boolean;
}

/** The tool name every surface advertises this question under. */
export const ASK_USER_TOOL = "ask_user";

/**
 * The `ask_user` tool as the model is shown it.
 *
 * NOT a platform action — an autonomous cloud agent has no live user to ask — so it
 * is injected by the CONVERSATIONAL loops only (the api's addressed-agent reply and
 * the Brain run store the editor/web chat drives) and intercepted as a terminal turn.
 */
export interface AskUserToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON Schema for the arguments. */
    parameters: Record<string, unknown>;
  };
}

export const ASK_USER_TOOL_SPEC: AskUserToolSpec = {
  type: "function",
  function: {
    name: ASK_USER_TOOL,
    description:
      "Ask the user to choose between options when you genuinely cannot proceed without their decision (e.g. who owns this, which approach, create under X or Y). Prefer this over asking in prose — the UI renders your options as clickable buttons and the choice returns as the user's next message. Do NOT use it for questions you can answer yourself from the code or context.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single, specific question to ask." },
        options: {
          type: "array",
          description: "2–6 distinct, mutually-exclusive choices (unless multiSelect).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short choice text (1–5 words)." },
              description: { type: "string", description: "Optional one-line explanation of this choice." },
            },
            required: ["label"],
          },
        },
        multiSelect: { type: "boolean", description: "Allow choosing more than one option. Default false." },
      },
      required: ["question", "options"],
    },
  },
};

/** The fenced info-string a question block is tagged with. */
const ASK_USER_FENCE = /```ask-user\s*\n([\s\S]*?)\n```/i;

/**
 * Coerce anything — raw tool arguments, parsed JSON off a fenced block — into a
 * renderable payload, or null when it isn't one.
 *
 * The threshold is deliberate and shared: a card is only meaningful with a prompt
 * AND at least two choices, so a producer that cannot clear it falls back to prose
 * (where the question at least still reads) instead of emitting a block the
 * consumer would decline.
 */
export function coerceAskUserPayload(raw: unknown): AskUserPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  const optionsIn = Array.isArray(o.options) ? o.options : [];
  const options: AskUserOption[] = optionsIn
    .map((it): AskUserOption | null => {
      if (typeof it === "string") return it.trim() ? { label: it.trim() } : null;
      if (it && typeof it === "object") {
        const rec = it as Record<string, unknown>;
        const label = typeof rec.label === "string" ? rec.label.trim() : "";
        const description = typeof rec.description === "string" ? rec.description.trim() : undefined;
        return label ? { label, ...(description ? { description } : {}) } : null;
      }
      return null;
    })
    .filter((x): x is AskUserOption => !!x);
  if (!question || options.length < 2) return null;
  return { question, options, multiSelect: o.multiSelect === true };
}

/**
 * Serialize a payload into the canonical fenced block. Shared so the producer and
 * {@link parseAskUser} can never drift on the format.
 */
export function serializeAskUser(payload: AskUserPayload): string {
  return ["```ask-user", JSON.stringify(payload), "```"].join("\n");
}

/**
 * The producer's ONE call: raw `ask_user` tool arguments → the block to reply with,
 * or null when the arguments don't make a card (the caller then keeps its prose).
 */
export function askUserBlock(args: unknown): string | null {
  const payload = coerceAskUserPayload(args);
  return payload ? serializeAskUser(payload) : null;
}

/** Extract the payload from an assistant message, or null if none/invalid. */
export function parseAskUser(text: string): AskUserPayload | null {
  if (!text || !text.includes("ask-user")) return null;
  const body = text.match(ASK_USER_FENCE)?.[1];
  if (!body) return null;
  try {
    return coerceAskUserPayload(JSON.parse(body));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prose-question recovery. Some models (MiniMax-M1, chat #133) never call
// `ask_user` — they end the run on a markdown list of options and a trailing
// question, which arrives as text the reader can only re-type. A settled reply of
// that exact shape is lifted into the canonical block here, ONCE, so both loops
// persist a real question and every transcript renders the card and the pinned
// "Answer needed" banner exactly as if the tool had been called.
//
// Deliberately narrow — a false card is worse than prose: the question must be the
// reply's last word (or directly introduce a list that is), the wording must cue a
// choice, and there must be 2–6 short options.
// ---------------------------------------------------------------------------

const PROSE_LIST_ITEM = /^\s*(?:[-*•+]|\d{1,2}[.)])\s+(\S.*)$/;
const PROSE_BOLD_LEAD = /^\s*(?:\*\*|__)([^*_\n]+?)(?:\*\*|__)\s*(.*)$/;
const PROSE_CONTINUATION = /^\s{2,}\S/;
// A choice AMONG the listed items — not "Want me to proceed?" under a list of next steps.
const PROSE_CHOICE_CUE =
  /\b(?:options?|choices?|choose|pick|which|prefer|approach|alternatives?)\b|\bwhat (?:would|do|should) (?:you|we) (?:like to )?(?:do|want)\b|\bhow (?:would|do) you (?:like|want)\b/i;
const PROSE_MAX_LABEL = 80;
const PROSE_MAX_OPTIONS = 6;

const plainLine = (line: string): string => line.replace(/\*\*|__|`/g, "").trim();

/** A bulleted/numbered line, or an unmarked line led by a bold label. A bare bold
 *  `**Options:**` is a HEADER, not an option. */
type ProseItemKind = "marked" | "bold";
function proseItemKind(line: string): ProseItemKind | null {
  if (PROSE_LIST_ITEM.test(line)) return "marked";
  const bold = line.match(PROSE_BOLD_LEAD);
  if (!bold) return null;
  return !(bold[2] ?? "").trim() && plainLine(line).endsWith(":") ? null : "bold";
}
const isProseItem = (line: string): boolean => proseItemKind(line) !== null;

/** One list line → an option, or null when it reads as a sentence rather than a choice. */
function proseOption(line: string): AskUserOption | null {
  const body = line.match(PROSE_LIST_ITEM)?.[1] ?? line.trim();
  const bold = body.match(PROSE_BOLD_LEAD);
  let label: string;
  let rest: string;
  if (bold) {
    label = bold[1] ?? "";
    rest = bold[2] ?? "";
  } else {
    const sep = body.match(/\s+[—–-]\s+|:\s+/);
    label = sep?.index !== undefined ? body.slice(0, sep.index) : body;
    rest = sep?.index !== undefined ? body.slice(sep.index + sep[0].length) : "";
  }
  label = plainLine(label).replace(/[:.]$/, "").trim();
  const description = plainLine(rest).replace(/^[\s—–:-]+/, "").trim();
  if (!label || label.length > PROSE_MAX_LABEL) return null;
  return description ? { label, description } : { label };
}

/** Parse `lines` (items, indented continuations, blank gaps) into options; null on any other line. */
function proseOptions(lines: readonly string[]): AskUserOption[] | null {
  const options: AskUserOption[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isProseItem(line)) {
      const option = proseOption(line);
      if (!option) return null;
      options.push(option);
      continue;
    }
    const last = options[options.length - 1];
    if (!last || !PROSE_CONTINUATION.test(line)) return null;
    const more = plainLine(line);
    last.description = last.description ? `${last.description} ${more}` : more;
  }
  return options.length >= 2 && options.length <= PROSE_MAX_OPTIONS ? options : null;
}

/**
 * Index of the first line of the item block ending at `end` (inclusive). One block is
 * ONE kind of item, so a bold-led prose paragraph ("**Blocker:** …") above a bulleted
 * list never joins it.
 */
function itemBlockStart(lines: readonly string[], end: number): number {
  let kind: ProseItemKind | null = null;
  let i = end;
  while (i >= 0) {
    const line = lines[i] ?? "";
    const k = proseItemKind(line);
    if (k) {
      if (kind && k !== kind) break;
      kind = k;
      i--;
    } else if (!line.trim() || PROSE_CONTINUATION.test(line)) i--;
    else break;
  }
  let start = i + 1;
  while (start <= end && !(lines[start] ?? "").trim()) start++;
  return start;
}

/** The nearest non-blank line above `index` (-1 when there is none). */
function lineAbove(lines: readonly string[], index: number): number {
  let i = index - 1;
  while (i >= 0 && !(lines[i] ?? "").trim()) i--;
  return i;
}

const isQuestionLine = (line: string | undefined): boolean =>
  !!line && !isProseItem(line) && plainLine(line).endsWith("?");
const isHeaderLine = (line: string | undefined): boolean =>
  !!line && !isProseItem(line) && plainLine(line).endsWith(":") && plainLine(line).length <= 60;

/**
 * A settled reply that ends on a prose question with listed options → the same reply
 * with that question as the canonical ```ask-user block (lead-in prose kept above it).
 * Any other text is returned unchanged, as is a reply that already carries a block.
 */
export function liftProseAskUser(text: string): string {
  if (!text || ASK_USER_FENCE.test(text)) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !(lines[end] ?? "").trim()) end--;
  if (end < 1) return text;

  let question: string;
  let leadEnd: number; // exclusive
  let itemStart: number;
  let itemEnd: number;
  if (isQuestionLine(lines[end])) {
    // "…list…\n\nWhat would you like to do?"
    question = lines[end] ?? "";
    itemEnd = end - 1;
    itemStart = itemBlockStart(lines, itemEnd);
    const above = lineAbove(lines, itemStart);
    leadEnd = isHeaderLine(lines[above]) ? above : itemStart;
  } else {
    // "Which approach should I take?\n- A\n- B"
    itemEnd = end;
    itemStart = itemBlockStart(lines, itemEnd);
    const above = lineAbove(lines, itemStart);
    if (!isQuestionLine(lines[above])) return text;
    question = lines[above] ?? "";
    leadEnd = above;
  }
  if (itemStart > itemEnd) return text;
  const cue = `${leadEnd < itemStart ? lines[leadEnd] ?? "" : ""} ${question}`;
  if (!PROSE_CHOICE_CUE.test(cue)) return text;
  const options = proseOptions(lines.slice(itemStart, itemEnd + 1));
  if (!options) return text;
  const payload = coerceAskUserPayload({ question: plainLine(question), options });
  if (!payload) return text;
  const lead = lines.slice(0, leadEnd).join("\n").trim();
  const block = serializeAskUser(payload);
  return lead ? `${lead}\n\n${block}` : block;
}

/** Remove the raw block so the message's prose reads cleanly beside the rendered
 *  card. Collapses the whitespace the removed block leaves behind. */
export function stripAskUser(text: string): string {
  if (!text) return text;
  return text.replace(ASK_USER_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** The DOM id of a rendered question card. ONE convention, shared by the transcript
 *  that stamps it and any host that scrolls to it — so the two can never drift. */
export function askUserAnchorId(messageId: number): string {
  return `bf-ask-${messageId}`;
}

/**
 * The DOM id of a rendered TRANSCRIPT MESSAGE. Same one-convention rule as
 * {@link askUserAnchorId}: the timeline stamps it on every settled user/assistant
 * turn, and any surface that wants to jump to a message resolves it through this
 * helper rather than hand-writing the string.
 *
 * It exists because a reply can be shown somewhere OTHER than the transcript — a
 * speech bubble over an agent's head in the room is the gist of a reply whose full
 * text only the transcript holds — and clicking that gist has to land on the turn it
 * came from.
 */
export function brainMessageAnchorId(messageId: number): string {
  return `bf-msg-${messageId}`;
}

/** The minimal message shape {@link selectPendingAskUser} needs — structural on
 *  purpose, so this module stays free of any transcript import. */
export interface AskUserMessageLike {
  id: number;
  role: string;
  content: string;
}

/** An unanswered question and the message carrying it. */
export interface PendingAskUser {
  payload: AskUserPayload;
  /** The assistant message the question rides in (lets a host reveal its card). */
  messageId: number;
}

/**
 * The question the conversation is currently BLOCKED on, or null when there is none.
 * Walks back from the newest turn: the last assistant `ask-user` block wins, but a
 * user turn after it means the question was already answered (answering posts the
 * choice as the next user turn), so nothing is pending.
 *
 * Shared so a host never re-derives "is there an open question" — the same predicate
 * drives the pinned banner and any host-side pending affordance.
 */
export function selectPendingAskUser(messages: readonly AskUserMessageLike[]): PendingAskUser | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "user") return null;
    if (msg.role !== "assistant") continue;
    const payload = parseAskUser(msg.content);
    if (payload) return { payload, messageId: msg.id };
  }
  return null;
}
