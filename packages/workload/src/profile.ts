/**
 * The WORKLOAD PROFILE — what a call is about to cost and what kind of work it is,
 * read BEFORE a model is chosen.
 *
 * Every host derives it with this one function, so a turn in the editor, a cloud run
 * and an offline run with the same inputs are routed on the same reading. The profile
 * never names a model; turning it into one is the router's job.
 */

import { isModelRole, type ModelRole } from '@builderforce/agent-tools';
import type { ActionType } from '@builderforce/learned-routing';
import { classifyRunAction } from './actionClassifier.js';
import { isArcStage, type ArcStage } from './arcStage.js';

export interface WorkloadProfile {
  /** Declared call purpose; `undefined` when the caller declared none. Never guessed:
   *  a role is a caller decision, and inventing one would reorder a pool on a hunch. */
  role: ModelRole | undefined;
  arcStage: ArcStage | undefined;
  /** Lexical label of the instruction; `other` below the confidence floor. */
  actionType: ActionType;
  actionConfidence: number;
  /** Estimated prompt tokens for this call. */
  inputTokens: number;
  /** Expected completion tokens — the caller's cap when given, else the role's typical
   *  output (see {@link TYPICAL_OUTPUT_TOKENS}). */
  outputTokens: number;
  /** The call carries tools — an agent turn, not a one-shot answer. */
  agentic: boolean;
}

export interface WorkloadInput {
  role?: unknown;
  arcStage?: unknown;
  /** The instruction text the classifier reads (the latest user turn or ticket). */
  instruction?: string | null;
  inputTokens?: number;
  /** The caller's `max_tokens`, when set. */
  maxOutputTokens?: number;
  hasTools?: boolean;
}

/**
 * Typical completion size per role — an ESTIMATE used only to compare models by
 * expected cost when the caller set no cap. Code turns write the most; utility the
 * least. A role-less call uses {@link DEFAULT_OUTPUT_TOKENS}.
 */
export const TYPICAL_OUTPUT_TOKENS: Readonly<Record<ModelRole, number>> = {
  code: 4000,
  plan: 1500,
  verify: 800,
  explore: 1000,
  chat: 800,
  utility: 400,
};

export const DEFAULT_OUTPUT_TOKENS = 1000;

const nonNegative = (n: number | undefined): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;

/** Read a call into its profile. Pure. */
export function profileWorkload(input: WorkloadInput): WorkloadProfile {
  const role = isModelRole(input.role) ? input.role : undefined;
  const { actionType, confidence } = classifyRunAction(input.instruction);
  const cap = nonNegative(input.maxOutputTokens);
  const typical = role ? TYPICAL_OUTPUT_TOKENS[role] : DEFAULT_OUTPUT_TOKENS;
  return {
    role,
    arcStage: isArcStage(input.arcStage) ? input.arcStage : undefined,
    actionType,
    actionConfidence: confidence,
    inputTokens: nonNegative(input.inputTokens) ?? 0,
    outputTokens: cap !== undefined ? Math.min(cap, typical) : typical,
    agentic: input.hasTools === true,
  };
}
