/**
 * What an interrupted run leaves for its resume (chat #61651): the original ask verbatim, the plan (`update_task_state`)
 * as it stood, the files changed so far and the last few tool steps - derived from the run's own trace and journaled on
 * every checkpoint by the editor host (`clients/vscode/src/hostRunLifecycle.ts` → `execution.checkpoint.state`).
 *
 * Before, Resume sent the bare 'Continue the task that was interrupted when the editor closed.': the resumed run had lost
 * its plan, recalled ANOTHER session's task on that generic text, concluded nothing was pending and changed nothing.
 *
 * Pure: no `vscode`, no store. The readers are `resumeStateOf` (writing) and `parseResumeState` (reading a journaled record,
 * whose payload is untrusted).
 */

import { applyTaskStateUpdate, renderTaskState, type TaskState } from '@builderforce/agent-run';
import { codeChangesOf } from '../codeChanges';
import { activityTarget } from '../runActivity';

/** The resume state journaled with a run. Every field is optional: a run interrupted before its first step has only its ask. */
export interface RunResumeState {
  /** The person's request that started the run, verbatim. */
  ask?: string;
  /** The run's task state (`update_task_state`), rendered as the model wrote it. */
  plan?: string;
  /** Files the run changed so far (workspace-relative). */
  files?: string[];
  /** The run's last tool steps, oldest first: `name on target — ok|failed`. */
  steps?: string[];
}

/** The slice of a trace event the derivation reads. */
export interface ResumeTraceEvent {
  ts: string;
  label: string;
  category?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

/** How many of the run's last tool steps the resume carries. */
export const RESUME_STEPS = 6;
/** How many changed files the resume names. */
export const RESUME_FILES = 40;
/** The ask is quoted verbatim up to this many characters. */
const MAX_ASK = 4000;

const TASK_STATE_TOOL = 'update_task_state';

function failed(ev: ResumeTraceEvent): boolean {
  return ev.isError === true || (!!ev.result && typeof ev.result === 'object' && (ev.result as { ok?: unknown }).ok === false);
}

/** The resume state of the run whose trace events (THIS run's only) are `events`. */
export function resumeStateOf(ask: string | undefined, events: readonly ResumeTraceEvent[]): RunResumeState {
  const tools = events.filter((ev) => ev.category === 'tool');
  let task: TaskState | undefined;
  const files: string[] = [];
  for (const ev of tools) {
    const args = ev.args && typeof ev.args === 'object' ? (ev.args as Record<string, unknown>) : {};
    if (ev.label === TASK_STATE_TOOL && !failed(ev)) {
      const next = applyTaskStateUpdate(task, args);
      if (next.ok) task = next.state;
      continue;
    }
    for (const file of codeChangesOf(ev.label, args, ev.result) ?? []) if (!files.includes(file)) files.push(file);
  }
  const steps = tools
    .filter((ev) => ev.label !== TASK_STATE_TOOL)
    .slice(-RESUME_STEPS)
    .map((ev) => {
      const target = activityTarget(ev.args);
      return `${ev.label}${target ? ` on ${target}` : ''} — ${failed(ev) ? 'failed' : 'ok'}`;
    });
  const plan = renderTaskState(task);
  const asked = ask?.trim();
  return {
    ...(asked ? { ask: asked.slice(0, MAX_ASK) } : {}),
    ...(plan ? { plan } : {}),
    ...(files.length ? { files: files.slice(0, RESUME_FILES) } : {}),
    ...(steps.length ? { steps } : {}),
  };
}

const strings = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return list.length ? list : undefined;
};

/** A journaled checkpoint state read back as a resume state; anything malformed is dropped, never trusted. */
export function parseResumeState(value: unknown): RunResumeState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const ask = typeof raw.ask === 'string' && raw.ask.trim() ? raw.ask : undefined;
  const plan = typeof raw.plan === 'string' && raw.plan.trim() ? raw.plan : undefined;
  const files = strings(raw.files);
  const steps = strings(raw.steps);
  if (!ask && !plan && !files && !steps) return undefined;
  return { ...(ask ? { ask } : {}), ...(plan ? { plan } : {}), ...(files ? { files } : {}), ...(steps ? { steps } : {}) };
}
