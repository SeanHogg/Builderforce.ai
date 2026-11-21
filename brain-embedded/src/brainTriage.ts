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

import { announcesUntakenAction } from '@builderforce/agent-stall';
import { turnInterruption } from './finishReason';
import type { StreamFailureDetail } from './streamFailureDetail';
import type { BrainMessage } from './types';
import { isModelReply } from './modelReply';
import { traceWithPersistedSteps } from './persistedSteps';
import { computeRunProgress, type RunProgress } from './runProgress';
import { spunEarlier } from './runProgressReport';
import { modelScorecard, modelTurnLog, type ModelScore, type ModelTurn } from './modelScorecard';
import { routingByRole, type RoutingByRole } from './routingByRole';
import { sessionShippedInTrace, staffingSummaryInTrace, type StaffingSummary } from './staffingSummary';
import { parseMessageProvenance } from './provenance';
import { STOPPED_TURN_STEP } from './stoppedTurn';
import { isCodeChangeTool } from './localWorkspaceTools';
import { LOCAL_TICKET_CREATE_LABEL } from './ticketToolVocabulary';
import { READ_FILE_TOOL } from './toolResultBudget';
import { midRunNotice, type BrainRunActivity } from './runActivity';
import { providerFailureInTrace, type ProviderFailureFinding } from './providerFailureCause';
import {
  CONTEXT_PROMPT_PEAK,
  LARGE_LOSSY_RESULT_BYTES,
  decideLikelyCause,
  isHealthyRun,
  recoveredFailuresInTrace,
  type LikelyCause,
} from './brainVerdict';
import { formatBrainDiagnostics } from './brainDiagnosticsText';
import { isFailedToolResult } from './toolFailure';

// Lives in the leaf `toolFailure.ts` (no import cycles); re-exported for existing callers.
export { isFailedToolResult };

// The report TEXT lives in `brainDiagnosticsText.ts`; re-exported so this stays the one import.
export { formatBrainDiagnostics };
// Moved to `staffingSummary.ts` beside the staffing verdict that reads it; re-exported for callers.
export { sessionShippedInTrace };

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

/** Tool labels that PERSIST a file/attachment change. A "saved the file" claim is
 *  only honest if one of these SUCCEEDED this run. Covers the client manifest
 *  (`project_files.save`) and the gateway builtin catalog (`attachments.write`,
 *  advertised `builtin_attachments_write` / `builtin_project_files_save`). The IDE's
 *  own workspace writers (`write_file` / `edit_file`) are {@link isCodeChangeTool}. */
const FILE_WRITE_TOOL = /(attachments|files?|project_files)[._](write|save|update)/i;

/** Did this tool call persist a file — an IDE workspace write or a gateway save? */
function isFileWriteTool(label: string): boolean {
  return isCodeChangeTool(label) || FILE_WRITE_TOOL.test(label);
}

/** THE honesty-flag lines, shared by every copy surface so they cannot drift apart. */
export const UNBACKED_WRITE_CLAIM_NOTICE =
  '⚠ UNBACKED WRITE CLAIM — an assistant turn claimed it saved/updated a file, but no file-write tool (write_file / edit_file / attachments.write / project_files.save) succeeded in this run. The file was NOT modified.';
export const UNBACKED_TICKET_CLAIM_NOTICE =
  '⚠ UNBACKED TICKET CLAIM — an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.';

/** Assistant prose that CLAIMS a file/attachment was persisted. */
const FILE_SAVE_CLAIM = /\b(saved|updated|wrote|written|edited|persisted|added)\b[^.!?\n]*\b(file|attachment|roadmap|document|upload|\.md|\.csv|\.txt|\.json)\b/i;

/** Tool labels that CREATE or LINK a board work item. A "filed/created/linked the
 *  ticket" claim is only honest if one of these SUCCEEDED this run. Covers the create
 *  tools (tasks/objectives/specs/…) and the chat-link + from-delta tools. */
const TICKET_WRITE_TOOL = new RegExp(
  `(tasks|objectives|key_results|initiatives|portfolios|specs|roadmap)[._]create|chats[._]link_ticket|tickets[._]from_delta|${LOCAL_TICKET_CREATE_LABEL.source}`,
  'i',
);

/** Assistant prose that CLAIMS a ticket/gap/task was created, filed, or linked. */
const TICKET_CLAIM = /\b(created|filed|opened|logged|added|linked|tracked)\b[^.!?\n]*\b(ticket|task|gap|epic|issue|objective|bug|card|board)\b/i;

/** Did this tool call FILE board work (create or link)? THE predicate — the honesty check
 *  below and `staffingSummary.ts` both read it, so "what counts as filing work" is one list. */
export function isTicketWriteTool(label: string): boolean {
  return TICKET_WRITE_TOOL.test(label);
}

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
    (e) => e.category === 'tool' && isFileWriteTool(e.label) && !e.isError && !isFailedToolResult(e.result),
  );
  if (wroteOk) return false;
  return messages.some((m) => isModelReply(m) && typeof m.content === 'string' && FILE_SAVE_CLAIM.test(m.content));
}

/**
 * The ticket twin of {@link detectUnbackedWriteClaim}: an assistant turn that CLAIMS it
 * created/filed/linked a ticket, gap, or task while NO create/link tool call succeeded
 * this run — the "it said it linked the gap to the chat, but the chat shows no link"
 * failure. A REAL create links its own chat in the same call (the host stamps the chat
 * and the server — or the editor's local store — links it), so a claim with no
 * successful create/link tool means nothing was actually filed or linked. Pure over the recorded trace + visible messages, so both copy surfaces flag
 * it identically.
 */
export function detectUnbackedTicketClaim(events: BrainTraceEvent[], messages: BrainMessage[]): boolean {
  const filedOk = events.some(
    (e) => e.category === 'tool' && isTicketWriteTool(e.label) && !e.isError && !isFailedToolResult(e.result),
  );
  if (filedOk) return false;
  return messages.some((m) => isModelReply(m) && typeof m.content === 'string' && TICKET_CLAIM.test(m.content));
}

/**
 * The "it doesn't execute, it just dies" signature: an assistant turn that NARRATES a
 * tool call — announcing it in prose, or writing the bare call as text — while the run
 * recorded ZERO tool steps.
 *
 * This is a model fault, not a user one: the agent loop only runs structured
 * `toolCalls` (plus the inline dialects `xmlToolCalls` lifts), so a model that writes
 * its intent as plain text achieves nothing. Without this detector the triage block
 * scores such a run "healthy" (no errors, no truncation, no context pressure), which
 * is exactly backwards.
 *
 * Deliberately reuses `announcesUntakenAction` — the SAME detector the run loop gates
 * its stall recovery on. Diagnostics that disagreed with the loop about what counts as
 * a stall would be worse than none: a report could call a run healthy while the loop
 * had spent three recovery turns on it.
 *
 * Pure over the merged trace + visible messages, so both copy surfaces flag it
 * identically.
 */
export function detectAnnouncedButUnmadeToolCall(events: BrainTraceEvent[], messages: BrainMessage[]): boolean {
  if (events.some((e) => e.category === 'tool')) return false;
  return messages.some(
    (m) => isModelReply(m) && typeof m.content === 'string' && announcesUntakenAction(m.content),
  );
}

/**
 * The loop's own self-diagnosis steps, by label. These are what turn "nine turns, zero
 * tool calls" from a mystery into a narrative: the loop SAW the stall, re-prompted, and
 * (optionally) switched models. They are persisted durably by the run store, so a
 * reopened chat still reports them.
 */
const LOOP_STEP = {
  recovery: 'loop.recover_announced_tool_call',
  failover: 'loop.model_failover',
  unrecovered: 'loop.stall_unrecovered',
} as const;

/** How many times this run re-prompted a model that announced a call without making one. */
export function stallRecoveriesInTrace(events: BrainTraceEvent[]): number {
  return events.filter((e) => e.label === LOOP_STEP.recovery).length;
}

/** How many times this run switched MODELS because one wouldn't emit tool calls. */
export function modelFailoversInTrace(events: BrainTraceEvent[]): number {
  return events.filter((e) => e.label === LOOP_STEP.failover).length;
}

/** True when the stall survived every recovery AND every failover this run. */
export function stallUnrecoveredInTrace(events: BrainTraceEvent[]): boolean {
  return events.some((e) => e.label === LOOP_STEP.unrecovered);
}

/**
 * True when a re-prompt actually WORKED: a tool step ran after the last one.
 *
 * "Not given up" is not the same fact. The loop only records `stall_unrecovered` when a
 * stall survives the whole budget; a model whose last narration slips past the stall
 * detector ends the run as a "final answer" with budget to spare. Chat #105 did exactly
 * that — two re-prompts, zero tool calls — and the report said "recovered".
 */
export function stallRecoveredInTrace(events: BrainTraceEvent[]): boolean {
  let lastRecovery = -1;
  events.forEach((e, i) => { if (e.label === LOOP_STEP.recovery) lastRecovery = i; });
  return lastRecovery >= 0 && events.slice(lastRecovery + 1).some((e) => e.category === 'tool');
}

/** Models whose stream broke mid-turn (a loop, a dropped connection) and whose turn was retried on another. */
export function streamRetriesInTrace(events: BrainTraceEvent[]): string[] {
  return events
    .filter((e) => e.label === 'llm.stream_interrupted')
    .map((e) => {
      const model = (e.args as { model?: unknown } | undefined)?.model;
      return typeof model === 'string' && model ? model : 'unknown model';
    });
}

/**
 * Tool-catalog exposure (`ToolExposure` / `toolExposureInTrace`) is extracted to its
 * own module (`toolExposure.ts`, PRD 45 §4.7 B8 — chat #216: the "Tools advertised"
 * counter must read the trace, not the registry ceiling). Re-exported here so
 * existing import sites keep working.
 */
import { toolExposureInTrace } from './toolExposure';

export { toolExposureInTrace, type ToolExposure } from './toolExposure';

/**
 * Tools the model WROTE OUT by name on a turn that made no call, which it had never been
 * advertised — recorded per-turn by the run loop (only it holds both halves).
 *
 * This is the signal that separates two failures the old report collapsed into one
 * "the model won't emit tool calls, try another":
 *   - the model narrated a tool it COULD see  ⇒ genuinely a model/provider fault;
 *   - the model narrated a tool it could NOT see ⇒ our per-turn tool selection dropped
 *     the tool the prompt told it to call, and no model can emit a call for a function
 *     it was never given. Swapping models does nothing.
 * De-duplicated, first-seen order.
 */
export function narratedUnadvertisedInTrace(events: BrainTraceEvent[]): string[] {
  const seen: string[] = [];
  for (const ev of events) {
    const raw = (ev.args as { narratedUnadvertised?: unknown } | undefined)?.narratedUnadvertised;
    if (!Array.isArray(raw)) continue;
    for (const n of raw) {
      if (typeof n === 'string' && n && !seen.includes(n)) seen.push(n);
    }
  }
  return seen;
}

/**
 * A TOOL turn the model answered IN PROSE with zero tool calls: the turn was handed
 * tools, wanted one, but replied with text instead of a structured call — and nothing
 * downstream ran. Recorded per-turn by the run loop as `answeredInProse` (only it holds
 * both the turn's text and the exact tool set it was offered).
 *
 * This is the turn-level twin of {@link narratedUnadvertisedInTrace}: that one names a
 * tool the selection dropped (our fault), while this one flags a turn that HAD tools and
 * still answered in prose (a model/provider fault — the model is describing work instead
 * of doing it). A run made of these used to score "healthy": no errors, no truncation,
 * no context pressure — while accomplishing nothing.
 */
export function answeredInProseInTrace(events: BrainTraceEvent[]): boolean {
  return events.some(
    (ev) => (ev.args as { answeredInProse?: unknown } | undefined)?.answeredInProse === true,
  );
}

/** One turn the memory-first short-circuit answered — the LLM was never called. */
export interface MemoryAnsweredTurn {
  /** `evermind` = the project's SSM GENERATED the reply; `qa-cache` = a stored answer was replayed;
   *  `symbol-index` = the host answered "where is X defined?" from its definition index;
   *  `deterministic` = another PreFetch ANSWER action (named by {@link actionId}). */
  source: 'evermind' | 'qa-cache' | 'symbol-index' | 'deterministic';
  /** The PreFetch action that answered (`deterministic` source only). */
  actionId?: string;
  /** Evermind head version that served it (evermind source only). */
  version?: number;
  /** WHICH project's Evermind served it — a project can target several heads. */
  projectId?: number;
}

/** The PreFetch action that answers "where is X defined?" from the symbol index. */
const SYMBOL_ANSWER_ACTION = 'symbols.where-defined';

/**
 * Turns the memory-first short-circuit answered, taken from the run loop's own
 * `evermind.answer` / `memory.answer` recall steps (`result.skippedLlm`).
 *
 * Without this the report is actively MISLEADING: a memory-answered turn has zero
 * `llm` turns and zero tool steps, which reads exactly like "the model refused to
 * emit tool calls" — and the prescribed remedy ("try a different model") cannot
 * help, because no model ran. Naming it turns an unexplained blank run into the
 * one-line answer: memory replied instead of the model.
 */
export function memoryAnswersInTrace(events: BrainTraceEvent[]): MemoryAnsweredTurn[] {
  const out: MemoryAnsweredTurn[] = [];
  for (const ev of events) {
    if (ev.category !== 'recall') continue;
    const r = ev.result as { source?: unknown; skippedLlm?: unknown; version?: unknown; evermindProjectId?: unknown; route?: unknown } | undefined;
    // A PreFetch ANSWER (`prefetchGate.ts`) is labelled with its action id and carries `route`.
    const prefetched = r?.route === 'answer';
    if (!prefetched && ev.label !== 'evermind.answer' && ev.label !== 'memory.answer' && ev.label !== 'symbols.answer') continue;
    if (r?.skippedLlm !== true) continue;
    const symbolIndex = r.source === 'symbol-index' || r.source === SYMBOL_ANSWER_ACTION;
    out.push({
      source: r.source === 'evermind' ? 'evermind' : symbolIndex ? 'symbol-index' : prefetched ? 'deterministic' : 'qa-cache',
      ...(prefetched && !symbolIndex && typeof r.source === 'string' ? { actionId: r.source } : {}),
      ...(typeof r.version === 'number' ? { version: r.version } : {}),
      ...(typeof r.evermindProjectId === 'number' ? { projectId: r.evermindProjectId } : {}),
    });
  }
  return out;
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
 * dropped so it never masquerades as a real model id. A user Stop counts too: the
 * model it cut off streamed, even though that turn never completed.
 */
export function modelsUsedInTrace(events: BrainTraceEvent[]): string[] {
  const seen: string[] = [];
  for (const ev of events) {
    if (ev.category !== 'llm' && ev.category !== 'error' && ev.label !== STOPPED_TURN_STEP) continue;
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
    case 'unsupported-auth':
      return 'it is stored as a subscription (OAuth) but this provider only supports an API key — re-connect it with an API key under Settings ▸ API Keys';
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
/**
 * The remediation for a role-gate refusal, stated once here so the report and every
 * surface agree on the advice.
 */
export const ROLE_GATE_REMEDIATION =
  'Re-select the workspace or ask a manager to raise your role.';

/**
 * Parse a `BuiltinToolForbiddenError` message — the API's role gate for mutating
 * built-in tools throws exactly one shape
 * (`'tasks.create' changes workspace data and requires at least the 'developer' role (caller has 'contributor')`
 * — `api/.../builtinToolAuthority.ts`), but nothing about it was STRUCTURED, so a run
 * that died on a role gate read as an unexplained refusal. Returns both roles, or nulls
 * for any other message — a parser that guesses on unrelated text manufactures causes.
 */
export function parseRoleGateRefusal(message: string | null | undefined): {
  requiredRole: string | null;
  callerRole: string | null;
} {
  const m = typeof message === 'string'
    ? message.match(/requires at least the '([^']+)' role \(caller has '([^']+)'\)/)
    : null;
  return { requiredRole: m?.[1] ?? null, callerRole: m?.[2] ?? null };
}

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
  /** Count of tool results trimmed to the per-result budget before hitting the model —
   *  LOSSY cuts only; a paged `read_file` window is counted in {@link pagedReadWindows}.
   *  A trim is the budget WORKING: it is evidence of pressure, never of a failure. */
  truncatedToolResults: number;
  /** `read_file` results handed over as one window of a larger file, with the offset
   *  that continues it. The budget working as designed, not lost context. */
  pagedReadWindows: number;
  /** The single largest tool result (label + pre-trim bytes). */
  largestToolResult: { label: string; bytes: number } | null;
  /**
   * The steps that FAILED, most recent first — label plus the message the tool
   * actually returned. `Errors: 1` on its own tells a reader that something went
   * wrong and nothing about what, so the only way to act on it was to scroll the
   * whole transcript hunting for the failure. Capped, because a run that fails
   * repeatedly should not push everything else out of the report.
   */
  errorSteps: { label: string; message: string; model?: string; failure?: StreamFailureDetail; requiredRole?: string; callerRole?: string; remediation?: string; recovered?: boolean }[];
  /** Of `errors`, the failed tool steps a later success on the same target recovered — see `brainVerdict.ts`. */
  recoveredFailures: number;
  /** True when the run was still executing at capture — the verdict is then `run-in-progress`. */
  running: boolean;
  /** Distinct models that actually answered, first-seen order. */
  modelsUsed: string[];
  /** What each of those models did with the turns it served — see `modelScorecard.ts`. */
  modelScores: ModelScore[];
  /** Each `llm.complete` in run order — which model produced which output. */
  modelTurns: ModelTurn[];
  /** Which model served each role, and how analysis ended — see `routingByRole.ts`. */
  routing?: RoutingByRole;
  /** Distinct Evermind/SSM artifacts among them. */
  evermindUsed: string[];
  /** Turns where the resolved model differed from what was requested. */
  downgradeEvents: number;
  /** Turns that ended on `length` or produced empty text. */
  emptyOrLengthFinishes: number;
  /**
   * True when a turn NARRATED a tool call ("I'll call the tool…", `builtin_…`) while
   * the run made none — the model isn't emitting structured `toolCalls`, so nothing
   * ever executes. See {@link detectAnnouncedButUnmadeToolCall}.
   */
  announcedUnmadeToolCall: boolean;
  /** How many times the loop re-prompted a model that announced a call without making one. */
  stallRecoveries: number;
  /** How many times the loop switched MODELS after one burned its whole stall budget. */
  modelFailovers: number;
  /** True when the stall survived every recovery and every failover — the run gave up. */
  stallUnrecovered: boolean;
  /** A tool step ran after the last re-prompt — see {@link stallRecoveredInTrace}. */
  stallRecovered: boolean;
  /** Models whose stream broke mid-turn and were retried on another — see {@link streamRetriesInTrace}. */
  streamRetries: string[];
  /** How many tools the model was offered on the last measured turn (null ⇒ not recorded). */
  advertisedToolsLastTurn: number | null;
  /** Fewest tools offered on any measured turn — a 0 explains a whole run by itself. */
  advertisedToolsMin: number | null;
  /** Size of the registered catalog the per-turn selection drew from. */
  catalogTools: number | null;
  /**
   * Tools the model named in prose on a call-less turn that it was never advertised.
   * Non-empty means the request was impossible as framed — see
   * {@link narratedUnadvertisedInTrace}.
   */
  narratedUnadvertisedTools: string[];
  /**
   * True when at least one TOOL turn was handed tools but answered IN PROSE with zero
   * tool calls — the model described the work instead of doing it, and nothing ran.
   * A run made only of these used to score "healthy" (no errors, no truncation, no
   * pressure) while accomplishing nothing. See {@link answeredInProseInTrace}.
   */
  answeredInProse: boolean;
  /**
   * Turns the memory-first short-circuit answered WITHOUT calling a model (see
   * {@link memoryAnswersInTrace}). A run made only of these has no turns, no tokens
   * and no tool calls — the exact shape of a "the model won't call tools" run, which
   * is why it must be named rather than left to inference.
   */
  memoryAnswers: MemoryAnsweredTurn[];
  /**
   * True when tool steps were RECOVERED from durable history but no `llm` turn
   * covers them — i.e. the chat predates durable turn records (or was reopened),
   * so the turn/token figures describe only this session while the tool figures
   * describe the whole conversation. Reported so the two aren't read as one run's
   * totals: "Turns: 2 · Tool calls: 44" is nonsense unless the mismatch is named.
   */
  turnCoveragePartial: boolean;
  /**
   * Repetition / reach / effect / timing for the run — see `runProgress.ts`. This
   * is what separates "every turn succeeded and nothing got done" from a genuine
   * context or model failure, and it is the only signal that fires on the most
   * common real-world stall: an agent re-reading one file until its budget is gone.
   */
  progress: RunProgress;
  /**
   * The run showed context PRESSURE (a big prompt, trimmed tool results) but nothing was
   * cut short by it — no truncated turn, no downgrade, no exhausted loop, no failed
   * completion. Reported as an advisory line so the numbers are still visible, while the
   * verdict stays whatever the rest of the run says (usually `healthy`).
   */
  contextPressureOnly: boolean;
  /**
   * What this run FILED versus what it STAFFED — see `staffingSummary.ts`. The signal
   * that separates "twelve tickets and a hundred green tool calls" from "somebody is
   * actually working on it": every other field here can read clean on a run that left
   * every ticket it created with nobody on it.
   */
  staffing: StaffingSummary;
  /**
   * Successful writes, commits and pushes this session made itself. A non-zero count
   * means "0 dispatched" is not "nobody is running the work" — the session did it.
   */
  sessionShipped: number;
  /** Evermind + project-facts usage recorded in the trace. See {@link memoryUsageInTrace}. */
  memoryUsage: MemoryUsageSummary;
  /**
   * Build/runtime failures the run's LAST diagnostics read still reported — the app the
   * run was working on was broken when it stopped looking. 0 when no read reported any,
   * or a later read came back clean. See {@link unresolvedAppFailuresInTrace}.
   */
  unresolvedAppFailures: number;
  /** The LATEST run's last completion failed and was not recovered (`providerFailureCause.ts`); null when it did not. */
  providerFailure: ProviderFailureFinding | null;
  /** Best-effort verdict — the header a triager reads first. Ordering: `brainVerdict.ts`. */
  likelyCause: LikelyCause;
}

/**
 * How many build/runtime failures the run's LAST diagnostics read reported.
 *
 * Chat #129 triaged "No failure signal … Nothing here needs triaging" over a run whose
 * `canvas_read_build_diagnostics` had just answered `failures: 6` — the user's app was
 * throwing on render, the model had rewritten the same file twice to fix it, and the
 * report called it healthy because every TOOL CALL had succeeded. A diagnostics read
 * that succeeds in reporting a broken app is not a tool error, so `errors` never saw it.
 *
 * Read by the result's SHAPE (`{ failures: number }` alongside a `report` or a clean
 * zero), not a tool name, so any host's diagnostics tool counts. Only the last read
 * matters: a later clean one means the run fixed what the earlier one found.
 */
export function unresolvedAppFailuresInTrace(events: BrainTraceEvent[]): number {
  let last = 0;
  for (const ev of events) {
    if (ev.category !== 'tool' || ev.isError) continue;
    const r = ev.result;
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const o = r as { failures?: unknown; report?: unknown };
    if (typeof o.failures !== 'number') continue;
    if (o.failures > 0 && typeof o.report !== 'string') continue;
    last = o.failures;
  }
  return last;
}

/** How many failing steps the report names before it stops listing them. */
const MAX_REPORTED_ERRORS = 5;

/** Longest error message quoted per failing step. */
const MAX_ERROR_CHARS = 240;

/**
 * The message a failed step actually returned. Tool failures carry it as
 * `{ error }` or `{ ok: false, output }`; a thrown step puts it straight in
 * `result`. Falls back to a compact serialization so a failure is never reported
 * as an empty string.
 */
function errorMessageOf(e: BrainTraceEvent): string {
  const r = e.result;
  let text: string;
  if (typeof r === 'string') text = r;
  else if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    text = typeof o.error === 'string' && o.error
      ? o.error
      : typeof o.output === 'string' && o.output
        ? o.output
        : JSON.stringify(r);
  } else text = String(r ?? '(no message)');
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_ERROR_CHARS ? `${flat.slice(0, MAX_ERROR_CHARS)}…` : flat || '(no message)';
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
 *
 * `messages` is the visible conversation. It is optional only so older callers keep
 * compiling; without it the narrated-tool-call verdict can't be reached, so every
 * surface should pass it.
 */
export interface BrainDiagnosticsContext {
  /**
   * True when the run was STILL EXECUTING at the moment the report was captured.
   * The trace cannot know this — it only holds settled steps — yet it changes how
   * every "and then nothing happened" signal should be read: a run captured
   * mid-flight has not failed to write the file, it has not reached the write yet.
   * Without it, copying a report while the agent is working reports the agent as
   * broken.
   */
  running?: boolean;
}

/** What this run asked of BuilderForce memory, from the trace — not the project's inventory. */
export interface MemoryUsageSummary {
  /** Evermind recall steps, including a recorded miss (count 0). */
  evermindRecalls: number;
  /** Items those recalls returned. */
  evermindItems: number;
  /** Prompt tokens the injected recall block added, when the step recorded them. */
  evermindPromptTokens: number;
  learnSteps: number;
  reconcileSteps: number;
  /** `recall_facts` calls — the shared project-facts store. */
  factsRead: number;
  /** `remember_fact` calls. */
  factsWritten: number;
}

const MEMORY_READ_TOOLS = new Set(['recall_facts', 'builtin_recall_facts']);
const MEMORY_WRITE_TOOLS = new Set(['remember_fact', 'builtin_remember_fact']);

export function memoryUsageInTrace(events: BrainTraceEvent[]): MemoryUsageSummary {
  const out: MemoryUsageSummary = {
    evermindRecalls: 0,
    evermindItems: 0,
    evermindPromptTokens: 0,
    learnSteps: 0,
    reconcileSteps: 0,
    factsRead: 0,
    factsWritten: 0,
  };
  for (const ev of events) {
    if (ev.category === 'recall' && ev.label === 'evermind.recall') {
      out.evermindRecalls += 1;
      const result = ev.result;
      if (result && typeof result === 'object') {
        const count = (result as { count?: unknown }).count;
        if (typeof count === 'number') out.evermindItems += count;
        const tokens = (result as { blockTokens?: unknown }).blockTokens;
        if (typeof tokens === 'number') out.evermindPromptTokens += tokens;
      }
    } else if (ev.category === 'learn') {
      out.learnSteps += 1;
    } else if (ev.category === 'reconcile') {
      out.reconcileSteps += 1;
    } else if (ev.category === 'tool' && !ev.isError && !isFailedToolResult(ev.result)) {
      if (MEMORY_READ_TOOLS.has(ev.label)) out.factsRead += 1;
      if (MEMORY_WRITE_TOOLS.has(ev.label)) out.factsWritten += 1;
    }
  }
  return out;
}

export function formatMemoryUsage(m: MemoryUsageSummary): string {
  const used = m.evermindRecalls + m.learnSteps + m.reconcileSteps + m.factsRead + m.factsWritten;
  if (used === 0) {
    return 'BuilderForce memory: none recorded in this run — no Evermind recall step, no learn/reconcile, no recall_facts/remember_fact. A recall the loop did not trace is indistinguishable from one that never ran.';
  }
  const tok = m.evermindPromptTokens > 0 ? `, ~${m.evermindPromptTokens.toLocaleString('en-US')} prompt tok` : '';
  return (
    `BuilderForce memory: Evermind recalls ${m.evermindRecalls} (${m.evermindItems} item(s)${tok})`
    + ` · learn steps ${m.learnSteps} · reconcile ${m.reconcileSteps}`
    + ` · project-fact reads ${m.factsRead} · project-fact writes ${m.factsWritten}`
  );
}

export function computeBrainDiagnostics(
  events: BrainTraceEvent[],
  requestedModel?: string,
  messages: BrainMessage[] = [],
  ctx: BrainDiagnosticsContext = {},
): BrainDiagnostics {
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
    const emptyText = typeof ev.textChars === 'number' && ev.textChars === 0;
    // A "no-op" turn (empty text but tool calls requested) is normal; only count
    // a turn as degenerate when the model was INTERRUPTED — truncated by the output
    // ceiling, or its tool call was unparseable — or it produced nothing AND asked
    // for no tools. Interruption is read through the shared classifier so a vendor
    // that spells truncation `max_tokens` is not counted as a healthy turn.
    const toolCallsThisTurn = (ev.args as { toolCalls?: unknown } | undefined)?.toolCalls;
    const askedNoTools = typeof toolCallsThisTurn === 'number' ? toolCallsThisTurn === 0 : true;
    if (turnInterruption(ev.finishReason) || (emptyText && askedNoTools)) emptyOrLengthFinishes += 1;
    // A DOWNGRADE is the gateway answering with a model we did not ask for on THAT
    // turn — a context-exhaustion symptom. Compare against the per-turn
    // `requestedModel` the loop records, not the run's original ask: when the loop
    // deliberately fails over (a model that would not emit tool calls), every
    // subsequent turn differs from the original ask and used to be counted as a
    // silent gateway downgrade — so a run the loop successfully RESCUED reported
    // "likely context exhaustion". Falls back to the run-level ask for older traces
    // that predate the per-turn field.
    const a = ev.args as { model?: unknown; requestedModel?: unknown } | undefined;
    const asked = typeof a?.requestedModel === 'string' && a.requestedModel !== 'default'
      ? a.requestedModel
      : req;
    const resolved = a?.model;
    if (asked && typeof resolved === 'string' && resolved && resolved !== 'default' && resolved !== asked) downgradeEvents += 1;
  }

  let toolResultBytes = 0;
  let truncatedToolResults = 0;
  let pagedReadWindows = 0;
  let largestLossyResultBytes = 0;
  let largestToolResult: { label: string; bytes: number } | null = null;
  for (const ev of toolEvents) {
    const bytes = typeof ev.resultBytes === 'number' ? ev.resultBytes : byteLen(ev.result);
    toolResultBytes += bytes;
    // A `read_file` result is PAGED, not lost: the trim hands the model the exact offset
    // that continues it, and its `bytes` is the whole FILE, not what the model received.
    // Counted as truncation, every read of a large file was a context-exhaustion signal
    // ("14 truncated", "largest read_file 182 KB") on a run whose context was fine.
    const paged = ev.label === READ_FILE_TOOL;
    if (ev.truncated) {
      if (paged) pagedReadWindows += 1;
      else truncatedToolResults += 1;
    }
    if (!paged && bytes > largestLossyResultBytes) largestLossyResultBytes = bytes;
    if (!largestToolResult || bytes > largestToolResult.bytes) largestToolResult = { label: ev.label, bytes };
  }

  // WHAT failed, not just how many. Newest first: the last failure is usually the
  // one that ended the run. A failure a later retry recovered is marked as such.
  const recovered = recoveredFailuresInTrace(events);
  const errorSteps = errors
    .slice(-MAX_REPORTED_ERRORS)
    .reverse()
    .map((e) => {
      const model = (e.args as { model?: unknown } | undefined)?.model;
      const failure = (e.args as { failure?: StreamFailureDetail } | undefined)?.failure;
      const message = errorMessageOf(e);
      const gate = parseRoleGateRefusal(message);
      return {
        label: e.label,
        message,
        ...(typeof model === 'string' && model !== 'default' ? { model } : {}),
        ...(failure && typeof failure === 'object' ? { failure } : {}),
        ...(gate.requiredRole ? { requiredRole: gate.requiredRole, remediation: ROLE_GATE_REMEDIATION } : {}),
        ...(gate.callerRole ? { callerRole: gate.callerRole } : {}),
        ...(recovered.has(e) ? { recovered: true } : {}),
      };
    });

  const modelsUsed = modelsUsedInTrace(events);
  const modelScores = modelScorecard(events);
  const modelTurns = modelTurnLog(events);
  const routing = routingByRole(modelTurns, events);
  const evermindUsed = modelsUsed.filter(isEvermindModel);
  const memoryAnswers = memoryAnswersInTrace(events);

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
  // PRESSURE is what the numbers show; EXHAUSTION is pressure that cost the run
  // something. Pressure alone used to be the verdict, and it named a cause on runs
  // where nothing failed: chat #113's report opened "Likely CONTEXT EXHAUSTION (case
  // A) — the prompt peaked at 90,129 tokens; 14 tool result(s) were cut" on a turn that
  // completed, wrote the file it set out to write, and lost nothing — those 14 cuts
  // being the tool-result budget doing its job.
  const contextPressure =
    promptTokenPeak >= CONTEXT_PROMPT_PEAK || truncatedToolResults > 0 || downgradeEvents > 0 ||
    largestLossyResultBytes >= LARGE_LOSSY_RESULT_BYTES;
  // The CONSEQUENCE: a turn cut short by the output ceiling or returned empty, a
  // gateway downgrade to a smaller window, a loop that ran out of budget, or a
  // completion that failed outright. Without one of these, nothing was exhausted.
  const contextConsequence =
    emptyOrLengthFinishes > 0 || downgradeEvents > 0 || loopExhausted ||
    errors.some((e) => e.label === 'llm.complete');
  const contextSignal = contextPressure && contextConsequence;
  /** Pressure the reader should KNOW about, on a run it did not break. Reported as an
   *  advisory line, never as a verdict. */
  const contextPressureOnly = contextPressure && !contextConsequence;
  const degradationSignal =
    evermindUsed.length > 0 && emptyOrLengthFinishes > 0 &&
    (!tokensMeasured || promptTokenPeak < CONTEXT_PROMPT_PEAK) && truncatedToolResults === 0;
  // Nothing went wrong: no errors, no aborted loop, no truncated/empty turn, and
  // no context pressure. There is no failure to attribute — say so rather than
  // implying an unresolved one. (A run that did NOTHING is not evidence of health,
  // so require it to have actually produced work.)
  const didWork = toolEvents.length > 0 || completionTokenTotal > 0 || llm.length > 0;
  // A run that narrated its tool calls instead of emitting them produces NO errors,
  // NO truncation and NO context pressure — it scored "healthy" while accomplishing
  // nothing. It outranks the other verdicts because it explains the whole run.
  const announcedUnmadeToolCall = detectAnnouncedButUnmadeToolCall(events, messages);
  // How the loop responded to the stall, and what the model could actually see. These
  // three are the difference between "the model is broken" and "we handed it nothing".
  const stallRecoveries = stallRecoveriesInTrace(events);
  const modelFailovers = modelFailoversInTrace(events);
  const stallUnrecovered = stallUnrecoveredInTrace(events);
  const stallRecovered = stallRecoveredInTrace(events);
  const streamRetries = streamRetriesInTrace(events);
  const exposure = toolExposureInTrace(events);
  const narratedUnadvertisedTools = narratedUnadvertisedInTrace(events);
  // A turn that WAS offered tools but answered in prose (zero structured calls) did
  // nothing, yet reads clean on every other signal — no error, no truncation, no
  // pressure. Without this it scored "healthy" while accomplishing nothing.
  // The gate matters: a run that made its tool calls and then SUMMARISED the result in
  // prose (the normal, healthy shape — see `healthy-baseline`) also has a prose-only
  // turn, and must NOT read as a fault. Only a run that accomplished no tool work at
  // all is flagged — the same "did anything execute?" test the announced-call twin
  // (`detectAnnouncedButUnmadeToolCall`) applies.
  const answeredInProse = toolEvents.length === 0 && answeredInProseInTrace(events);
  // A turn offered ZERO tools cannot emit one. That is a configuration/catalog failure
  // (the MCP catalog fetch failed, or nothing was registered), never a model fault.
  const noToolsAdvertised = exposure.min === 0 && toolEvents.length === 0;
  // A run whose ONLY turn came from memory never called a model at all. Every
  // model-fault verdict below is inapplicable to it (there is no model to blame and
  // no tool call it could have emitted), so this outranks them — but only when NO
  // llm turn ran, so a run that answered from memory once and used the model for the
  // rest still gets triaged on its real turns.
  const memoryOnlyRun = memoryAnswers.length > 0 && llm.length === 0;
  // Repetition / reach / effect / timing. A run can clear every signal above and
  // still have accomplished nothing by re-reading the same file until its budget
  // was gone — see `runProgress.ts`. A run captured mid-flight is exempt from the
  // "no effect" half: it has not declined to act, it is still acting.
  const progress = computeRunProgress(events, messages);
  // The picture is the LATEST run's; an earlier run of the chat that spun is still the finding (`runSlices.ts`).
  const noProgress = progress.spinning || spunEarlier(progress) !== null || (progress.noEffect && !ctx.running);
  // Filed versus staffed — the outcome question no other signal here asks.
  const staffing = staffingSummaryInTrace(events);
  const sessionShipped = sessionShippedInTrace(events);
  const memoryUsage = memoryUsageInTrace(events);
  // A session that wrote and shipped the change is not an unstaffed ticket. Filing
  // tickets and then doing the work locally is the editor path, not a stuck board.
  const workFiledNotStaffed =
    sessionShipped === 0
    && (staffing.verdict === 'filed-not-staffed' || staffing.verdict === 'staffing-refused');
  const unresolvedAppFailures = unresolvedAppFailuresInTrace(events);
  const running = ctx.running === true;
  // The latest run ENDED on the provider (a failed completion it did not recover from) — never read as a tool-exposure fault.
  const providerFailure = running ? null : providerFailureInTrace(events, messages);
  const likelyCause = decideLikelyCause({
    running,
    memoryOnlyRun,
    providerFailure: providerFailure !== null,
    noToolsAdvertised,
    narratedUnadvertised: narratedUnadvertisedTools.length > 0,
    announcedUnmadeToolCall,
    answeredInProse,
    noProgress,
    contextSignal,
    degradationSignal,
    unresolvedAppFailures,
    workFiledNotStaffed,
    healthy: isHealthyRun({
      errors: errors.length,
      recoveredFailures: recovered.size,
      loopExhausted,
      emptyOrLengthFinishes,
      contextSignal,
      announcedUnmadeToolCall,
      answeredInProse,
      noProgress,
      unresolvedAppFailures,
      didWork,
    }),
  });

  return {
    turns: llm.length,
    toolCalls: toolEvents.length,
    errors: errors.length,
    errorSteps,
    recoveredFailures: recovered.size,
    running,
    loopExhausted,
    tokensMeasured,
    promptTokenPeak,
    completionTokenTotal,
    lastPromptTokens,
    toolResultBytes,
    truncatedToolResults,
    pagedReadWindows,
    largestToolResult,
    modelsUsed,
    modelScores,
    modelTurns,
    routing,
    evermindUsed,
    downgradeEvents,
    emptyOrLengthFinishes,
    announcedUnmadeToolCall,
    stallRecoveries,
    modelFailovers,
    stallUnrecovered,
    stallRecovered,
    streamRetries,
    advertisedToolsLastTurn: exposure.lastTurn,
    advertisedToolsMin: exposure.min,
    catalogTools: exposure.catalog,
    narratedUnadvertisedTools,
    answeredInProse,
    memoryAnswers,
    turnCoveragePartial,
    progress,
    contextPressureOnly,
    staffing,
    sessionShipped,
    memoryUsage,
    unresolvedAppFailures,
    providerFailure,
    likelyCause,
  };
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
  /**
   * True when the run was STILL EXECUTING at capture time. The trace cannot know it,
   * and it changes how every "and then nothing happened" signal reads: a report taken
   * mid-flight describes an UNFINISHED run, not a failed one.
   */
  running?: boolean;
  /** The in-flight step at capture time (which tool, on what, since when). */
  activity?: BrainRunActivity | null;
}

/**
 * Assemble the Brain triage report. Same shape as the host/cloud report:
 * header → errors-first → full event log → derived log lines → transcript.
 */
export function buildBrainTriageReport(opts: BuildBrainTriageOptions): string {
  const { capturedAt, messages = [], chatId, chatTitle, agentLabel, configuredModel, surface, error, running, activity } = opts;
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
  // CAPTURE STATE, stated once and up front. Without it every downward-looking signal
  // below ("no file was written") reads as a verdict on a run that had simply not got
  // there yet.
  if (running) lines.push(midRunNotice(activity, Date.parse(capturedAt)));

  // Diagnostics block — the A-vs-B verdict + the token/tool-payload/downgrade
  // numbers behind it. Same builder the VS Code transcript uses.
  lines.push('', ...formatBrainDiagnostics(computeBrainDiagnostics(events, configuredModel, messages, { running })));

  // Structural honesty flag — a "saved the file" claim with no successful file-write
  // tool call this run (the "it said it updated the file but didn't" failure mode).
  if (detectUnbackedWriteClaim(events, messages)) lines.push('', UNBACKED_WRITE_CLAIM_NOTICE);
  if (detectUnbackedTicketClaim(events, messages)) lines.push('', UNBACKED_TICKET_CLAIM_NOTICE);

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
      const who = m.role.toUpperCase();
      const model = m.role === 'assistant' ? parseMessageProvenance(m)?.model : undefined;
      const stamp = model ? ` · ${model}` : '';
      lines.push(`[${m.createdAt ?? ''}] ${who}${stamp}: ${cap(m.content, 1500)}`);
    }
  }

  return lines.join('\n');
}
