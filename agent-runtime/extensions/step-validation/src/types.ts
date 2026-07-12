/**
 * Step Validation Types
 *
 * Core domain model for contract definitions, validation modes, failure handling
 * and error events.
 */

import { Type } from "@sinclair/typebox";

/** Schema representation: either a TypeBox inline schema, JSON Schema, or assertion function */
export type Schema =
  | Type.Any
  | Record<string, unknown>
  | ((input: unknown) => boolean | Promise<boolean>);

/** Contract modes: enforced (fail on violation), audit-only (log only), disabled (skip) */
export enum ContractMode {
  ENFORCED = "enforced",
  AUDIT_ONLY = "audit-only",
  DISABLED = "disabled",
}

/** Failure handling modes: halt, warn-and-continue, retry(n), branch-to-fallback */
export enum FailureMode {
  HALT = "halt",
  WARN_AND_CONTINUE = "warn-and-continue",
  RETRY = "retry",
  BRANCH_TO_FALLBACK = "branch-to-fallback",
}

/** Validation contract attached to a pipeline step */
export type StepContract = {
  stepId: string;
  stepName?: string;
  inputContract?: Schema;
  outputContract?: Schema;
  mode?: ContractMode;
  failureMode?: FailureMode;
  description?: string;
  version?: string;
};

/** Validation result: success or error + structural details */
export type ValidationResult =
  | { ok: true; output: unknown }
  | {
      ok: false;
      error: ValidationError;
    };

/** Validation error event emitted on failure (FR-4) */
export type ValidationError = {
  step_id: string;
  step_name?: string;
  contract_type: "input" | "output";
  failed_rules: Array<{
    field_path: string;
    constraint: string;
    actual_value: unknown;
  }>;
  pipeline_run_id?: string;
  timestamp: string;
  failure_mode?: FailureMode;
  actor?: string;
};

/** Validation hook context (LLM tool-call or equivalent) */
export type ValidationHookContext = {
  runId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  // Intentionally minimal: minimal payload for AGENTS SDK usage without deep routing
};

/**
 * LLM tool-call hook signature:
 * Called BEFORE the tool executes (pre validation) if an inputContract is present.
 * Returns a stepId from metadata or uses a default, then normalizes to a string.
 *
 * Hooks MUST consume latest plugin config each call to ensure enforce/enforced behavior respects mode.
 */
export type PreInputValidationHook = (
  ctx: ValidationHookContext & { input: unknown }
) => Promise<{ ok: false; error: ValidationError } | { ok: true; validatedInput: unknown }>;

/**
 * LLM tool-call hook signature:
 * Called AFTER the tool returns (post validation) if an outputContract is present.
 * Returns a stepId from metadata or uses a default, then normalizes to a string.
 *
 * Hooks MUST consume latest plugin config each call to ensure enforce/enforced behavior respects mode.
 */
export type PostOutputValidationHook = (
  ctx: ValidationHookContext & { output: unknown }
) => Promise<{ ok: false; error: ValidationError } | { ok: true; validatedOutput: unknown }>;

/** LLM tool-call pre/post hook pair for use with @validate_step or hybrid sync/async composition */
export type ValidationHooks = {
  pre?: PreInputValidationHook;
  post?: PostOutputValidationHook;
};