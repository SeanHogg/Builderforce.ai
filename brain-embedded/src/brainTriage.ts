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
import { traceWithPersistedSteps } from './persistedSteps';

/** One step of the Brain agent loop, recorded as it runs. */
export interface BrainTraceEvent {
  /** ISO timestamp of when the step completed. */
  ts: string;
  /**
   * Category, matching the host/cloud triage vocabulary:
   * - `llm`       — a streamed completion (model, step, tool-call count)
   * - `tool`      — a client action the model invoked (args + result)
   * - `message`   — assistant text emitted on a turn
   * - `error`     — a thrown exception or a tool result that failed
   * - `recall`    — the project Evermind recalled learned memories before answering
   * - `learn`     — the turn was contributed back to the project Evermind
   * - `reconcile` — the turn superseded (updated) recalled memories (write-through)
   */
  category: 'llm' | 'tool' | 'message' | 'error' | 'recall' | 'learn' | 'reconcile';
  /** Display label — the tool name, or `llm.complete` / `agent.message`. */
  label: string;
  /** Wall-clock duration of the step, when measured. */
  durationMs?: number;
  /**
   * `llm` steps: time-to-first-token (ms) — the delay from issuing the
   * completion request to the FIRST streamed text delta of the turn. Undefined
   * when no token arrived (a pure tool-call / empty turn). The timeline uses it
   * for the "Thought for Xs" thinking node so it reflects latency-to-first-token
   * rather than the full-turn duration.
   */
  ttftMs?: number;
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
  /**
   * True when this event was RECONSTRUCTED from a durable step row rather than
   * recorded live this session (see `persistedSteps.traceWithPersistedSteps`).
   * Diagnostics uses it to tell a fully-observed run from a partially-recovered
   * one, so mismatched coverage is labelled instead of silently averaged in.
   */
  recovered?: boolean;
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

/** Tool labels that PERSIST a file/attachment change. A "saved the file" claim is
 *  only honest if one of these SUCCEEDED this run. Covers the client manifest
 *  (`project_files.save`) and the gateway builtin catalog (`attachments.write`,
 *  advertised `builtin_attachments_write` / `builtin_project_files_save`). */
const FILE_WRITE_TOOL = /(attachments|files?|project_files)[._](write|save|update)/i;

/** Assistant prose that CLAIMS a file/attachment was persisted. */
const FILE_SAVE_CLAIM = /\b(saved|updated|wrote|written|edited|persisted|added)\b[^.!?\n]*\b(file|attachment|roadmap|document|upload|\.md|\.csv|\.txt|\.json)\b/i;

/** Tool labels that CREATE or LINK a board work item. A "filed/created/linked the
 *  ticket" claim is only honest if one of these SUCCEEDED this run. Covers the create
 *  tools (tasks/objectives/specs/…) and the chat-link + from-delta tools. */
const TICKET_WRITE_TOOL = /(tasks|objectives|key_results|initiatives|portfolios|specs|roadmap)[._]create|chats[._]link_ticket|tickets[._]from_delta/i;

/** Assistant prose that CLAIMS a ticket/gap/task was created, filed, or linked. */
const TICKET_CLAIM = /\b(created|filed|opened|logged|added|linked|tracked)\b[^.!?\n]*\b(ticket|task|gap|epic|issue|objective|bug|card|board)\b/i;

/**
 * Structural honesty check for the "it said it updated the file but didn't" failure:
 * an assistant message that CLAIMS a file/attachment write while NO file-write tool
 * call succeeded in the run. Pure over the recorded trace + visible messages, so the
 * web report and the VS Code transcript flag it identically. The Brain system prompt
 * tells the model not to fake a save; this makes a violation visible in every triage
 * capture (and is reusable by a run-loop guard).
 */
export function detectUnbackedWriteClaim(events: BrainTraceEvent[], messages: BrainMessage[]): boolean {
  const wroteOk = events.some(
    (e) => e.category === 'tool' && FILE_WRITE_TOOL.test(e.label) && !e.isError && !isFailedToolResult(e.result),
  );
  if (wroteOk) return false;
  return messages.some((m) => m.role === 'assistant' && typeof m.content === 'string' && FILE_SAVE_CLAIM.test(m.content));
}

/**
 * The ticket twin of {@link detectUnbackedWriteClaim}: an assistant turn that CLAIMS it
 * created/filed/linked a ticket, gap, or task while NO create/link tool call succeeded
 * this run — the "it said it linked the gap to the chat, but the chat shows no link"
 * failure. The run loop links a REAL create deterministically (autoLinkCreatedItem), so
 * a claim with no successful create/link tool means nothing was actually filed or
 * linked. Pure over the recorded trace + visible messages, so both copy surfaces flag
 * it identically.
 */
export function detectUnbackedTicketClaim(events: BrainTraceEvent[], messages: BrainMessage[]): boolean {
  const filedOk = events.some(
    (e) => e.category === 'tool' && TICKET_WRITE_TOOL.test(e.label) && !e.isError && !isFailedToolResult(e.result),
  );
  if (filedOk) return false;
  return messages.some((m) => m.role === 'assistant' && typeof m.content === 'string' && TICKET_CLAIM.test(m.content));
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
 * Which account served the run, from the `account` the loop recorded per `llm`
 * step (the gateway's `x-builderforce-account`). Last-seen wins so a mid-run swap
 * is reflected. Undefined when the gateway reported none. Values: `own` (tenant's
 * connected frontier account) · `shared` (shared pool, nothing connected) ·
 * `shared_byo_unused` (shared pool DESPITE a connected account).
 */
export function accountUsedInTrace(events: BrainTraceEvent[]): string | undefined {
  let account: string | undefined;
  for (const ev of events) {
    if (ev.category !== 'llm') continue;
    const a = (ev.args as { account?: unknown } | undefined)?.account;
    if (typeof a === 'string' && a) account = a;
  }
  return account;
}

/**
 * Connected-BYO providers the gateway could NOT resolve on any turn (from
 * `x-builderforce-byo-unresolved`) — e.g. a connected Claude subscription whose
 * token expired, so the run silently used the shared pool instead of the tenant's
 * own Opus. Union across turns, first-seen order. Empty when everything resolved.
 * This is the signal that turns a mysterious weak-model run into "reconnect your
 * Claude account" — the exact context a "should have used Opus" triage lacked.
 */
export function byoUnresolvedInTrace(events: BrainTraceEvent[]): string[] {
  const seen: string[] = [];
  for (const ev of events) {
    if (ev.category !== 'llm') continue;
    const raw = (ev.args as { byoUnresolved?: unknown } | undefined)?.byoUnresolved;
    if (typeof raw !== 'string' || !raw) continue;
    for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!seen.includes(p)) seen.push(p);
    }
  }
  return seen;
}

/** One connected-but-unresolved provider + WHY (the gateway encodes `provider:reason`
 *  in `x-builderforce-byo-unresolved`, e.g. `anthropic:revoked`). `reason` is '' when the
 *  gateway sent a bare provider (older gateway). */
export interface ByoUnresolvedEntry {
  provider: string;
  reason: string;
}

/** Parse the run's `provider:reason` unresolved entries into structured form. Accepts the
 *  bare-provider form too (reason ''), so an older gateway still renders. */
export function parseByoUnresolved(entries: readonly string[]): ByoUnresolvedEntry[] {
  return entries.map((e) => {
    const i = e.indexOf(':');
    return i === -1 ? { provider: e, reason: '' } : { provider: e.slice(0, i), reason: e.slice(i + 1) };
  });
}

/** An actionable hint for a {@link ByoUnresolvedEntry} reason — the SINGLE source both the
 *  triage report and the live webview banner render, so "what do I do about it" never drifts. */
export function byoReasonHint(reason: string): string {
  switch (reason) {
    case 'revoked':
      return 'its token was revoked or expired — reconnect it in the web app under Settings ▸ API Keys';
    case 'expired':
      return 'its token expired and the refresh failed (often transient) — retry, or reconnect it under Settings ▸ API Keys';
    case 'undecryptable':
      return 'its stored credential could not be read — re-enter it under Settings ▸ API Keys';
    case 'other-workspace':
      return 'you connected this account in a DIFFERENT workspace — switch to that workspace, or connect it in this one under Settings ▸ API Keys';
    default:
      return 'it could not be used this run — reconnect it under Settings ▸ API Keys';
  }
}

/** A one-line summary of an unresolved provider: `anthropic (revoked): <hint>`. */
export function byoUnresolvedSummary(entry: ByoUnresolvedEntry): string {
  return `${entry.provider}${entry.reason ? ` (${entry.reason})` : ''}: ${byoReasonHint(entry.reason)}`;
}

/** Human label for an `x-builderforce-account` value. */
function accountLabel(account: string): string {
  return account === 'own'
    ? "the tenant's own connected account"
    : account === 'shared_byo_unused'
      ? 'the shared model pool (a connected account existed but was NOT used)'
      : account === 'shared'
        ? 'the shared model pool'
        : account;
}

/**
 * The model + account provenance header lines, derived from the trace. The SINGLE
 * source both copy surfaces use (the web {@link buildBrainTriageReport} and the VS
 * Code `transcript.ts`) so "which surface / model / account served this, and was a
 * connected account left unused" is rendered identically — no drift, no surface
 * missing the account/BYO context (the "vsix copy missing info" gap). `surface`
 * names WHERE the run happened (e.g. `VS Code (VSIX)` / `Web`); omit when unknown.
 */
export function formatBrainProvenance(
  events: BrainTraceEvent[],
  opts: { configuredModel?: string; surface?: string } = {},
): string[] {
  const lines: string[] = [];
  if (opts.surface) lines.push(`Surface: ${opts.surface}`);
  lines.push(`Configured model: ${opts.configuredModel || '(gateway auto-select)'}`);
  const used = modelsUsedInTrace(events);
  if (used.length) lines.push(`Models used: ${used.join(', ')}`);
  const evermind = used.filter(isEvermindModel);
  if (evermind.length) lines.push(`Evermind: yes — ${evermind.join(', ')}`);
  const account = accountUsedInTrace(events);
  if (account) lines.push(`Account: ${accountLabel(account)}`);
  const byoUnresolved = parseByoUnresolved(byoUnresolvedInTrace(events));
  if (byoUnresolved.length) {
    lines.push('⚠ CONNECTED ACCOUNT NOT USED — a connected account existed but the run fell back to the shared pool instead of your own model:');
    for (const e of byoUnresolved) lines.push(`  • ${byoUnresolvedSummary(e)}`);
  }
  return lines;
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
  /**
   * True when tool steps were RECOVERED from durable history but no `llm` turn
   * covers them — i.e. the chat predates durable turn records (or was reopened),
   * so the turn/token figures describe only this session while the tool figures
   * describe the whole conversation. Reported so the two aren't read as one run's
   * totals: "Turns: 2 · Tool calls: 44" is nonsense unless the mismatch is named.
   */
  turnCoveragePartial: boolean;
  /**
   * Best-effort verdict — the header a triager reads first. `healthy` is distinct
   * from `inconclusive`: the former means there is no failure to explain, the
   * latter that there IS one but the signals don't separate A from B. Collapsing
   * both into "inconclusive" made a clean run read as an unsolved problem.
   */
  likelyCause: 'context-exhaustion' | 'model-degradation' | 'inconclusive' | 'healthy';
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

  // Coverage check. Tool steps are persisted durably; `llm` turns only became so
  // later — so a chat from before that (or one reopened mid-run) recovers its tool
  // chain from history with no turns to match. Reporting both as one run's totals
  // is how "Turns: 2 · Tool calls: 44" happens.
  const recoveredToolEvents = toolEvents.filter((e) => e.recovered).length;
  const recoveredTurns = llm.filter((e) => e.recovered).length;
  const turnCoveragePartial = recoveredToolEvents > 0 && recoveredTurns === 0;

  // Verdict. Context-exhaustion signals: big prompt tokens, truncated tool
  // results, or a model downgrade/length-finish. Degradation signals: an
  // Evermind model answered, tokens stayed low, and a turn was empty/failed.
  const contextSignal =
    promptTokenPeak >= 24_000 || truncatedToolResults > 0 || downgradeEvents > 0 ||
    (largestToolResult != null && largestToolResult.bytes >= 20_000);
  const degradationSignal =
    evermindUsed.length > 0 && emptyOrLengthFinishes > 0 &&
    (!tokensMeasured || promptTokenPeak < 24_000) && truncatedToolResults === 0;
  // Nothing went wrong: no errors, no aborted loop, no truncated/empty turn, and
  // no context pressure. There is no failure to attribute — say so rather than
  // implying an unresolved one. (A run that did NOTHING is not evidence of health,
  // so require it to have actually produced work.)
  const didWork = toolEvents.length > 0 || completionTokenTotal > 0 || llm.length > 0;
  const healthy =
    errors.length === 0 && !loopExhausted && emptyOrLengthFinishes === 0 && !contextSignal && didWork;
  const likelyCause: BrainDiagnostics['likelyCause'] =
    contextSignal && !degradationSignal ? 'context-exhaustion'
      : degradationSignal && !contextSignal ? 'model-degradation'
        : healthy ? 'healthy'
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
    turnCoveragePartial,
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
        : d.likelyCause === 'healthy'
          ? 'No failure signal — no errors, no truncated or empty turns, and no context pressure. Nothing here needs triaging.'
          : 'Inconclusive — not enough signal to separate context exhaustion from model degradation.';

  const lines: string[] = ['--- Diagnostics ---', `Likely cause: ${verdict}`];
  // When the turn/token figures cover only THIS session while the tool figures
  // cover the whole conversation, say so on the line itself — read together
  // without it, "Turns: 2 · Tool calls: 44" looks like corrupt data.
  const scope = d.turnCoveragePartial ? ' (this session)' : '';
  lines.push(`Turns${scope}: ${d.turns} · Tool calls: ${d.toolCalls} · Errors: ${d.errors}${d.loopExhausted ? ' · LOOP EXHAUSTED' : ''}`);
  if (d.tokensMeasured) {
    lines.push(
      `Tokens${scope}: prompt peak ${d.promptTokenPeak.toLocaleString()} · last-turn prompt ${d.lastPromptTokens.toLocaleString()} · completion total ${d.completionTokenTotal.toLocaleString()}`,
    );
  } else {
    lines.push('Tokens: not reported by the gateway for this run.');
  }
  if (d.turnCoveragePartial) {
    lines.push(
      'Coverage: tool steps were recovered from this chat\'s durable history, but its earlier TURNS predate durable turn records — so the turn and token counts above describe only the current session, not the whole conversation. Send a new turn to capture a fully-measured run.',
    );
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
  /** Where the run happened (e.g. `VS Code (VSIX)` / `Web`), for provenance. */
  surface?: string;
  /** The current top-level error surfaced to the user, if any. */
  error?: string;
}

/**
 * Assemble the Brain triage report. Same shape as the host/cloud report:
 * header → errors-first → full event log → derived log lines → transcript.
 */
export function buildBrainTriageReport(opts: BuildBrainTriageOptions): string {
  const { capturedAt, messages = [], chatId, chatTitle, agentLabel, configuredModel, surface, error } = opts;
  // The caller's `events` are the LIVE trace, which only covers the current
  // session — a reopened or resumed chat holds none of the earlier run's steps in
  // memory, only their durable `role:'tool'` rows. Merging them back in is what
  // stops the report claiming `Tool calls: 0` for a run that made twenty.
  const events = traceWithPersistedSteps(messages, opts.events);
  const errors = events.filter((e) => e.isError || e.category === 'error');
  const lines: string[] = [];

  lines.push('=== BuilderForce Brain Triage ===');
  lines.push(`Captured:  ${capturedAt}`);
  if (chatId != null) lines.push(`Chat:      #${chatId}${chatTitle ? ` — ${chatTitle}` : ''}`);
  lines.push(`Brain:     ${agentLabel || 'Brain (default)'}`);
  // Model + account provenance (surface, configured vs actual model, which account
  // served it, any connected account left unused) — the SHARED formatter, so this
  // report and the VS Code transcript agree line-for-line.
  lines.push(...formatBrainProvenance(events, { configuredModel, surface }));
  lines.push(`Steps: ${events.length} · Errors: ${errors.length} · Messages: ${messages.length}`);
  if (error) lines.push(`Last error: ${error}`);

  // Diagnostics block — the A-vs-B verdict + the token/tool-payload/downgrade
  // numbers behind it. Same builder the VS Code transcript uses.
  lines.push('', ...formatBrainDiagnostics(computeBrainDiagnostics(events, configuredModel)));

  // Structural honesty flag — a "saved the file" claim with no successful file-write
  // tool call this run (the "it said it updated the file but didn't" failure mode).
  if (detectUnbackedWriteClaim(events, messages)) {
    lines.push('', '⚠ UNBACKED WRITE CLAIM — an assistant turn claimed it saved/updated a file, but no file-write tool (attachments.write / project_files.save) succeeded in this run. The file was NOT modified.');
  }
  if (detectUnbackedTicketClaim(events, messages)) {
    lines.push('', '⚠ UNBACKED TICKET CLAIM — an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.');
  }

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
