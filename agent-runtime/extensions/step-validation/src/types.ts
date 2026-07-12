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
  step_id: string;
  step_name?: string;
  input_contract?: Schema;
  output_contract?: Schema;
  mode?: ContractMode;
  failure_mode?: FailureMode;
  description?: string;
  version?: string;
};

/** Validation result: success or error + structural details */
export type ValidationResult =
  | {
      ok: true;
      output: unknown;
    }
  | {
      ok: false;
      error: ValidationError;
    };

/** Validation error event emitted on failure (FR-4) */
export type ValidationError = {
  step_id: string;
  step_name?: string;
  contract_type: "input" | "output";
  failed_rules: ReadonlyArray<{
    readonly field_path: string;
    readonly constraint: string;
    readonly actual_value: unknown;
  }>;
  pipeline_run_id?: string;
  timestamp: string;
  failure_mode?: FailureMode;
  actor?: string;
};

/** Validation hook context (LLM tool-call or equivalent) */
export type ValidationHookContext = {
  run_id?: string;
  source?: string;
  metadata?: Readonly<Record<string, unknown>>;
};

/**
 * LLM tool-call pre-hook signature:
 * Called BEFORE the tool executes (pre validation) if an input_contract is present.
 * Returns a step_id derived from metadata or uses a default, then returns a { ok: false, error: ValidationError } | { ok: true, validated_input: unknown } result, to be consumed by the caller.
 *
 * Hooks MUST consume latest plugin config each call to ensure enforce/enforced behavior respects mode.
 */
export type PreInputValidationHook = (
  ctx: ValidationHookContext & Readonly<{ input: unknown }>
) => Promise<
  | { ok: false; error: ValidationError }
  | { ok: true; validated_input: unknown }
>;

/**
 * LLM tool-call post-hook signature:
 * Called AFTER the tool returns (post validation) if an output_contract is present.
 * Returns a step_id derived from metadata or uses a default, then returns a { ok: false, error: ValidationError } | { ok: true, validated_output: unknown } result, to be consumed by the caller.
 *
 * Hooks MUST consume latest plugin config each call to ensure enforce/enforced behavior respects mode.
 */
export type PostOutputValidationHook = (
  ctx: ValidationHookContext & Readonly<{ output: unknown }>
) => Promise<
  | { ok: false; error: ValidationError }
  | { ok: true; validated_output: unknown }
>;

/** LLM tool-call pre/post hook pair for use with @validate_step or hybrid sync/async composition */
export type ValidationHooks = {
  pre?: PreInputValidationHook;
  post?: PostOutputValidationHook;
};