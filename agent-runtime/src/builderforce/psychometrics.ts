/**
 * Psychometric persona engine (Pro feature) — runtime glue.
 *
 * The deterministic **compiler** (trait vector -> directives + exec params) now
 * lives in the shared `@builderforce/agent-tools` package so the cloud engine
 * (`api`), the on-prem runtime, and the VS Code agent all compile a persona the
 * same way. This module re-exports it and keeps the runtime-specific glue: the
 * richer {@link PsychometricProfile} shape, the {@link AgentRole} accessor, and
 * {@link raiseThinkLevel} (which treats a persona's think level as a floor).
 *
 * --- Cross-package contract ---
 * The catalog the UI renders (framework names, dimension labels, the
 * questionnaire bank, server-side scoring, persistence, and the Pro gate) lives
 * in the `api` package, which serves it to the frontend. The behavioural
 * semantics (vector -> directives + params) live in agent-tools. The two sides
 * are coupled solely by the dimension-id strings in {@link DIM}. Keep them in sync.
 */
import {
  PSYCH_DIM,
  maxThink,
  compilePsychometricProfile,
  buildPsychometricBlock,
  mergeExecParams,
  type AgentExecParams,
  type CompiledPsychometrics,
} from "@builderforce/agent-tools";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { AgentRole } from "./types.js";

// The compiler + block/merge helpers are the shared, single-source behaviour.
export { compilePsychometricProfile, buildPsychometricBlock, mergeExecParams };
export type { CompiledPsychometrics };

// ---------------------------------------------------------------------------
// Trait vector model
// ---------------------------------------------------------------------------

/**
 * Canonical dimension ids — re-exported from the single shared map
 * (`@builderforce/agent-tools` PSYCH_DIM), the same one the api catalog and the
 * limbic setpoint derivation read. Every score in a profile vector is keyed by
 * one of these; scores are 0..100, an absent dimension is neutral (50).
 */
export const DIM = PSYCH_DIM;

export type DimensionId = (typeof DIM)[keyof typeof DIM];

/** A persona's psychometric makeup. Attached to {@link AgentRole}'s persona. */
export type PsychometricProfile = {
  /** dimension-id -> 0..100 score. Absent dimension = neutral (50). */
  vector: Record<string, number>;
  /** Optional Enneagram core type (1..9) — typological, drives core motivation. */
  enneagramType?: number;
  /** Optional MBTI 4-letter code — a relatability skin, not behaviour-bearing. */
  mbti?: string;
  /** Framework ids the author opted into (informational, for the editor). */
  frameworks?: string[];
  /** Provenance of the vector. */
  source?: "sliders" | "questionnaire" | "imported";
  notes?: string;
};

/**
 * Execution levers a profile can nudge. Aliased to the canonical
 * {@link AgentExecParams} from `@builderforce/agent-tools` so the trait compiler,
 * the limbic compiler, and the {@link AgentSpec} lowering all speak one type.
 */
export type PsychometricExecParams = AgentExecParams;

/**
 * Treat a persona's think level as a *floor* on the requested one: personality may
 * deepen deliberation but never reduce it below what the operator asked for.
 * Returns the requested level when the persona contributes nothing.
 */
export function raiseThinkLevel(
  requested: ThinkLevel | undefined,
  floor: ThinkLevel | undefined,
): ThinkLevel | undefined {
  if (!floor) return requested;
  if (!requested) return floor;
  return maxThink(requested, floor);
}

/** Extract the psychometric profile carried by a role's persona, if any. */
export function getRoleProfile(role: AgentRole): PsychometricProfile | undefined {
  return role.persona?.psychometric;
}
