/**
 * Reading a run's trace events (`ExecutionTraceToolEvent`): the narration an
 * `agent.message` carries, how the run was dispatched and which models served it,
 * and which events are real tool calls rather than lifecycle telemetry. Pure
 * functions over the trace rows — the execution panel renders what they return.
 */
import type { ExecutionTraceToolEvent } from '@/lib/builderforceApi';

/**
 * Full assistant narration from an `agent.message` trace event. The complete text
 * is in `args.content` (the truncated `result` is the timeline preview), so prefer
 * it and fall back to `result` for older rows.
 */
export function agentMessageText(ev: ExecutionTraceToolEvent): string {
  if (ev.args) {
    try {
      const a = JSON.parse(ev.args) as { content?: unknown };
      if (typeof a.content === 'string' && a.content.trim()) return a.content;
    } catch { /* fall through to result */ }
  }
  return (ev.result ?? '').trim();
}

/**
 * Run provenance for the triage report: how the run was dispatched and which LLM
 * model(s) ACTUALLY served its steps — read from telemetry, not from the task's
 * request. A "gateway-default" dispatch frequently falls through to a weak model
 * for every step; surfacing the served model (with a per-model step count) is what
 * lets a reviewer see that before trusting the output.
 */
export function runProvenance(toolEvents: ExecutionTraceToolEvent[]): {
  dispatch?: { engine?: string; surface?: string; model?: string; executor?: string };
  models: string[];
  /** repo full-name as the run itself saw it (`context.prepare` telemetry) — a
   *  zero-fetch fallback when the authoritative repo-status call is unavailable. */
  repo?: string;
} {
  let dispatch: { engine?: string; surface?: string; model?: string; executor?: string } | undefined;
  let repo: string | undefined;
  const models = new Map<string, number>();
  for (const ev of toolEvents) {
    if (ev.toolName === 'runtime.dispatch' && ev.args && !dispatch) {
      try {
        const a = JSON.parse(ev.args) as Record<string, string>;
        dispatch = { engine: a.engine, surface: a.surface, model: a.model, executor: a.executor };
      } catch { /* ignore unparseable dispatch args */ }
    }
    if (ev.toolName === 'context.prepare' && ev.args && !repo) {
      try {
        const a = JSON.parse(ev.args) as { repo?: string };
        if (a.repo) repo = a.repo;
      } catch { /* ignore unparseable context args */ }
    }
    if (ev.toolName === 'llm.complete' && ev.args) {
      try {
        const a = JSON.parse(ev.args) as { model?: string };
        if (a.model) models.set(a.model, (models.get(a.model) ?? 0) + 1);
      } catch { /* ignore unparseable llm args */ }
    }
  }
  return { dispatch, models: [...models.entries()].map(([m, n]) => `${m} ×${n}`), repo };
}

/** The cloud-agent TYPE a run actually dispatched as (e.g. "Cloud Agent
 *  (Node/Container)"), read from the run's own `runtime.dispatch` telemetry — the
 *  authoritative per-run surface, independent of anything on the agent since. The
 *  type comes from what the run recorded, not from re-reading the agent's record. */
export function runDispatchType(toolEvents: ExecutionTraceToolEvent[]): string | undefined {
  const ev = toolEvents.find((e) => e.toolName === 'runtime.dispatch');
  if (!ev?.args) return undefined;
  try {
    const d = JSON.parse(ev.args) as { agentType?: unknown };
    return typeof d.agentType === 'string' && d.agentType.trim() ? d.agentType.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Lifecycle/telemetry namespaces emitted into the trace stream that are NOT tool
 *  calls (narration, model completions, dispatch, planning, context prep). The
 *  Tools tab counts/lists only genuine tool invocations, so these are excluded. */
const NON_TOOL_NAMESPACES = new Set(['agent', 'llm', 'runtime', 'context', 'planning', 'capabilities']);
const NON_TOOL_CATEGORIES = new Set(['message', 'llm', 'thinking', 'planning', 'context', 'capabilities', 'lifecycle']);

/** True when a trace event is a real tool call (e.g. write_file, list_files), not
 *  a lifecycle/telemetry event (agent.message, llm.complete, context.prepare, …). */
export function isGenuineToolCall(ev: ExecutionTraceToolEvent): boolean {
  if (ev.category && NON_TOOL_CATEGORIES.has(ev.category)) return false;
  const ns = ev.toolName.includes('.') ? ev.toolName.split('.')[0] : '';
  if (ns && NON_TOOL_NAMESPACES.has(ns)) return false;
  return true;
}
