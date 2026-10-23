/**
 * One run entry's learning step on the coordinator: the package's DistillationEngine
 * with the gateway as teacher and the project's checkpoint as student.
 *
 * The recipe — teacher answers, gate the exemplar, fall back to the raw run text so a
 * contribution is never lost, cap the context so it can't crowd the exemplar out of
 * the window, adapt — is `@seanhogg/builderforce-memory/distillation`'s, the same one
 * any engine consumer runs. This module supplies only what is the api's:
 *   • the TEACHER port: {@link generateTeacherExemplar} through the metered gateway,
 *     strict-pinned, with a failure reason the console can name;
 *   • the STUDENT port: `adaptAndDiff` over the project head, yielding the diff the
 *     coordinator merges (null when the text has no trainable window);
 *   • the mapping of the engine's outcome onto the coordinator's provenance fields, and
 *     the fault breaker for a teacher that failed at the gateway;
 *   • run-text hygiene: agent mid-turn NARRATION ("Let me check…", tool-call
 *     play-by-play) is stripped before any RAW run text is adapted on — the
 *     un-distilled path, the refine-mode teacher input and the teacher fallback. A run
 *     whose text was nothing but narration teaches nothing. Unfiltered, that chatter
 *     self-learned into the head, regressed held-out loss and kept it quarantined.
 *   • the DEFERRED teacher (PRD D6, lever `d6_batch_api`): with a {@link TeacherDeferral}
 *     the teacher call rides a provider batch instead of holding the alarm. The entry fits
 *     nothing now; {@link evermindTeacherBatchHandler} hands the exemplar (or, when the
 *     teacher produced none, the cleaned run text) back to the coordinator as ONE
 *     pre-distilled contribution carrying its provenance, so the entry is learned exactly
 *     once and never re-taught.
 */

import { adaptAndDiff, type AdaptResult, type EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import { DistillationEngine, type DistillationStudent, type DistillationTeacher } from '@seanhogg/builderforce-memory/distillation';
import { stripRunNarration } from '@builderforce/agent-loop';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  TEACHER_MIN_OUTPUT_CHARS,
  generateTeacherExemplar,
  noteTeacherFault,
  teacherRequest,
  type EffectiveTeacher,
  type TeacherFailureReason,
  type TeacherMode,
  type TeacherSkipReason,
} from './evermindTeacher';
import { coordinatorStub } from './projectEvermind';
import { deferLlmCall } from './batch/deferLlmCall';
import type { BatchCallbackHandler } from './batch/batchCallbacks';

/** Chars of the task / run context that prefix the exemplar in the training text. */
export const TEACHER_CONTEXT_CHARS = 1500;

type AdaptTokenizer = Parameters<typeof adaptAndDiff>[1];

/** One adaptation's diff, or null when the text had no trainable window. */
export type EvermindAdaptation = AdaptResult | null;

/** What the coordinator records about one entry's learning step. */
export interface EvermindDistilledEntry {
  /** The diff to merge, or null when nothing was trainable. */
  adapted: EvermindAdaptation;
  /** True when a frontier teacher's exemplar is what was learned. */
  distilled: boolean;
  /** Present when distilled: the model that produced the exemplar. */
  teacherModel?: string;
  /** Present when distilled: the exemplar ANSWER alone — what "Learned" must show
   *  (the raw input would echo a teach-a-task's question back as its own answer). */
  exemplar?: string;
  /** Present when NOT distilled: why the teacher was skipped. */
  skipReason?: TeacherSkipReason;
  /** Present when NOT distilled: the machine detail behind `skipReason`. */
  skipDetail?: string;
  /** Present when NOT distilled but a teacher WAS pinned: which model failed. */
  attemptedTeacherModel?: string;
  /** What "Learned" should show: the exemplar when distilled, otherwise the run text
   *  with its narration stripped. Absent when nothing was learned. */
  learnedText?: string;
  /** True when the raw run text was ALL narration, so it was not learned from. */
  narrationOnly?: boolean;
  /** Present when the teacher call was queued on a provider batch: nothing was fitted
   *  now, and the batch handler delivers the learned text as its own contribution. */
  deferredJobId?: number;
}

/** Where a deferred teacher's answer goes back to: the project coordinator that queued
 *  the entry, with the entry's own provenance. */
export interface TeacherDeferral {
  db: Db;
  projectId: number;
  chatId?: number | null;
  weight?: number;
  /** The coordinator's id for the queued entry, carried back so a poller of that id
   *  follows the contribution the batch answer becomes. */
  contributionId?: number;
}

/**
 * A contribution that has ALREADY been through distillation — the body the batch handler
 * posts to the coordinator's `/learn-text`. `distillation` is the provenance the alarm
 * records instead of running a teacher: an entry carrying it is adapted on `text` as is.
 */
export interface PreDistilledLearnText {
  tenantId: number;
  projectId: number;
  text: string;
  prompt?: string;
  chatId?: number;
  weight?: number;
  /** The contribution id the teacher call was deferred from (see {@link TeacherDeferral}). */
  deferredContributionId?: number;
  distillation:
    | { distilled: true; teacherModel: string }
    | { distilled: false; skipReason: TeacherFailureReason; skipDetail?: string; attemptedTeacherModel: string };
}

/**
 * The part of a raw run text worth learning from — narration stripped — or null when
 * stripping left less than {@link TEACHER_MIN_OUTPUT_CHARS} (nothing but play-by-play).
 * A text with no narration in it is returned as-is, whatever its length.
 */
export function learnableRunText(runText: string): string | null {
  const { text, dropped } = stripRunNarration(runText);
  if (dropped === 0) return runText;
  return text.length >= TEACHER_MIN_OUTPUT_CHARS ? text : null;
}

/** The project head as a distillation student. */
export function evermindStudent(base: EvermindModelPackage, tokenizer: AdaptTokenizer): DistillationStudent<EvermindAdaptation> {
  return {
    adapt: async (text) => adaptAndDiff(base, tokenizer, text),
    skippedResult: () => null,
    describe: (r) => ({ finalLoss: r?.loss, epochs: r ? 1 : 0 }),
  };
}

/** A teacher call that produced no exemplar, carrying the reason the console names. */
class TeacherFailure extends Error {
  constructor(readonly reason: TeacherFailureReason, readonly detail?: string) {
    super(`teacher ${reason}${detail ? `: ${detail}` : ''}`);
  }
}

/** The gateway as a distillation teacher, remembering which model actually answered. */
function gatewayTeacher(env: Env, tenantId: number, model: string, mode: TeacherMode, signal?: AbortSignal): DistillationTeacher & { answeredBy?: string } {
  const teacher: DistillationTeacher & { answeredBy?: string } = {
    async generate(input) {
      const result = await generateTeacherExemplar(env, tenantId, model, input, mode, signal);
      if (!result.ok) throw new TeacherFailure(result.reason, result.detail);
      teacher.answeredBy = result.exemplar.model;
      return result.exemplar.output;
    },
  };
  return teacher;
}

/**
 * Learn one run entry. With no effective teacher the student learns the run text,
 * narration stripped. With one, a threaded task `prompt` is ANSWERED (`task → ideal
 * answer`), otherwise the cleaned run output is REFINED (`run context → ideal
 * version`); a teacher that fails, or whose exemplar is below
 * {@link TEACHER_MIN_OUTPUT_CHARS}, falls back to the cleaned run text. A run text that
 * is all narration is never adapted on: with no teacher prompt to answer, the entry
 * learns nothing (`narrationOnly`), and a failed teacher has no fallback to learn.
 */
export async function distillEvermindEntry(
  env: Env,
  tenantId: number,
  teacher: EffectiveTeacher,
  student: DistillationStudent<EvermindAdaptation>,
  runText: string,
  opts?: { prompt?: string | null; signal?: AbortSignal; defer?: TeacherDeferral },
): Promise<EvermindDistilledEntry> {
  const learnable = learnableRunText(runText);
  const prompt = (opts?.prompt ?? '').trim();
  if (teacher.model === null || (!learnable && !prompt)) {
    const skipReason = teacher.model === null ? teacher.reason : undefined;
    if (!learnable) return { adapted: null, distilled: false, narrationOnly: true, ...(skipReason ? { skipReason } : {}) };
    return { adapted: await student.adapt(learnable), distilled: false, learnedText: learnable, ...(skipReason ? { skipReason } : {}) };
  }
  const model = teacher.model;
  const [input, mode] = prompt ? [prompt, 'answer' as const] : [learnable!, 'refine' as const];

  // Nobody waits on a teacher: queue it on a batch when the coordinator says where the
  // answer goes. An input the teacher would refuse as too short stays synchronous (it
  // fails fast and costs nothing).
  if (opts?.defer && input.trim().length >= 20) {
    const queued = await deferLlmCall(env, opts.defer.db, {
      tenantId,
      projectId: opts.defer.projectId,
      kind: 'evermind_teacher',
      pinnedModel: model,
      request: teacherRequest(mode, input),
      payload: {
        projectId: opts.defer.projectId,
        teacherModel: model,
        ...(prompt ? { prompt } : {}),
        ...(learnable ? { fallbackText: learnable } : {}),
        ...(opts.defer.chatId != null ? { chatId: opts.defer.chatId } : {}),
        ...(opts.defer.weight != null ? { weight: opts.defer.weight } : {}),
        ...(opts.defer.contributionId != null ? { contributionId: opts.defer.contributionId } : {}),
      },
    });
    if (queued.deferred) return { adapted: null, distilled: false, deferredJobId: queued.jobId };
  }

  // A narration-only run has no fallback worth learning: the student skips an empty
  // fallback instead of fitting on it.
  const guarded: DistillationStudent<EvermindAdaptation> = {
    ...student,
    adapt: async (text) => (text.trim() ? student.adapt(text) : student.skippedResult()),
  };
  const port = gatewayTeacher(env, tenantId, model, mode, opts?.signal);
  const result = await new DistillationEngine(guarded, port).distill(input, {
    qualityGate: { minLength: TEACHER_MIN_OUTPUT_CHARS },
    fallbackText: learnable ?? '',
    contextChars: TEACHER_CONTEXT_CHARS,
  });

  if (result.distilled) {
    return {
      adapted: result.adaptResult,
      distilled: true,
      teacherModel: port.answeredBy ?? model,
      exemplar: result.teacherOutput,
      learnedText: result.teacherOutput,
    };
  }

  // A pinned teacher that produced nothing is an OPERATIONAL FAULT, not a normal path —
  // carry the reason + the model so the console can say so.
  const failure = result.teacherError instanceof TeacherFailure ? result.teacherError : null;
  const skipReason: TeacherFailureReason = failure?.reason
    ?? (result.skipReason === 'low_quality' ? 'empty_output' : 'exception');
  const skipDetail = failure?.detail
    ?? (result.skipReason === 'low_quality' ? `${result.teacherOutput.length} chars` : errorText(result.teacherError));
  // Bench the teacher when the GATEWAY is what failed, so the next alarm skips it.
  await noteTeacherFault(env, tenantId, model, skipReason);
  return {
    adapted: result.adaptResult,
    distilled: false,
    skipReason,
    attemptedTeacherModel: model,
    ...(skipDetail ? { skipDetail } : {}),
    ...(learnable ? { learnedText: learnable } : { narrationOnly: true }),
  };
}

/**
 * Learn a contribution that has ALREADY been through distillation (the deferred teacher's
 * batch handler posted it — {@link PreDistilledLearnText}): no teacher runs, the student
 * adapts on `text` as is, and the entry carries the provenance the handler recorded — the
 * same fields a synchronous {@link distillEvermindEntry} would have stamped.
 */
export async function adaptPreDistilledEntry(
  student: DistillationStudent<EvermindAdaptation>,
  text: string,
  distillation: PreDistilledLearnText['distillation'],
): Promise<EvermindDistilledEntry> {
  const adapted = await student.adapt(text);
  if (distillation.distilled) {
    return { adapted, distilled: true, teacherModel: distillation.teacherModel, exemplar: text, learnedText: text };
  }
  return {
    adapted,
    distilled: false,
    skipReason: distillation.skipReason,
    attemptedTeacherModel: distillation.attemptedTeacherModel,
    ...(distillation.skipDetail ? { skipDetail: distillation.skipDetail } : {}),
    learnedText: text,
  };
}

const TEACHER_FAILURE_REASONS: ReadonlySet<string> = new Set<TeacherFailureReason>(['input_too_short', 'gateway_error', 'empty_output', 'exception']);

/** A `/learn-text` body's `distillation` field, validated — or undefined when absent or malformed. */
export function readPreDistillation(value: unknown): PreDistilledLearnText['distillation'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.distilled === true && typeof v.teacherModel === 'string' && v.teacherModel) {
    return { distilled: true, teacherModel: v.teacherModel };
  }
  if (v.distilled === false && typeof v.skipReason === 'string' && TEACHER_FAILURE_REASONS.has(v.skipReason) && typeof v.attemptedTeacherModel === 'string') {
    return {
      distilled: false,
      skipReason: v.skipReason as TeacherFailureReason,
      attemptedTeacherModel: v.attemptedTeacherModel,
      ...(typeof v.skipDetail === 'string' && v.skipDetail ? { skipDetail: v.skipDetail.slice(0, 500) } : {}),
    };
  }
  return undefined;
}

function errorText(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Deferred teacher — the batch completion handler
// ---------------------------------------------------------------------------

/** The deferred entry's provenance, read back off the job. */
function deferredEntry(payload: Record<string, unknown>): { projectId: number; teacherModel: string; prompt?: string; fallbackText?: string; chatId?: number; weight?: number; contributionId?: number } {
  const projectId = Number(payload.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('evermind_teacher job has no projectId');
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const prompt = str(payload.prompt);
  const fallbackText = str(payload.fallbackText);
  const chatId = num(payload.chatId);
  const weight = num(payload.weight);
  const contributionId = num(payload.contributionId);
  return {
    projectId,
    teacherModel: str(payload.teacherModel) ?? 'unknown',
    ...(prompt ? { prompt } : {}),
    ...(fallbackText ? { fallbackText } : {}),
    ...(chatId != null ? { chatId } : {}),
    ...(weight != null ? { weight } : {}),
    ...(contributionId != null ? { contributionId } : {}),
  };
}

/** Post one pre-distilled contribution to the project coordinator. Throws on refusal so
 *  the job records why the memory did not land. */
async function deliverPreDistilled(env: Env, body: PreDistilledLearnText): Promise<void> {
  const stub = coordinatorStub(env, body.tenantId, body.projectId);
  if (!stub) throw new Error('no coordinator binding');
  const res = await stub.fetch('https://coordinator/learn-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`coordinator refused the contribution: HTTP ${res.status}`);
}

/** The cleaned run text as an un-distilled contribution — the synchronous fallback's
 *  "a contribution is never lost", for a teacher that answered nothing usable. */
async function deliverFallback(
  env: Env,
  tenantId: number,
  entry: ReturnType<typeof deferredEntry>,
  skipReason: TeacherFailureReason,
  skipDetail?: string,
): Promise<void> {
  if (!entry.fallbackText) return; // all narration: the synchronous path learns nothing either
  await deliverPreDistilled(env, {
    tenantId,
    projectId: entry.projectId,
    text: entry.fallbackText,
    ...(entry.prompt ? { prompt: entry.prompt } : {}),
    ...(entry.chatId != null ? { chatId: entry.chatId } : {}),
    ...(entry.weight != null ? { weight: entry.weight } : {}),
    ...(entry.contributionId != null ? { deferredContributionId: entry.contributionId } : {}),
    distillation: { distilled: false, skipReason, ...(skipDetail ? { skipDetail } : {}), attemptedTeacherModel: entry.teacherModel },
  });
}

/**
 * Settles a deferred teacher call. The exemplar passes the same quality gate the engine
 * applies ({@link TEACHER_MIN_OUTPUT_CHARS}); below it, or when the batch could not get
 * an answer at all, the cleaned run text is learned un-distilled with the reason — and a
 * gateway failure benches the teacher exactly as a synchronous one does.
 */
export const evermindTeacherBatchHandler: BatchCallbackHandler = {
  async settle({ env }, job, completion) {
    const entry = deferredEntry(job.callbackPayload);
    const exemplar = completion.content.trim();
    if (exemplar.length < TEACHER_MIN_OUTPUT_CHARS) {
      await deliverFallback(env, job.tenantId, entry, 'empty_output', `${exemplar.length} chars`);
      return;
    }
    await deliverPreDistilled(env, {
      tenantId: job.tenantId,
      projectId: entry.projectId,
      text: exemplar,
      ...(entry.prompt ? { prompt: entry.prompt } : {}),
      ...(entry.chatId != null ? { chatId: entry.chatId } : {}),
      ...(entry.weight != null ? { weight: entry.weight } : {}),
      ...(entry.contributionId != null ? { deferredContributionId: entry.contributionId } : {}),
      distillation: { distilled: true, teacherModel: completion.model || entry.teacherModel },
    });
  },
  async abandon({ env }, job, error) {
    const entry = deferredEntry(job.callbackPayload);
    await noteTeacherFault(env, job.tenantId, entry.teacherModel, 'gateway_error');
    await deliverFallback(env, job.tenantId, entry, 'gateway_error', error.slice(0, 200));
  },
};
