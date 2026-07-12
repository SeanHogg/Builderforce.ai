/**
 * Type definitions for the Step Validation extension.
 */

/** Represents a contract type. */
export type ContractType = 'input' | 'output';

/** Enforcement mode for a contract. */
export type EnforcementMode = 'enforced' | 'audit-only' | 'disabled';

/** Result of a step validation action. */
export interface ValidationResult {
  /** Whether validation passed. */
  passed: boolean;
  /** Operation result (pass/fail). */
  action: 'pass' | 'fail';
  /** Errors that occurred, if any. */
  errors: ValidationError[];
}

/** Validation failure details. */
export interface ValidationError {
  /** Path to the field that failed validation. */
  fieldPath: string;
  /** The rule that failed, e.g., 'nonNull', 'range(0,100)', 'regex(pattern)'. */
  rule: string;
  /** The constraint that was violated. */
  constraint: string;
  /** The actual value that caused failure. */
  value?: unknown;
}

/** Validation failure event emitted on contract violations. */
export interface ValidationErrorEvent {
  type: 'validation.error';
  run_id?: string;
  step_id: string;
  step_name: string;
  contract_type: ContractType;
  failed_rules: ValidationError[];
  timestamp: string;
  message?: string;
}

/** Configuration for the step validation plugin. */
export interface ValidationPluginConfig {
  /** Default contract enforcement mode. */
  defaultContractMode: EnforcementMode;
  /** Default failure handling mode. */
  defaultFailureMode: 'halt' | 'warn-and-continue' | 'retry(3)' | 'branch-to-fallback';
  /** Actor identity for override logging (e.g., 'api-gateway', 'script-runner'). */
  source?: string;
}