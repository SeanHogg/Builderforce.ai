/**
 * Evermind teacher-distillation — turn ANY frontier LLM into a teacher whose
 * exemplar answers train a project's self-learning Evermind.
 *
 * The producer path (`/evermind/learn-text`) feeds the coordinator RAW run text.
 * When a project's manager has pinned a `teacher_model` (any gateway model — Opus,
 * Mistral, GLM, …), the coordinator first asks that frontier model to produce the
 * IDEAL version of the run, then adapts the SSM on `(run context → teacher exemplar)`
 * instead of the raw text. This is classic teacher→student distillation (mirroring
 * the engine's `DistillationEngine`), but wired through the METERED gateway so any
 * vendor is reachable and the call is billed like any other completion.
 *
 * Best-effort by contract: any failure (unknown/unavailable model, gateway error,
 * empty or too-short output) returns null and the caller falls back to raw-text
 * adaptation — the run's learning contribution is never lost, just un-distilled.
 */
import type { Env } from '../../env';
import { llmProxyForPlan } from './LlmProxyService';

/** Max chars of run text handed to the teacher (bounds prompt/token cost). */
export const TEACHER_INPUT_MAX_CHARS = 4000;
/** Max exemplar tokens the teacher may return (bounds output cost). */
export const TEACHER_MAX_OUTPUT_TOKENS = 1024;
/** Min exemplar length worth adapting on — a one-liner is not a teaching signal. */
export const TEACHER_MIN_OUTPUT_CHARS = 40;

const TEACHER_SYSTEM =
  'You are a senior software engineer acting as a TEACHER for a smaller model. ' +
  'You will be shown the raw output of an autonomous coding-agent run. Produce the ' +
  'IDEAL version of that work: correct, concise, idiomatic, and complete, exactly as ' +
  'an expert would have written it. Keep code as code and prose as prose. Do NOT add ' +
  'commentary, preamble, or meta-explanation — output only the exemplary content itself.';

export interface TeacherExemplar {
  /** The frontier model that actually produced the exemplar. */
  model: string;
  /** The exemplar text to adapt the SSM on. */
  output: string;
}

/**
 * Ask a frontier `teacherModel` for the exemplary version of `runText`. Strict-pins
 * the chosen model (no silent substitution — a manager who picks Opus gets Opus or
 * nothing) and routes through the premium gateway pool so any vendor (Anthropic /
 * Mistral / OpenRouter / …) is reachable and metered. Returns null on any failure or
 * a too-short exemplar so the caller can fall back to raw-text adaptation.
 */
export async function generateTeacherExemplar(
  env: Env,
  teacherModel: string,
  runText: string,
  signal?: AbortSignal,
): Promise<TeacherExemplar | null> {
  const model = teacherModel.trim();
  const input = runText.trim();
  if (!model || input.length < 20) return null;

  try {
    const result = await llmProxyForPlan(env, 'pro', true).complete(
      {
        model,
        modelStrict: true,
        messages: [
          { role: 'system', content: TEACHER_SYSTEM },
          { role: 'user', content: input.slice(0, TEACHER_INPUT_MAX_CHARS) },
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
    const raw = (await result.response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown } }> }
      | null;
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    const output = content.trim();
    if (output.length < TEACHER_MIN_OUTPUT_CHARS) return null;
    return { model: result.resolvedModel || model, output };
  } catch {
    return null;
  }
}

/**
 * Build the training text the coordinator adapts the SSM on for one run-text entry.
 * With no teacher, that's the raw run text (self-learning). With a teacher pinned,
 * it's `(run context → teacher exemplar)` so the SSM learns the frontier model's
 * ideal answer, mirroring `DistillationEngine`'s `input\nteacherOutput` shape. The
 * run context is trimmed so the exemplar always survives the caller's window cap.
 */
export async function buildEvermindTrainingText(
  env: Env,
  teacherModel: string | null | undefined,
  runText: string,
  signal?: AbortSignal,
): Promise<{ text: string; distilled: boolean; teacherModel?: string }> {
  const model = (teacherModel ?? '').trim();
  if (!model) return { text: runText, distilled: false };
  const exemplar = await generateTeacherExemplar(env, model, runText, signal);
  if (!exemplar) return { text: runText, distilled: false };
  const context = runText.trim().slice(0, 1500);
  return { text: `${context}\n${exemplar.output}`, distilled: true, teacherModel: exemplar.model };
}
