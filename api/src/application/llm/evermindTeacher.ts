/**
 * Evermind teacher-distillation — turn ANY frontier LLM into a teacher whose
 * exemplar answers train a project's self-learning Evermind.
 *
 * The producer path (`/evermind/learn-text`) feeds the coordinator a run entry.
 * When a project's manager has pinned a `teacher_model` (any gateway model — Opus,
 * Mistral, GLM, …), the coordinator distils through it:
 *   - with the run's TASK PROMPT (threaded from the producer) → the teacher ANSWERS
 *     the task and the SSM learns `(task → ideal answer)` — true prompt→response
 *     distillation;
 *   - without a prompt (older producers) → the teacher REFINES the run OUTPUT and the
 *     SSM learns `(run context → ideal version)`.
 * Either way it mirrors the engine's `DistillationEngine` but routes through the
 * METERED gateway so any vendor is reachable and the call is billed.
 *
 * Cost-gated: a teacher call spends frontier tokens, so it is skipped when the tenant
 * is out of token budget ({@link getTenantTokenAvailability} — the SAME cap the
 * gateway's `enforceTokenCaps` and the consumption meter enforce). Best-effort by
 * contract: a skipped/failed teacher falls back to raw-text adaptation, so the run's
 * learning contribution is never lost — only un-distilled.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { llmProxyForPlan, readProxyChoice } from './LlmProxyService';
import { getTenantTokenAvailability } from './tenantTokenAvailability';

/** Max chars of task/run text handed to the teacher (bounds prompt/token cost). */
export const TEACHER_INPUT_MAX_CHARS = 4000;
/** Max exemplar tokens the teacher may return (bounds output cost). */
export const TEACHER_MAX_OUTPUT_TOKENS = 1024;
/** Min exemplar length worth adapting on — a one-liner is not a teaching signal. */
export const TEACHER_MIN_OUTPUT_CHARS = 40;

/** How the teacher is prompted: answer a task, or refine a produced output. */
export type TeacherMode = 'answer' | 'refine';

const TEACHER_SYSTEM: Record<TeacherMode, string> = {
  // The prompt-threaded path: teach the (task → ideal answer) mapping.
  answer:
    'You are a senior software engineer acting as a TEACHER for a smaller model. ' +
    'You will be given a coding task or ticket. Produce the IDEAL solution: correct, ' +
    'concise, idiomatic, and complete, exactly as an expert would deliver it. Keep code ' +
    'as code and prose as prose. Do NOT add commentary, preamble, or meta-explanation — ' +
    'output only the exemplary solution itself.',
  // The output-only fallback: teach the ideal version of what the agent produced.
  refine:
    'You are a senior software engineer acting as a TEACHER for a smaller model. ' +
    'You will be shown the raw output of an autonomous coding-agent run. Produce the ' +
    'IDEAL version of that work: correct, concise, idiomatic, and complete, exactly as ' +
    'an expert would have written it. Keep code as code and prose as prose. Do NOT add ' +
    'commentary, preamble, or meta-explanation — output only the exemplary content itself.',
};

export interface TeacherExemplar {
  /** The frontier model that actually produced the exemplar. */
  model: string;
  /** The exemplar text to adapt the SSM on. */
  output: string;
}

/**
 * Ask a frontier `teacherModel` for an exemplar given `input` (a task prompt in
 * `answer` mode, or a run output in `refine` mode). Strict-pins the chosen model (no
 * silent substitution — a manager who picks Opus gets Opus or nothing) and routes
 * through the premium gateway pool so any vendor (Anthropic / Mistral / OpenRouter /
 * …) is reachable and metered. Returns null on any failure or a too-short exemplar so
 * the caller can fall back to raw-text adaptation.
 */
export async function generateTeacherExemplar(
  env: Env,
  teacherModel: string,
  input: string,
  mode: TeacherMode = 'refine',
  signal?: AbortSignal,
): Promise<TeacherExemplar | null> {
  const model = teacherModel.trim();
  const text = input.trim();
  if (!model || text.length < 20) return null;

  try {
    const result = await llmProxyForPlan(env, 'pro', true).complete(
      {
        model,
        modelStrict: true,
        messages: [
          { role: 'system', content: TEACHER_SYSTEM[mode] },
          { role: 'user', content: text.slice(0, TEACHER_INPUT_MAX_CHARS) },
        ],
        temperature: 0.2,
        max_tokens: TEACHER_MAX_OUTPUT_TOKENS,
        useCase: 'task_execution',
      },
      undefined,
      undefined,
      signal,
    );
    if (result.response.status >= 400) return null;
    const { content: output } = await readProxyChoice(result);
    if (output.length < TEACHER_MIN_OUTPUT_CHARS) return null;
    return { model: result.resolvedModel || model, output };
  } catch {
    return null;
  }
}

/** Why a teacher distillation was skipped (falls back to raw-text learning). */
export type TeacherSkipReason = 'no_teacher' | 'teacher_failed';

export interface EvermindTrainingText {
  /** The text the coordinator adapts the SSM on. */
  text: string;
  /** True when a frontier teacher shaped this text. */
  distilled: boolean;
  /** Present when distilled: the model that produced the exemplar. */
  teacherModel?: string;
  /** Present when NOT distilled: why the teacher was skipped. */
  skipReason?: TeacherSkipReason;
}

/**
 * Resolve the EFFECTIVE teacher model for a coordinator alarm: the pinned model when
 * the tenant still has token budget, else null. Call this ONCE PER ALARM (not per run
 * entry) — the token-availability scan is a per-tenant usage aggregate that is
 * constant across the batch, so resolving it here keeps the alarm from re-scanning
 * for every queued run. A teacher call is a paid frontier completion, so an
 * out-of-budget tenant must not keep burning our pool (the SAME gate the gateway's
 * `enforceTokenCaps`, the consumption meter, and the autonomous cron use). Fails OPEN
 * (a usage-scan error keeps the teacher) so learning is never silently disabled by a
 * transient DB blip.
 */
export async function resolveEvermindTeacherModel(
  db: Db,
  tenantId: number,
  teacherModel: string | null | undefined,
): Promise<string | null> {
  const model = (teacherModel ?? '').trim();
  if (!model) return null;
  try {
    const availability = await getTenantTokenAvailability(db, tenantId);
    if (!availability.hasTokens) return null;
  } catch {
    /* fail open — keep the teacher */
  }
  return model;
}

/**
 * Build the training text the coordinator adapts the SSM on for one run entry.
 *
 * `teacherModel` is the ALREADY-RESOLVED effective teacher ({@link resolveEvermindTeacherModel},
 * budget-gated once per alarm) — null → the raw run text (self-learning). When set and
 * a `prompt` is threaded, the SSM learns `(task → teacher answer)`; otherwise it learns
 * `(run context → refined output)`. The context is trimmed so the exemplar always
 * survives the caller's window cap.
 */
export async function buildEvermindTrainingText(
  env: Env,
  teacherModel: string | null,
  runText: string,
  opts?: { prompt?: string | null; signal?: AbortSignal },
): Promise<EvermindTrainingText> {
  const model = (teacherModel ?? '').trim();
  if (!model) return { text: runText, distilled: false, skipReason: 'no_teacher' };

  const prompt = (opts?.prompt ?? '').trim();
  const [input, mode] = prompt ? [prompt, 'answer' as const] : [runText, 'refine' as const];
  const exemplar = await generateTeacherExemplar(env, model, input, mode, opts?.signal);
  if (!exemplar) return { text: runText, distilled: false, skipReason: 'teacher_failed' };

  // Teach the (input → exemplar) mapping, mirroring DistillationEngine's shape.
  const context = input.trim().slice(0, 1500);
  return { text: `${context}\n${exemplar.output}`, distilled: true, teacherModel: exemplar.model };
}
