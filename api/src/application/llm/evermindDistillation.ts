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
 */

import { adaptAndDiff, type AdaptResult, type EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import { DistillationEngine, type DistillationStudent, type DistillationTeacher } from '@seanhogg/builderforce-memory/distillation';
import { stripRunNarration } from '@builderforce/agent-loop';
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
  /** What "Learned" should show: the exemplar when distilled, otherwise the run text
   *  with its narration stripped. Absent when nothing was learned. */
  learnedText?: string;
  /** True when the raw run text was ALL narration, so it was not learned from. */
  narrationOnly?: boolean;
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
  opts?: { prompt?: string | null; signal?: AbortSignal },
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

function errorText(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}
