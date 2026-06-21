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
  /** The current top-level error surfaced to the user, if any. */
  error?: string;
}

/**
 * Assemble the Brain triage report. Same shape as the host/cloud report:
 * header → errors-first → full event log → derived log lines → transcript.
 */
export function buildBrainTriageReport(opts: BuildBrainTriageOptions): string {
  const { capturedAt, events, messages = [], chatId, chatTitle, agentLabel, error } = opts;
  const errors = events.filter((e) => e.isError || e.category === 'error');
  const lines: string[] = [];

  lines.push('=== BuilderForce Brain Triage ===');
  lines.push(`Captured:  ${capturedAt}`);
  if (chatId != null) lines.push(`Chat:      #${chatId}${chatTitle ? ` — ${chatTitle}` : ''}`);
  lines.push(`Brain:     ${agentLabel || 'Brain (default)'}`);
  lines.push(`Steps: ${events.length} · Errors: ${errors.length} · Messages: ${messages.length}`);
  if (error) lines.push(`Last error: ${error}`);

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
