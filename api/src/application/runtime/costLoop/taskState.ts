/**
 * Structured task state (cost lever C3) — the agent's own running record of what it is
 * doing, kept OUTSIDE the transcript so compaction can never summarise it away.
 *
 * The model writes it with `update_task_state`; the loop persists it in
 * `CloudLoopState.taskState` (so every durable tick keeps it) and renders it in the
 * per-turn volatile block after the history. Bounded (~600 tokens) so it stays a
 * summary rather than a second transcript.
 */
import type { ToolSchema } from '@builderforce/agent-tools';
import { estimateTokensFromChars } from '@builderforce/workload';

export interface TaskState {
  goal?: string;
  constraints?: string[];
  decisions?: string[];
  filesTouched?: string[];
  openQuestions?: string[];
  nextStep?: string;
}

export const UPDATE_TASK_STATE_TOOL = 'update_task_state';

/** Writes rendering above this are refused — keep the record short. */
export const TASK_STATE_MAX_TOKENS = 600;

const LIST_FIELDS = ['constraints', 'decisions', 'filesTouched', 'openQuestions'] as const;
const TEXT_FIELDS = ['goal', 'nextStep'] as const;

const list = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

export const UPDATE_TASK_STATE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: UPDATE_TASK_STATE_TOOL,
    description:
      'Record your structured task state: the goal, constraints, decisions made, files touched, open questions and the '
      + 'next step. It is shown to you on every turn and survives context compaction, so keep it current after each '
      + 'meaningful step instead of re-deriving it. Fields you omit keep their previous value. Keep it under ~600 tokens.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'The task goal in one or two sentences.' },
        constraints: list('Rules and limits the work must respect.'),
        decisions: list('Decisions already made, so they are not revisited.'),
        filesTouched: list('Repo paths you changed.'),
        openQuestions: list('What is still unknown.'),
        nextStep: { type: 'string', description: 'The very next action.' },
      },
    },
  },
};

const LABELS: Record<keyof TaskState, string> = {
  goal: 'Goal', constraints: 'Constraints', decisions: 'Decisions', filesTouched: 'Files touched',
  openQuestions: 'Open questions', nextStep: 'Next step',
};

/** The state as the prompt block the model reads. '' when empty. */
export function renderTaskState(state: TaskState | undefined): string {
  if (!state) return '';
  const lines: string[] = [];
  for (const key of ['goal', ...LIST_FIELDS, 'nextStep'] as const) {
    const value = state[key];
    if (typeof value === 'string' && value.trim()) lines.push(`${LABELS[key]}: ${value.trim()}`);
    else if (Array.isArray(value) && value.length) lines.push(`${LABELS[key]}:\n${value.map((v) => `- ${v}`).join('\n')}`);
  }
  return lines.length ? `### Task state\n${lines.join('\n')}` : '';
}

/** Merge a tool call into the current state; refuses an oversized result. */
export function applyTaskStateUpdate(
  current: TaskState | undefined,
  args: Record<string, unknown>,
): { ok: true; state: TaskState } | { ok: false; error: string } {
  const next: TaskState = { ...(current ?? {}) };
  for (const key of TEXT_FIELDS) {
    if (typeof args[key] === 'string') next[key] = (args[key] as string).trim();
  }
  for (const key of LIST_FIELDS) {
    const value = args[key];
    if (Array.isArray(value)) next[key] = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  }
  const tokens = estimateTokensFromChars(renderTaskState(next).length);
  if (tokens > TASK_STATE_MAX_TOKENS) {
    return { ok: false, error: `task state would be ~${tokens} tokens (limit ${TASK_STATE_MAX_TOKENS}) — summarise it more tightly and retry` };
  }
  return { ok: true, state: next };
}
