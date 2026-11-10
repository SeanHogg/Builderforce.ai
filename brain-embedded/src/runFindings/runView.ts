/**
 * The run, read ONCE (PRD 46 §3.1): ordered turns — each `llm.complete` plus the tool steps that follow it
 * (`category === 'tool'` only; bookkeeping such as `agent.message`, `steer.applied` or `run.budget_*` never counts)
 * — with each turn's role, model, usage, duration, argument bytes and text, and each call's written paths and
 * whether it checked the workspace. Every detector reads this view and nothing else.
 *
 * The per-turn numbers come from {@link modelTurnLog}, the role/hand-off picture from {@link routingByRole}, the
 * ticket/dispatch picture from {@link staffingSummaryInTrace} — no second copy of any of them. Pure.
 */
import { isFailedToolResult, type BrainTraceEvent } from '../brainTriage';
import { utf8ByteLength } from '../composingActivity';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { modelTurnLog } from '../modelScorecard';
import { routingByRole } from '../routingByRole';
import { isCacheAnswered } from '../runProgress';
import { commandOf } from '../shipVerification';
import { staffingSummaryInTrace } from '../staffingSummary';
import { STOPPED_TURN_STEP } from '../stoppedTurn';
import type { BrainMessage } from '../types';
import { CHECK_COMMAND, CHECK_TOOL, SHELL_TOOLS } from './policy';
import type { RunTurnKind, RunView, ViewCall, ViewTurn } from './types';

const HAND_OFF_DUE = 'loop.hand_off_due';
const ROLE_HANDOFF = 'llm.role_handoff';

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function jsonBytes(v: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(v ?? null));
  } catch {
    return 0;
  }
}

/** The paths a code change names: its own `path`, or each entry of a batched `edits[]`. */
export function changedPaths(args: Record<string, unknown>): string[] {
  const one = (a: Record<string, unknown>): string | null => {
    const p = a.path ?? a.file_path ?? a.filePath;
    return typeof p === 'string' && p.trim() ? p.trim().replace(/\\/g, '/').replace(/^\.\//, '') : null;
  };
  const paths = Array.isArray(args.edits) ? args.edits.map((e) => one(record(e))) : [one(args)];
  return [...new Set(paths.filter((p): p is string => p !== null))];
}

function isCheck(ev: BrainTraceEvent): boolean {
  if (CHECK_TOOL.test(ev.label)) return true;
  return SHELL_TOOLS.has(ev.label) && CHECK_COMMAND.test(commandOf(ev));
}

function callOf(ev: BrainTraceEvent, step: number, turn: number): ViewCall {
  const ok = !ev.isError && !isFailedToolResult(ev.result);
  const args = record(ev.args);
  const write = ok && isCodeChangeTool(ev.label) && !isCacheAnswered(ev);
  return {
    step, turn, name: ev.label, args, ok,
    argBytes: jsonBytes(ev.args),
    write,
    check: ok && isCheck(ev),
    paths: write ? changedPaths(args) : [],
  };
}

function kindOf(t: Pick<ViewTurn, 'forced' | 'calls' | 'toolCalls'>, failed: boolean): RunTurnKind {
  if (failed) return 'failed';
  if (t.forced) return 'forced';
  if (t.calls.some((c) => c.write)) return 'write';
  return t.toolCalls > 0 || t.calls.length > 0 ? 'read' : 'text';
}

/** Build the view of a recorded run. `events` is the merged trace (`traceWithPersistedSteps`). */
export function buildRunView(events: readonly BrainTraceEvent[], messages: readonly BrainMessage[] = []): RunView {
  const list = [...events];
  const turns: Array<ViewTurn & { calls: ViewCall[] }> = [];
  const calls: ViewCall[] = [];
  let forcedNext = false;
  let stopped: RunView['stopped'] = null;
  for (const [i, ev] of list.entries()) {
    const step = i + 1;
    const current = turns[turns.length - 1];
    if (ev.label === HAND_OFF_DUE) { forcedNext = true; continue; }
    if (ev.label === STOPPED_TURN_STEP) {
      const model = record(ev.args).model;
      stopped = { step, ...(typeof model === 'string' ? { model } : {}) };
      continue;
    }
    if (ev.label === 'llm.complete') {
      // The ONE reading of a completion — the turn log's — taken one event at a time so its position is kept.
      const logged = modelTurnLog([ev])[0];
      if (!logged) continue;
      const failed = logged.failed === true;
      turns.push({
        index: turns.length + 1, step, role: logged.role ?? '', model: logged.model, kind: failed ? 'failed' : 'text',
        toolCalls: logged.toolCalls, promptTokens: ev.usage?.prompt ?? 0, completionTokens: logged.completionTokens ?? 0,
        durationMs: logged.durationMs ?? 0, argBytes: logged.argBytes ?? 0, forced: forcedNext && !failed, text: '', calls: [],
      });
      if (!failed) forcedNext = false;
      stopped = null;
      continue;
    }
    if (!current) {
      if (ev.category === 'tool') calls.push(callOf(ev, step, 0));
      continue;
    }
    if (ev.label === 'agent.message' && typeof ev.result === 'string' && !current.text) current.text = ev.result;
    else if (ev.label === ROLE_HANDOFF && typeof record(ev.args).via === 'string') current.handOffVia = record(ev.args).via as string;
    else if (ev.category === 'tool') {
      const call = callOf(ev, step, current.index);
      current.calls.push(call);
      calls.push(call);
    }
  }
  for (const t of turns) t.kind = kindOf(t, t.kind === 'failed');
  return {
    events: list,
    messages: [...messages],
    turns,
    calls,
    stopped,
    routing: routingByRole(modelTurnLog(list), list),
    staffing: staffingSummaryInTrace(list),
  };
}
