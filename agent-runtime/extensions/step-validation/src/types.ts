/**
 * Step Validation Types
 *
 * Types used by the step validation framework.
 */

'use strict';

/** Enforcement behavior for validation. */
export type EnforcementMode = 'enforced' | 'audit-only' | 'disabled';

/** Type of contract being validated. */
export type ContractType = 'input' | 'output';

/** A single validation rule failure. */
export type FailedRule = {
  /** Dot-notation JSON pointer path to failing field. */
  fieldPath: string;
  rule: string;
  constraint: string;
  value?: unknown;
};

/** Validation event emitted on failure. */
export type ValidationErrorEvent = {
  /** Unique identifier for validation this event is tied to (e.g., step_id). */
  validationId?: string;

  /** Unique identifier of the step that failed. */
  step_id: string;

  /** Name of the step that failed. */
  step_name: string;

  /** Type of contract being validated (input or output). */
  contract_type: ContractType;

  /** Detailed list of failed rules. */
  failed_rules: FailedRule[];

  /** Unique identifier of the pipeline run containing this step. */
  pipeline_run_id: string;

  /** ISO timestamp of the event. */
  timestamp: string;

  /** Enforcement mode that was in effect (diagnostic). */
  enforcement_mode: EnforcementMode;

  /** IDs of affected steps in a branching scenario (optional). */
  failed_step_ids?: string[];
};

/** Result of payload validation. */
export type ValidationResult = {
  valid: boolean;
  /** Failures encountered. */
  errors?: FailedRule[];
  /** In case of branching: IDs of other steps affected. */
  failedStepIds?: string[];
};