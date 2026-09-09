export { runAgentLoop } from "./loop.js";
export { runSubagent, subagentSystemPrompt, SUBAGENT_MAX_STEPS, SUBAGENT_OUTPUT_CHARS } from "./subagent.js";
export type { SubagentRunArgs, SubagentRunResult } from "./subagent.js";
export { asToolArgs, parseToolArgs, parseToolCall } from "./parseToolCall.js";
// The reasoning channel — one reading of what a turn SAID versus what it THOUGHT, and
// the policies each surface applies to it. Written four times before this, disagreeing
// on whether an unclosed block counts and whether a tag inside a code fence does; see
// `reasoning.ts`. Consumers import it from this package DIRECTLY rather than through a
// published re-export, so no declaration rollup has to inline it.
export {
  answerTextOf,
  canonicalReasoningText,
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
