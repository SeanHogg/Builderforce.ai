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
 *     the fault breaker for a teacher that failed at the gateway.
 */

import { adaptAndDiff, type AdaptResult, type EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import { DistillationEngine, type DistillationStudent, type DistillationTeacher } from '@seanhogg/builderforce-memory/distillation';
import type { Env } from '../../env';
import {
  TEACHER_MIN_OUTPUT_CHARS,
  generateTeacherExemplar,
  noteTeacherFault,
  type EffectiveTeacher,
  type TeacherFailureReason,
  type TeacherMode,
  type TeacherSkipReason,
} from './evermindTeacher';

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
 * Learn one run entry. With no effective teacher the student learns the raw run text.
 * With one, a threaded task `prompt` is ANSWERED (`task → ideal answer`), otherwise the
 * run output is REFINED (`run context → ideal version`); a teacher that fails, or whose
 * exemplar is below {@link TEACHER_MIN_OUTPUT_CHARS}, falls back to the raw run text.
 */
export async function distillEvermindEntry(
  env: Env,
  tenantId: number,
  teacher: EffectiveTeacher,
  student: DistillationStudent<EvermindAdaptation>,
  runText: string,
  opts?: { prompt?: string | null; signal?: AbortSignal },
): Promise<EvermindDistilledEntry> {
  if (teacher.model === null) {
    return { adapted: await student.adapt(runText), distilled: false, skipReason: teacher.reason };
  }
  const model = teacher.model;
  const prompt = (opts?.prompt ?? '').trim();
  const [input, mode] = prompt ? [prompt, 'answer' as const] : [runText, 'refine' as const];

  const port = gatewayTeacher(env, tenantId, model, mode, opts?.signal);
  const result = await new DistillationEngine(student, port).distill(input, {
    qualityGate: { minLength: TEACHER_MIN_OUTPUT_CHARS },
    fallbackText: runText,
    contextChars: TEACHER_CONTEXT_CHARS,
  });

  if (result.distilled) {
    return {
      adapted: result.adaptResult,
      distilled: true,
      teacherModel: port.answeredBy ?? model,
      exemplar: result.teacherOutput,
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
  };
}

function errorText(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}
