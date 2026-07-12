/**
 * Type definitions for the Step Validation extension.
 */

/**
 * Represents a contract type.
 */
export type ContractType = 'input' | 'output';

/**
 * Represents the enforcement mode for a contract.
 */
export type EnforcementMode = 'enforced' | 'audit-only' | 'disabled';

/**
 * Holds information about a single validation rule that failed.
 */
export interface FailedRule {
  /**
   * JSON path to the field that violated the rule.
   */
  fieldPath: string;

  /**
   * The rule that failed validation, e.g., 'nonNull', 'range(0,100)', 'regex(pattern)'.
   */
  rule: string;

  /**
   * The constraint that was violated.
   */
  constraint: string;

  /**
   * The actual value that caused the failure.
   */
  value?: unknown;
}

/**
 * Diagnostics from a validation failure event.
 */
export interface ValidationResult {
  /**
   * The type of contract that failed validation.
   */
  contractType: ContractType;

  /**
   * The name of the step where the contract violation occurred.
   */
  stepName: string;

  /**
   * The ID of the step.
   */
  stepId: string;

  /**
   * The ID of the pipeline run. Optional for local validation.
   */
  pipelineRunId?: string;

  /**
   * Timestamp of the failure.
   */
  timestamp?: string;

  /**
   * The list of rules that failed.
   */
  failedRules: FailedRule[];
}

/**
 * Represents validation progress for a specific contract file.
 */
export interface ContractValidationResult {
  /**
   * The validated contract.
   */
  contract: unknown;

  /**
   * The file path to the contract.
   */
  path: string;

  /**
   * All validation errors for this contract.
   */
  errors: ValidationResult[];
}

/**
 * The result of a validateContracts call.
 */
export interface ValidateContractsResult {
  status: 'success' | 'error';
  successCount: number;
  failureCount: number;
  parsedCount?: number;
  failures?: ContractValidationResult[];
  errorMessage?: string;
}

/**
 * Represents an arbitrary tool invocation payload.
 */
export type Payload = unknown;

/**
 * Function type for custom validation logic.
 */
export type ValidationFunction = (payload: Payload) => Promise<ValidationResult | null>;

/**
 * Mutable config state needed at runtime but not part of the public contract schema.
 */
export interface StepValidationConfigState {
  /**
   * Enforcement mode.
   */
  enforcement: EnforcementMode;

  /**
   * Flag whether pre-step input validation is enabled.
   */
  enforceInput: boolean;

  /**
   * Flag whether post-step output validation is enabled.
   */
  enforceOutput: boolean;

  /**
   * Optional actor identity to log when overrides happen.
   */
  actorId?: string;

  /**
   * Optional override configuration (e.g., environment).
   */
  override?: Record<string, unknown>;
}

// Note: node:console.error is typed as (message?: any, ...optionalParams: any[]) => void, and does NOT export a named `error`. Keeping a stub in sync with the CLI's error handling pattern.
// export { error } from 'node:console'; // not exported as a named export