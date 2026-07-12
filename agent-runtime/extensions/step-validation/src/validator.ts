/**
 * Step Validation Framework
 *
 * Implements step-level integration validation that:
 * - Validates input payloads against an InputContract before step execution.
 * - Validates output payloads against an OutputContract after step execution.
 * - Halts execution on validation failure.
 * - Emits structured validation diagnostics (ValidationError events, OpenTelemetry span attributes, etc.).
 * - Supports multiple contract languages (JSON Schema is the primary implementation).
 *
 * @module step-validation/validator
 */

'use strict';

import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';
import AjvFormats from 'ajv-formats';

/* -----------------------------------------------------------------------------
 * Constants
 * ----------------------------------------------------------------------------- */

const DEFAULT_VALIDATE_STEP_TOOL_NAME = 'validate_step';
const DEFAULT_IS_VALID_TOOL_NAME = 'is_valid';

/* -----------------------------------------------------------------------------
 * Types
 * ----------------------------------------------------------------------------- */

/**
 * Represents a validated field-level constraint.
 */
export interface FieldConstraint {
  path: string;
  constraint: string;
  expectedValue?: unknown;
  actualValue?: unknown;
}

/**
 * Validation failure details.
 */
export interface ValidationError {
  step_id: string;
  step_name: string;
  contract_type: 'input' | 'output';
  failed_rules: FieldConstraint[];
  pipeline_run_id?: string;
  timestamp: string;
  message?: string;
}

/**
 * Validation result summary.
 */
export interface ValidationResult {
  step_id: string;
  step_name: string;
  input_contract?: JSONSchemaType<unknown> | null;
  output_contract?: JSONSchemaType<unknown> | null;
  validation_actions:
    | { result: 'pass' }
    | { result: 'fail'; errors: ValidationError[] };
}

/**
 * Configuration for a step-level validation action.
 */
export interface ValidationAction {
  name: string;
  /**
   * Enforced by default; 'audit-only' logs but never halts execution; 'disabled' skips validation entirely.
   */
  enforcementMode: 'enforced' | 'audit-only' | 'disabled';
  /**
   * Contract payload: either a literal JSON Schema object in the config, a schema file path, or null.
   * Schema file path takes precedence if it exists.
   */
  contractSchema: Record<string, unknown> | string | null;
}

/* -----------------------------------------------------------------------------
 * Access to OTel Telemetry Service (via global DI for testing)
 * ----------------------------------------------------------------------------- */

/**
 * Global reference to the OtelTelemetryService for emitting validation failures.
 * This can be injected in tests.
 */
let globalOtelTelemetryService: OtelTelemetryService | undefined = undefined;

/**
 * Set the global OtelTelemetryService instance (for tests).
 */
export function setGlobalOtelTelemetryService(otel: OtelTelemetryService): void {
  globalOtelTelemetryService = otel;
}

/**
 * Retrieves the instance of the OtelTelemetryService; throws if not configured.
 */
export function getGlobalOtelTelemetryService(): OtelTelemetryService {
  if (!globalOtelTelemetryService) {
    throw new Error(
      'OtelTelemetryService is not configured. Cannot emit validation trace attributes.'
    );
  }
  return globalOtelTelemetryService;
}

/* -----------------------------------------------------------------------------
 * Step Validator Implementations (JSON Schema)
 * ----------------------------------------------------------------------------- */

/**
 * Base validator for JSON Schema contract validation.
 */
export class BaseValidator {
  /**
   * wrapper errors with additional metadata (e.g., stepping context)
   */
  protected wrapError(err: unknown, stepName: string): ValidationError {
    const message = (err instanceof Error ? err.message : 'Unknown error') ?? 'Unknown error';
    return {
      step_id: stepName,
      step_name: stepName,
      contract_type: 'input',
      failed_rules: [],
      timestamp: new Date().toISOString(),
      message,
    };
  }
}

/**
 * Validator for InputContract and OutputContract expressed as JSON Schema.
 * Uses the AJV validator for schema enforcement.
 */
export class SchemaValidator extends BaseValidator {
  private ajv: Ajv;

  constructor() {
    super();

    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      coerceTypes: true,
      removeAdditional: 'all',
    });

    AjvFormats(this.ajv);
  }

  /**
   * Validates a payload against a JSON Schema contract.
   *
   * @param payload - Payload to validate.
   * @param contract - The JSON Schema contract.
   * @param stepName - Name of the step (for error metadata).
   * @returns An array of ValidationError objects if validation fails; otherwise, an empty array.
   */
  validateAgainstSchema(
    payload: unknown,
    contract: Record<string, unknown>,
    stepName: string
  ): ValidationError[] {
    const validate: ValidateFunction = this.ajv.compile(contract);

    const valid = validate(payload);

    if (valid) {
      return [];
    }

    const errors: ValidationError[] = [];
    for (const error of validate.errors ?? []) {
      const path = error.instancePath ?? '(root)';
      errors.push({
        step_id: stepName,
        step_name: stepName,
        contract_type: 'input',
        failed_rules: [
          {
            path,
            constraint: error.message ?? 'Unknown constraint',
            expectedValue: error.params?.expectedValue,
            actualValue: error.params?.actualValue,
          },
        ],
        timestamp: new Date().toISOString(),
        message: error.message,
      });
    }

    return errors;
  }
}

/**
 * Executes validation actions (pre-step and post-step).
 */
export class StepValidationExecutor extends BaseValidator {
  private readonly schemaValidator: SchemaValidator;

  constructor() {
    super();
    this.schemaValidator = new SchemaValidator();
  }

  /**
   * Validates step inputs against an InputContract (pre-execution).
   *
   * @param stepId - Identifier for the step.
   * @param payload - The incoming payload to validate.
   * @param inputContract - The JSON Schema for the InputContract.
   * @param enforcementMode - Enforcement mode ('enforced' | 'audit-only' | 'disabled').
   *
   * @returns True if validation passed or not required; false if validation failed and enforced.
   */
  validateInput(
    stepId: string,
    payload: unknown,
    inputContract: Record<string, unknown> | null | undefined,
    enforcementMode: 'enforced' | 'audit-only' | 'disabled' = 'enforced'
  ): boolean {
    if (!inputContract) {
      // No contract provided; skip validation.
      return true;
    }

    if (enforcementMode === 'disabled' || enforcementMode === 'audit-only') {
      // Log and continue without halting.
      this.logValidationFailure(
        stepId,
        payload,
        inputContract,
        enforcementMode,
        'audit-only'
      );
      return true;
    }

    const errors = this.schemaValidator.validateAgainstSchema(
      payload,
      inputContract,
      stepId
    );

    if (errors.length > 0) {
      // Emit validation failure(s) to OTel and default to halting.
      this.logValidationFailure(stepId, payload, inputContract, 'enforced', 'fail', errors);
      return false;
    }

    return true;
  }

  /**
   * Validates step outputs against an OutputContract (post-execution).
   *
   * @param stepId - Identifier for the step.
   * @param payload - The output of the step to validate.
   * @param outputContract - The JSON Schema for the OutputContract.
   * @param enforcementMode - Enforcement mode ('enforced' | 'audit-only' | 'disabled').
   *
   * @returns True if validation passed or not required; false if validation failed and enforced.
   */
  validateOutput(
    stepId: string,
    payload: unknown,
    outputContract: Record<string, unknown> | null | undefined,
    enforcementMode: 'enforced' | 'audit-only' | 'disabled' = 'enforced'
  ): boolean {
    if (!outputContract) {
      // No contract provided; skip validation.
      return true;
    }

    if (enforcementMode === 'disabled' || enforcementMode === 'audit-only') {
      // Log and continue without halting.
      this.logValidationFailure(
        stepId,
        payload,
        outputContract,
        enforcementMode,
        'audit-only'
      );
      return true;
    }

    const errors = this.schemaValidator.validateAgainstSchema(
      payload,
      outputContract,
      stepId
    );

    if (errors.length > 0) {
      // Emit validation failure(s) to OTel and default to halting.
      this.logValidationFailure(stepId, payload, outputContract, 'enforced', 'fail', errors);
      return false;
    }

    return true;
  }

  /**
   * Logs validation failure(s) to the global OTel DDS.
   */
  private logValidationFailure(
    stepId: string,
    payload: unknown,
    contract: Record<string, unknown>,
    enforcementMode: 'enforced' | 'audit-only' | 'disabled',
    outcome: 'pass' | 'fail',
    errors?: ValidationError[]
  ): void {
    const otel = getGlobalOtelTelemetryService();

    // OpenTelemetry span attributes:
    // Validation outcome (pass/fail).
    otel.setValidationTraceAttribute(`${stepId}.validation.status`, outcome);

    // Validation mode (enforced/audit-only/disabled).
    otel.setValidationTraceAttribute(
      `${stepId}.validation.mode`,
      enforcementMode
    );

    if (errors && errors.length > 0) {
      // Validation failed.
      otel.setValidationTraceAttribute(
        `${stepId}.validation.error_count`,
        errors.length
      );

      /**
       * Emit a structured validation failure event as an operation to the DDS.
       *
       * Note: The DDS’s `submitOperation` might expect an operation payload; docstring says:
       * "When code emits a diagnostic event, use a high-cardinality event with a stable name
       *  and a JSON payload. The Prometheus metrics for this event’s observedUser property
       *  will be tracked." We treat validation failures as high-cardinality events. There is
       *  no explicit EventBroker endpoint; we rely on the DDS’s support for offloaded
       *  high-cardinality events. We adjust the event payload keys to match the DDS docs.
       */
      for (const err of errors) {
        const validEventPayload = {
          validation_type: 'StepValidationError',
          step_id: err.step_id,
          step_name: err.step_name,
          contract_type: err.contract_type,
          failed_rules: err.failed_rules,
          pipeline_run_id: err.pipeline_run_id ?? undefined,
          timestamp: err.timestamp,
          message: err.message ?? undefined,
        };

        otel.submitOperation(validEventPayload);
      }
    } else {
      // Validation succeeded.
      otel.setValidationTraceAttribute(
        `${stepId}.validation.error_count`,
        0
      );
    }
  }
}

/* -----------------------------------------------------------------------------
 * Global Validator Instance (for DI in wiring/frameworks)
 * ----------------------------------------------------------------------------- */

let globalValidatorInstance: StepValidationExecutor | null = null;

/**
 * Returns the global validator instance (for dependency injection).
 * Defaults to a fresh instance if not yet configured.
 */
export function getGlobalValidatorInstance(): StepValidationExecutor {
  if (!globalValidatorInstance) {
    globalValidatorInstance = new StepValidationExecutor();
  }
  return globalValidatorInstance;
}

/**
 * Instantiation of the step-validation module.
 */
export function createValidator(): StepValidationExecutor {
  return new StepValidationExecutor();
}

/* -----------------------------------------------------------------------------
 * Plug-and-play entry point for runtimes
 * ----------------------------------------------------------------------------- */

/**
 * Creates a simple middleware/decorator that can be used in any lightweight runtime.
 *
 * Example usage in Python:
 *   const wrapper = createRuntimeMiddleware('my_step', ...);
 *
 * This middleware respects enforcement mode (enforced/audit-only/disabled).
 */
export function createRuntimeMiddleware(
  stepId: string,
  enforcementMode: 'enforced' | 'audit-only' | 'disabled',
  inputContract?: Record<string, unknown> | null,
  outputContract?: Record<string, unknown> | null
): {
  pre: (ctx: unknown) => boolean;
  post: (result: unknown) => boolean;
} {
  const validator = getGlobalValidatorInstance();

  const pre = (ctx: unknown): boolean => {
    if (!validator.validateInput(stepId, ctx, inputContract, enforcementMode)) {
      // Validation failed; execution is halted.
      return false;
    }
    return true;
  };

  const post = (result: unknown): boolean => {
    if (!validator.validateOutput(stepId, result, outputContract, enforcementMode)) {
      // Validation failed; terminate.
      return false;
    }
    return true;
  };

  return { pre, post };
}

/* -----------------------------------------------------------------------------
 * Exports
 * ----------------------------------------------------------------------------- */

export type {
  FieldConstraint,
  ValidationError,
  ValidationResult,
  ValidationAction,
};
export {
  DEFAULT_VALIDATE_STEP_TOOL_NAME,
  DEFAULT_IS_VALID_TOOL_NAME,
  Ajv,
  AjvFormats,
  validator as globalValidator,
};
export {};