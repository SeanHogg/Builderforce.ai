/**
 * Brain execution triage — capture the Brain's run (LLM steps, tool chain,
 * intermediate assistant messages, and errors) as a single paste-able report.
 *
 * This mirrors the "Copy triage info" report the Observability/Logs view emits
 * for host & cloud agents, but for the in-browser Brain agent loop. The loop
 * (useBrainConversation) records a BrainTraceEvent per step; this module turns
 * the recorded trace + the visible conversation into one report a user can drop
 * straight into a bug report.
 */

import type { BrainMessage } from './types';

/** One step of the Brain agent loop, recorded as it runs. */
export interface BrainTraceEvent {
  /** ISO timestamp of when the step completed. */
  ts: string;
  /**
   * Category, matching the host/cloud triage vocabulary:
   * - `llm`     — a streamed completion (model, step, tool-call count)
   * - `tool`    — a client action the model invoked (args + result)
   * - `message` — assistant text emitted on a turn
   * - `error`   — a thrown exception or a tool result that failed
   */
  category: 'llm' | 'tool' | 'message' | 'error';
  /** Display label — the tool name, or `llm.complete` / `agent.message`. */
  label: string;
  /** Wall-clock duration of the step, when measured. */
  durationMs?: number;
  /** Tool arguments / completion request summary. */
  args?: unknown;
  /** Tool result / completion summary / error message. */
  result?: unknown;
  /** True when this step represents a failure (thrown, or `{ ok: false }`). */
  isError?: boolean;
  // --- Diagnostics (optional, populated by the loop for A-vs-B triage) ---
  /** `llm` steps: token usage the gateway reported for this completion. */
  usage?: { prompt?: number; completion?: number; total?: number };
  /** `llm` steps: OpenAI finish_reason (`stop` | `length` | `tool_calls` | …). */
  finishReason?: string | null;
  /** `llm` steps: length of the assistant text this turn produced. */
  textChars?: number;
  /**
   * `tool` steps: byte length of the FULL result the tool returned, before any
   * transcript trimming — so a diagnostics reader sees which tool flooded the
   * context even though the model only ever saw a truncated copy.
   */
  resultBytes?: number;
  /** `tool` steps: true when the result sent to the model was truncated. */
  truncated?: boolean;
}

/**
 * Did a tool result represent a failure?
 *
 * Tool results in this codebase signal failure by SHAPE, not prose: the platform
 * actions return `{ ok: false }` or `{ error: "<message>" }` (the tenant guard,
 * the dispatcher's unknown-capability, a thrown handler). We inspect that shape
 * instead of regex-scanning the whole stringified payload — the old
 * `\b(error|failed|exception)\b` scan misfired on any legit data that merely
 * CONTAINED the word "error" (e.g. a task titled "Fix login error", an audit
 * row, a search result), mis-marking a successful run as ERROR in the report.
 *
 * For a STRING result we only flag an embedded `{ ok: false }` / `"error":`
 * envelope (a stringified error object), never a free-text occurrence of the
 * word — a plain-string success like `"done"` or `"No errors found"` is not a
 * failure.
 */
export function isFailedToolResult(result: unknown): boolean {
  if (result == null) return false;
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.ok === false) return true;
    if (typeof r.error === 'string' && r.error) return true;
    return false;
  }
  if (typeof result === 'string') {
    // Only a serialized error envelope counts — not the bare word "error".
    return /"ok"\s*:\s*false/.test(result) || /"error"\s*:\s*"[^"]/.test(result);
  }
  return false;
}

function cap(s: unknown, n = 2000): string {
  const str = typeof s === 'string' ? s : JSON.stringify(s ?? '');
  return str.length > n ? str.slice(0, n) + `… (+${str.length - n} chars)` : str;
}

/**
 * An `evermind/…` (or project-/tenant-pinned) model id means a tenant's own
 * Evermind artifact answered the turn rather than a stock pool model. Matches the
 * `evermind/` vendor prefix and the `project_evermind:` / `tenant_model:` pin refs.
 */
export function isEvermindModel(model: string): boolean {
  return /(^|\/)evermind\b|^project_evermind:|^tenant_model:/i.test(model);
}

/**
 * The distinct models the gateway ACTUALLY used across a run, read from the `llm`
 * trace events (brainRunStore records the resolved model in `args.model`). First-
 * seen order, so a mid-run failover swap stays visible. The placeholder `default`
 * (caller pinned nothing ⇒ gateway auto-selected, and it reported no model) is
 * dropped so it never masquerades as a real model id.
 */
export function modelsUsedInTrace(events: BrainTraceEvent[]): string[] {
  const seen: string[] = [];
  for (const ev of events) {
    if (ev.category !== 'llm' && ev.category !== 'error') continue;
    const m = (ev.args as { model?: unknown } | undefined)?.model;
    if (typeof m === 'string' && m && m !== 'default' && !seen.includes(m)) seen.push(m);
  }
  return seen;
}

/**
 * Structured run diagnostics derived from the trace — the numbers a reader needs
 * to tell WHY a Brain run died, without eyeballing a wall of JSON.
 *
 * The two failure modes we discriminate:
 *  - **context-exhaustion** (case A): prompt tokens climb turn over turn (big
 *    tool dumps in the transcript), the gateway fails over to a smaller-window
 *    model, and a turn ends on `finish_reason: length` or empty. The context
 *    starved the model.
 *  - **model-degradation** (case B): a tenant Evermind/SSM model answered and a
 *    turn came back empty/failed while token counts stayed LOW — the model
 *    itself produced nothing, not the context.
 */
export interface BrainDiagnostics {
  turns: number;
  toolCalls: number;
  errors: number;
  loopExhausted: boolean;
  /** True when at least one llm step reported token usage. */
  tokensMeasured: boolean;
  /** Largest prompt-token count seen on any single turn. */
  promptTokenPeak: number;
  /** Sum of completion tokens across turns. */
  completionTokenTotal: number;
  /** Prompt tokens on the LAST turn (the one nearest any overflow). */
  lastPromptTokens: number;
  /** Total bytes of tool results returned this run (pre-trim). */
  toolResultBytes: number;
  /** Count of tool results that were truncated before hitting the model. */
  truncatedToolResults: number;
  /** The single largest tool result (label + pre-trim bytes). */
  largestToolResult: { label: string; bytes: number } | null;
  /** Distinct models that actually answered, first-seen order. */
  modelsUsed: string[];
  /** Distinct Evermind/SSM artifacts among them. */
  evermindUsed: string[];
  /** Turns where the resolved model differed from what was requested. */
  downgradeEvents: number;
  /** Turns that ended on `length` or produced empty text. */
  emptyOrLengthFinishes: number;
  /** Best-effort verdict — the header a triager reads first. */
  likelyCause: 'context-exhaustion' | 'model-degradation' | 'inconclusive';
}

/** Byte length of a JSON-serialized value (UTF-16 length is a fine proxy here). */
function byteLen(v: unknown): number {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length;
}

/**
 * Derive {@link BrainDiagnostics} from a recorded trace. Pure — no clock, no I/O
 * — so both the web report and the VS Code transcript compute the identical
 * block from the same events (single source of truth for A-vs-B triage).
 */
export function computeBrainDiagnostics(events: BrainTraceEvent[], requestedModel?: string): BrainDiagnostics {
  const llm = events.filter((e) => e.category === 'llm');
  const toolEvents = events.filter((e) => e.category === 'tool');
  const errors = events.filter((e) => e.isError || e.category === 'error');
  const loopExhausted = events.some((e) => e.label === 'agent.loop' && e.isError);

  let promptTokenPeak = 0;
  let completionTokenTotal = 0;
  let lastPromptTokens = 0;
  let tokensMeasured = false;
  let emptyOrLengthFinishes = 0;
  let downgradeEvents = 0;
  const req = (requestedModel && requestedModel !== 'default') ? requestedModel : undefined;

  for (const ev of llm) {
    const u = ev.usage;
    if (u) {
      tokensMeasured = true;
      if (typeof u.prompt === 'number') {
        promptTokenPeak = Math.max(promptTokenPeak, u.prompt);
        lastPromptTokens = u.prompt;
      }
      if (typeof u.completion === 'number') completionTokenTotal += u.completion;
    }
    const finish = ev.finishReason ?? null;
    const emptyText = typeof ev.textChars === 'number' && ev.textChars === 0;
    // A "no-op" turn (empty text but tool calls requested) is normal; only count
    // a turn as degenerate when it ended on `length` (truncated) or produced
    // nothing AND asked for no tools.
    const toolCallsThisTurn = (ev.args as { toolCalls?: unknown } | undefined)?.toolCalls;
    const askedNoTools = typeof toolCallsThisTurn === 'number' ? toolCallsThisTurn === 0 : true;
    if (finish === 'length' || (emptyText && askedNoTools)) emptyOrLengthFinishes += 1;
    const resolved = (ev.args as { model?: unknown } | undefined)?.model;
    if (req && typeof resolved === 'string' && resolved && resolved !== 'default' && resolved !== req) downgradeEvents += 1;
  }

  let toolResultBytes = 0;
  let truncatedToolResults = 0;
  let largestToolResult: { label: string; bytes: number } | null = null;
  for (const ev of toolEvents) {
    const bytes = typeof ev.resultBytes === 'number' ? ev.resultBytes : byteLen(ev.result);
    toolResultBytes += bytes;
    if (ev.truncated) truncatedToolResults += 1;
    if (!largestToolResult || bytes > largestToolResult.bytes) largestToolResult = { label: ev.label, bytes };
  }

  const modelsUsed = modelsUsedInTrace(events);
  const evermindUsed = modelsUsed.filter(isEvermindModel);

  // Verdict. Context-exhaustion signals: big prompt tokens, truncated tool
  // results, or a model downgrade/length-finish. Degradation signals: an
  // Evermind model answered, tokens stayed low, and a turn was empty/failed.
  const contextSignal =
    promptTokenPeak >= 24_000 || truncatedToolResults > 0 || downgradeEvents > 0 ||
    (largestToolResult != null && largestToolResult.bytes >= 20_000);
  const degradationSignal =
    evermindUsed.length > 0 && emptyOrLengthFinishes > 0 &&
    (!tokensMeasured || promptTokenPeak < 24_000) && truncatedToolResults === 0;
  const likelyCause: BrainDiagnostics['likelyCause'] =
    contextSignal && !degradationSignal ? 'context-exhaustion'
      : degradationSignal && !contextSignal ? 'model-degradation'
        : 'inconclusive';

  return {
    turns: llm.length,
    toolCalls: toolEvents.length,
    errors: errors.length,
    loopExhausted,
    tokensMeasured,
    promptTokenPeak,
    completionTokenTotal,
    lastPromptTokens,
    toolResultBytes,
    truncatedToolResults,
    largestToolResult,
    modelsUsed,
    evermindUsed,
    downgradeEvents,
    emptyOrLengthFinishes,
    likelyCause,
  };
}

/** Human-readable KB. */
function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Render {@link BrainDiagnostics} as transcript lines. Shared by both copy
 * surfaces so the "Diagnostics" block is identical on web and in VS Code. Emits
 * a leading `--- Diagnostics ---` header and returns the lines (caller joins).
 */
export function formatBrainDiagnostics(d: BrainDiagnostics): string[] {
  const verdict =
    d.likelyCause === 'context-exhaustion'
      ? 'Likely CONTEXT EXHAUSTION (case A) — the transcript outgrew the model window.'
      : d.likelyCause === 'model-degradation'
        ? 'Likely MODEL DEGRADATION (case B) — an Evermind/SSM turn returned empty while tokens stayed low.'
        : 'Inconclusive — not enough signal to separate context exhaustion from model degradation.';

  const lines: string[] = ['--- Diagnostics ---', `Likely cause: ${verdict}`];
  lines.push(`Turns: ${d.turns} · Tool calls: ${d.toolCalls} · Errors: ${d.errors}${d.loopExhausted ? ' · LOOP EXHAUSTED' : ''}`);
  if (d.tokensMeasured) {
    lines.push(
      `Tokens: prompt peak ${d.promptTokenPeak.toLocaleString()} · last-turn prompt ${d.lastPromptTokens.toLocaleString()} · completion total ${d.completionTokenTotal.toLocaleString()}`,
    );
  } else {
    lines.push('Tokens: not reported by the gateway for this run.');
  }
  lines.push(
    `Tool results: ${kb(d.toolResultBytes)} total${d.largestToolResult ? ` · largest ${d.largestToolResult.label} (${kb(d.largestToolResult.bytes)})` : ''}${d.truncatedToolResults ? ` · ${d.truncatedToolResults} truncated before the model saw them` : ''}`,
  );
  if (d.downgradeEvents > 0) lines.push(`Model downgrades: ${d.downgradeEvents} turn(s) answered by a different model than requested (gateway failover).`);
  if (d.emptyOrLengthFinishes > 0) lines.push(`Degenerate turns: ${d.emptyOrLengthFinishes} ended on \`length\` or returned empty text.`);
  if (d.evermindUsed.length) lines.push(`Evermind/SSM answered: ${d.evermindUsed.join(', ')}`);
  return lines;
}

export interface BuildBrainTriageOptions {
  /** ISO capture time (caller supplies it so the module stays clock-free). */
  capturedAt: string;
  /** The trace recorded by the agent loop for the active chat. */
  events: BrainTraceEvent[];
  /** The visible conversation, included as a transcript section. */
  messages?: BrainMessage[];
  /** The chat being captured. */
  chatId?: number | null;
  chatTitle?: string;
  /** The persona / agent the Brain ran as. */
  agentLabel?: string;
  /** The model this surface was CONFIGURED with (empty ⇒ gateway auto-selects).
   *  Distinct from what actually answered, which is derived from the trace. */
  configuredModel?: string;
  /** The current top-level error surfaced to the user, if any. */
  error?: string;
}

/**
 * Assemble the Brain triage report. Same shape as the host/cloud report:
 * header → errors-first → full event log → derived log lines → transcript.
 */
export function buildBrainTriageReport(opts: BuildBrainTriageOptions): string {
  const { capturedAt, events, messages = [], chatId, chatTitle, agentLabel, configuredModel, error } = opts;
  const errors = events.filter((e) => e.isError || e.category === 'error');
  const lines: string[] = [];

  lines.push('=== BuilderForce Brain Triage ===');
  lines.push(`Captured:  ${capturedAt}`);
  if (chatId != null) lines.push(`Chat:      #${chatId}${chatTitle ? ` — ${chatTitle}` : ''}`);
  lines.push(`Brain:     ${agentLabel || 'Brain (default)'}`);
  // Model provenance — which LLM actually produced these turns. `configuredModel`
  // is what this surface was set to (blank ⇒ gateway auto-selects); the trace tells
  // us what really answered, and whether a tenant's Evermind artifact was used.
  lines.push(`Configured model: ${configuredModel || '(gateway auto-select)'}`);
  const used = modelsUsedInTrace(events);
  if (used.length) lines.push(`Models used: ${used.join(', ')}`);
  const evermind = used.filter(isEvermindModel);
  if (evermind.length) lines.push(`Evermind: yes — ${evermind.join(', ')}`);
  lines.push(`Steps: ${events.length} · Errors: ${errors.length} · Messages: ${messages.length}`);
  if (error) lines.push(`Last error: ${error}`);

  // Diagnostics block — the A-vs-B verdict + the token/tool-payload/downgrade
  // numbers behind it. Same builder the VS Code transcript uses.
  lines.push('', ...formatBrainDiagnostics(computeBrainDiagnostics(events, configuredModel)));

  if (errors.length) {
    lines.push('', `--- Errors (${errors.length}) ---`);
    for (const ev of errors) {
      lines.push(`[${ev.ts}] ${ev.label} (${ev.category}) — ${cap(ev.result ?? ev.args ?? '')}`);
    }
  }

  lines.push('', `--- Execution trace (${events.length}) ---`);
  for (const ev of events) {
    lines.push(
      `[${ev.ts}] ${ev.label} (${ev.category})${ev.durationMs != null ? ` · ${ev.durationMs}ms` : ''}${ev.isError ? ' · ERROR' : ''}`,
    );
    if (ev.args !== undefined) lines.push(`    args:   ${cap(ev.args)}`);
    if (ev.result !== undefined) lines.push(`    result: ${cap(ev.result)}`);
  }

  // Derived log lines — a flat, level-prefixed view of the same trace, matching
  // the host/cloud "Logs" section so a reader can scan it the same way.
  lines.push('', `--- Logs (${events.length}) ---`);
  for (const ev of events) {
    const level = ev.isError || ev.category === 'error' ? 'ERROR' : 'INFO';
    const summary = ev.result !== undefined ? cap(ev.result, 300) : cap(ev.args, 300);
    lines.push(`[${ev.ts}] ${level.padEnd(5)} ${ev.label}${summary ? ` — ${summary}` : ''}`);
  }

  if (messages.length) {
    lines.push('', `--- Conversation (${messages.length}) ---`);
    for (const m of messages) {
      lines.push(`[${m.createdAt ?? ''}] ${m.role.toUpperCase()}: ${cap(m.content, 1500)}`);
    }
  }

  return lines.join('\n');
}
