/**
 * The durable STEP ROW — the single stored form of a run's tool call, LLM turn or
 * memory step. Every writer builds it here: the client run loop (brain-embedded
 * `persistStep`) and the server's addressed-agent reply (api `BrainService.agentReply`),
 * so the row cannot drift between them. Readers parse it back with brain-embedded's
 * `parseStepMessage`.
 *
 * It is a `role:'tool'` chat message with empty content and `{ kind:'step', … }`
 * metadata. Seed builders exclude `role:'tool'`, so a step row never re-enters a model
 * transcript.
 */

/** A step as a run records it — the fields of a live trace event the row keeps. */
export interface StepRowInput {
  category: string;
  label: string;
  /** When the step HAPPENED (ISO) — readers order and dedupe steps by it. */
  ts: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  ttftMs?: number;
  /** `tool` steps: pre-trim byte size of the full result (the stored copy is capped). */
  resultBytes?: number;
  /** `tool` steps: the result the model saw was truncated. */
  truncated?: boolean;
  /** `llm` steps: token usage the gateway reported for the turn. */
  usage?: unknown;
  /** `llm` steps: OpenAI finish_reason. */
  finishReason?: string | null;
  /** `llm` steps: length of the assistant text the turn produced. */
  textChars?: number;
}

/** Cap on a stored step's RESULT (chars). The live trace keeps the full result. */
export const STEP_RESULT_CAP = 4_000;

function capped(value: unknown): unknown {
  let s: string;
  try {
    s = JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
  return s.length > STEP_RESULT_CAP ? `${s.slice(0, STEP_RESULT_CAP)}…[${s.length - STEP_RESULT_CAP} more chars]` : (value ?? null);
}

const STEP_KIND = /"kind"\s*:\s*"step"/;

/**
 * Whether a message is a stored step — the ONE test every store uses to keep step rows
 * (run telemetry, written to the operational database) apart from the conversation.
 * Textual on purpose: the metadata is a JSON string and a step row is identified by its
 * `kind`, so this never pays for a parse on the write path.
 */
export function isStepRow(m: { role: string; metadata?: string | null }): boolean {
  return m.role === "tool" && typeof m.metadata === "string" && STEP_KIND.test(m.metadata);
}

/** The `role:'tool'` message that stores one step. */
export function stepRow(step: StepRowInput): { role: "tool"; content: ""; metadata: string } {
  const metadata = JSON.stringify({
    kind: "step",
    category: step.category,
    label: step.label,
    args: step.args ?? null,
    result: capped(step.result),
    isError: step.isError ?? false,
    // Diagnostics scalars — tiny, and the whole point of keeping the row.
    ...(step.durationMs != null ? { durationMs: step.durationMs } : {}),
    ...(step.resultBytes != null ? { resultBytes: step.resultBytes } : {}),
    ...(step.truncated ? { truncated: true } : {}),
    ...(step.usage ? { usage: step.usage } : {}),
    ...(step.finishReason != null ? { finishReason: step.finishReason } : {}),
    ...(step.textChars != null ? { textChars: step.textChars } : {}),
    ...(step.ttftMs != null ? { ttftMs: step.ttftMs } : {}),
    ts: step.ts,
  });
  return { role: "tool", content: "", metadata };
}
