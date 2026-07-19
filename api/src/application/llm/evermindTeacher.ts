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
import { resolveTenantLlmCredentials, listTenantProviderKeys } from './tenantProviderKeyService';

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
 * Why a teacher call produced no exemplar. Every one of these used to collapse into a
 * bare `null` that the coordinator silently swallowed — so a teach-a-task whose teacher
 * never answered looked IDENTICAL in the console to one that worked, because the
 * fallback re-recorded the raw input (== the task) as the "Learned" text. Naming the
 * cause is what makes a broken teacher diagnosable instead of invisible.
 */
export type TeacherFailureReason =
  /** The input was below the length worth spending a frontier call on. */
  | 'input_too_short'
  /** The gateway answered 4xx/5xx (bad model pin, no credit, vendor down). */
  | 'gateway_error'
  /** The teacher replied, but with less than {@link TEACHER_MIN_OUTPUT_CHARS}. */
  | 'empty_output'
  /** The call threw (network, abort, malformed payload). */
  | 'exception';

/** The outcome of one teacher call — an exemplar, or the REASON there isn't one. */
export type TeacherResult =
  | { ok: true; exemplar: TeacherExemplar }
  | { ok: false; reason: TeacherFailureReason; detail?: string };

/**
 * Ask a frontier `teacherModel` for an exemplar given `input` (a task prompt in
 * `answer` mode, or a run output in `refine` mode). Strict-pins the chosen model (no
 * silent substitution — a manager who picks Opus gets Opus or nothing) and routes
 * through the premium gateway pool so any vendor (Anthropic / Mistral / OpenRouter /
 * …) is reachable and metered. Never throws: every failure comes back as a NAMED
 * {@link TeacherFailureReason} so the caller can both fall back to raw-text adaptation
 * AND record why distillation didn't happen.
 */
export async function generateTeacherExemplar(
  env: Env,
  tenantId: number,
  teacherModel: string,
  input: string,
  mode: TeacherMode = 'refine',
  signal?: AbortSignal,
): Promise<TeacherResult> {
  const model = teacherModel.trim();
  const text = input.trim();
  if (!model || text.length < 20) return { ok: false, reason: 'input_too_short' };

  try {
    // Thread the tenant's connected BYO account so a strict-pinned frontier teacher
    // resolves on THEIR OWN account (subscription/api-key, $0 to us) when they have
    // one — matching the "BYO funds frontier" rule. Absent → the funded premium pool.
    const creds = await resolveTenantLlmCredentials(env, tenantId).catch(() => ({ anthropicOAuthToken: null, vendorKeys: {}, configuredProviders: [], unresolvedReasons: {}, vendorPriority: [] }));
    const hasVendorKeys = Object.values(creds.vendorKeys).some(Boolean);
    const result = await llmProxyForPlan(env, 'pro', true, {
      ...(creds.anthropicOAuthToken ? { anthropicOAuthToken: creds.anthropicOAuthToken } : {}),
      ...(hasVendorKeys ? { tenantVendorKeys: creds.vendorKeys } : {}),
    }).complete(
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
    if (result.response.status >= 400) {
      return { ok: false, reason: 'gateway_error', detail: `HTTP ${result.response.status}` };
    }
    const { content: output } = await readProxyChoice(result);
    if (output.length < TEACHER_MIN_OUTPUT_CHARS) {
      return { ok: false, reason: 'empty_output', detail: `${output.length} chars` };
    }
    return { ok: true, exemplar: { model: result.resolvedModel || model, output } };
  } catch (err) {
    return { ok: false, reason: 'exception', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Why a teacher distillation didn't happen (the entry still learns, un-distilled).
 * `not_pinned` = no manager ever chose a teacher; `budget_exhausted` = one IS pinned
 * but the tenant is out of platform tokens — two very different fixes, so they must
 * never collapse into one reason. The rest are {@link TeacherFailureReason} verbatim.
 */
export type TeacherSkipReason = 'not_pinned' | 'budget_exhausted' | TeacherFailureReason;

/** The effective teacher for an alarm: the model to use, or WHY there isn't one. */
export type EffectiveTeacher =
  | { model: string }
  | { model: null; reason: Extract<TeacherSkipReason, 'not_pinned' | 'budget_exhausted'> };

export interface EvermindTrainingText {
  /** The text the coordinator adapts the SSM on. */
  text: string;
  /** True when a frontier teacher shaped this text. */
  distilled: boolean;
  /** Present when distilled: the model that produced the exemplar. */
  teacherModel?: string;
  /** Present when distilled: the teacher's exemplar ANSWER on its own (without the
   *  task/context prefix that `text` carries). This is what the model actually learned
   *  FROM, so it — not the raw input — is what the inspection ring should surface as
   *  "Learned" (otherwise a teach-a-task shows the question back as its own answer). */
  exemplar?: string;
  /** Present when NOT distilled: why the teacher was skipped. */
  skipReason?: TeacherSkipReason;
  /** Present when NOT distilled: the machine detail behind `skipReason` (HTTP status,
   *  exception message, …). Operator-facing diagnosis, never shown raw to end users. */
  skipDetail?: string;
  /** Present when NOT distilled but a teacher WAS pinned: which model failed. Lets the
   *  console name the model that isn't answering rather than just "not distilled". */
  attemptedTeacherModel?: string;
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
 *
 * BYO BYPASS: the our-pool budget gate does NOT apply to a tenant who connected their
 * OWN frontier account — their tokens fund the teacher, so an exhausted platform budget
 * must not disable distillation for them (the teacher call itself runs on their account,
 * see {@link generateTeacherExemplar}). When `env` is provided we check for a connected
 * BYO provider (cheap — provider+auth_type only, no secrets) and keep the teacher.
 */
export async function resolveEvermindTeacherModel(
  env: Env,
  db: Db,
  tenantId: number,
  teacherModel: string | null | undefined,
): Promise<EffectiveTeacher> {
  const model = (teacherModel ?? '').trim();
  if (!model) return { model: null, reason: 'not_pinned' };
  try {
    // A connected BYO frontier account funds the teacher itself → never budget-gate it.
    const byoConnected = (await listTenantProviderKeys(env, tenantId).catch(() => [])).length > 0;
    if (byoConnected) return { model };
    const availability = await getTenantTokenAvailability(db, tenantId, undefined, env);
    if (!availability.hasTokens) return { model: null, reason: 'budget_exhausted' };
  } catch {
    /* fail open — keep the teacher */
  }
  return { model };
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
  tenantId: number,
  teacher: EffectiveTeacher,
  runText: string,
  opts?: { prompt?: string | null; signal?: AbortSignal },
): Promise<EvermindTrainingText> {
  if (teacher.model === null) {
    return { text: runText, distilled: false, skipReason: teacher.reason };
  }
  const model = teacher.model;

  const prompt = (opts?.prompt ?? '').trim();
  const [input, mode] = prompt ? [prompt, 'answer' as const] : [runText, 'refine' as const];
  const result = await generateTeacherExemplar(env, tenantId, model, input, mode, opts?.signal);
  if (!result.ok) {
    // A pinned teacher that produced nothing is an OPERATIONAL FAULT, not a normal
    // path — carry the reason + the model that failed so the console can say so
    // instead of silently presenting the un-distilled input as what was learned.
    return {
      text: runText,
      distilled: false,
      skipReason: result.reason,
      attemptedTeacherModel: model,
      ...(result.detail ? { skipDetail: result.detail } : {}),
    };
  }

  // Teach the (input → exemplar) mapping, mirroring DistillationEngine's shape.
  const context = input.trim().slice(0, 1500);
  const { exemplar } = result;
  return { text: `${context}\n${exemplar.output}`, distilled: true, teacherModel: exemplar.model, exemplar: exemplar.output };
}
