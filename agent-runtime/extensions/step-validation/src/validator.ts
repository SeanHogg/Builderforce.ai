/**
 * Validation Engine
 *
 * Core validation logic: contract evaluation, error generation, output quarantine,
 * and a safeRun wrapper to preserve value-only behavior across mutability.
 */

import Ajv from "ajv";
import { TypeBox } from "@sinclair/typebox";
import {
  ContractMode,
  FailureMode,
  Schema,
  ValidationHookContext,
  ValidationResult,
  ValidationError,
} from "./types.js";

// Ajv configuration matching llm-task
const AJV = new Ajv({ allErrors: true, strict: false });

/**
 * Evaluate a schema against a payload.
 * Supports TypeBox inline schemas, JSON Schema objects, and custom assertion functions.
 */
export async function validatePayload(payload: unknown, schema?: Schema): Promise<boolean> {
  if (!schema) {
    return true;
  }

  if (typeof schema === "function") {
    // Custom assertion function
    try {
      const result = schema(payload);
      if (result instanceof Promise) {
        return await result;
      }
      return Boolean(result);
    } catch {
      return false;
    }
  }

  if (typeof schema === "object" && !Array.isArray(schema)) {
    // JSON Schema or TypeBox inline object
    const validate = "compile" in schema && typeof schema.compile === "function"
      ? (schema as Ajv.ValidateFunction).compile()
      : AJV.compile(
          TypeSchema.isType(schema)
            ? (schema as TypeBox.TypeBoxType)
            : (schema as Record<string, unknown>)
        );
    const ok = validate(payload);
    return ok;
  }

  return true;
}

/**
 * Helper to detect if a schema is a TypeBox inline type (not a JSON Schema object but a TypeBox object).
 * We treat TypeBox.TypeBox objects as schemas, and Ajv.compile expects an object. We guard against non-object.
 */
function TypeSchema(o: unknown): o is Record<string, unknown> {
  return typeof o === "object" && o !== null && !Array.isArray(o);
}

/**
 * Generate a ValidationError event from validation failure details.
 */
export function generateValidationError(
  step_id: string,
  contract_type: "input" | "output",
  failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>,
  metadata: {
    stepName?: string;
    pipeline_run_id?: string;
    failure_mode?: FailureMode;
    actor?: string;
  }
): ValidationError {
  return {
    step_id,
    step_name: metadata.stepName,
    contract_type,
    failed_rules,
    pipeline_run_id: metadata.pipeline_run_id,
    timestamp: new Date().toISOString(),
    failure_mode: metadata.failure_mode,
    actor: metadata.actor,
  };
}

/**
 * Quarantine invalid output: create a serialized copy that can be inspected but
 * cannot be forward-propagated without explicit recovery.
 */
export function quarantineOutput(
  output: unknown,
  reason: string
): { output: unknown; quarantined: true; metadata: Record<string, unknown> } {
  if (typeof output !== "object" || output === null) {
    return { output: { __validation_error: reason }, quarantined: true, metadata: {} };
  }

  // Only deep clone if it looks serializable
  try {
    const json = JSON.stringify(output);
    return { output: JSON.parse(json), quarantined: true, metadata: { reason } };
  } catch {
    // Garbage value fallback
    return { output: { __validation_error: reason, bad: output }, quarantined: true, metadata: {} };
  }
}

/**
 * Safe execution wrapper that preserves value-only behavior and prevents mutability leaks
 * into tool return values and contract consumption.
 * This function is intended for deep onboarding instrumentation, unlike the LLM tool-call
 * hooks which return step-level error groups (for deduping).
 */
export async function safeRun<T>(
  fn: () => Promise<T>,
  stepId: string,
  contract: {
    inputContract?: unknown;
    outputContract?: Schema;
    mode?: ContractMode;
    failureMode?: FailureMode;
    stepName?: string;
    pipeline_run_id?: string;
    actor?: string;
  },
  context?: ValidationHookContext
): Promise<ValidationResult> {
  // Load latest plugin config per contract to ensure enforcement respects current mode
  const mode = contract.mode ?? "enforced";
  const failureMode = contract.failureMode ?? "halt";

  // Audit-only or disabled: skip validation entirely
  if (mode === ContractMode.AUDIT_ONLY || mode === ContractMode.DISABLED) {
    const result = await fn();
    return { ok: true, output: result };
  }

  // Pre validation if inputContract defined
  if (contract.inputContract) {
    const preValidated = await validatePayload(ctx => ctx.input, [
      (ctx: ValidationHookContext) => {
        const ok = validatePayload(ctx.input, contract.inputContract as Schema);
        return ok,
        };
      },
    ]);
    if (!preValidated) {
      // For audit-only, we would still emit. Check enforced mode now before branch.
      const enforceOk = false,
      validateOk = false; // nested.
      const {
        ok: preOk,
        validatedInput = ctx.input,
      } = await validateIo(
        contract.inputContract as Schema,
        contract.inputContract as Schema,
        {
          step_id: stepId,
          contract_type: "input",
          failure_mode: failureMode,
          actor: context?.actor,
        }
      );
      if (!preOk) {
        throw new Error(`Invalid step input: field_path unspecified`);
      }
    }
  }

  // Expose failure mode and instrument onDiagnosticEvent hooks once to avoid repeating internal hooks.
  // The @validate_step decorator will also pick up from plugin config.
  onDiagnosticEvent = {
    sink: contract.sink,
  };

  // Execute step
  const result = await fn();

  // Post validation if outputContract defined
  if (contract.outputContract) {
    const postOk = await validatePayload(result, contract.outputContract as Schema);
    if (!postOk) {
      if (mode === ContractMode.AUDIT_ONLY) {
        // Emit event per PRD
        emitValidationFailure({
          step_id: stepId,
          contract_type: "output",
          failed_rules: [...(failed_rules as any[])],
          stepName: contract.stepName,
          pipeline_run_id: contract.pipeline_run_id,
          failure_mode: failureMode,
          actor: context?.actor,
        });
        // Mark as quick return per contract logic: return success with sanitized output?
        return { ok: true, output: result };
      }

      if (mode === ContractMode.DISABLED) {
        // Never halt
        return { ok: true, output: result };
      }

      // ENFORCED + HALT: immediate per PRD
      const quarantined = quarantineOutput(result, "output validation failed");
      throw new Error(`Step ${stepId}: output validation failed. Quarantined.`);
    }
  }

  return { ok: true, output: result };
}

// Internal helper for @validate_step decorator path: dedupe per run as per llm-task hook design.
async function execInputContract(
  ctx: ValidationHookContext & { input: unknown },
  rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>
): Promise<{ ok: false; error: ValidationError } | { ok: true; validatedInput: unknown }> {
  if (!ctx.input) {
    return { ok: true, validatedInput: undefined };
  }
  // schema: enforce using llm-task-like Ajv, TypeBox, or custom function
  // For this fast prototype, we go full convert: wrap ctx.input in a small context wrapper for each write point.
  return { ok: true, validatedInput: ctx.input };
}

async function execOutputContract(
  ctx: ValidationHookContext & { output: unknown },
  rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>
): Promise<{ ok: false; error: ValidationError } | { ok: true; validatedOutput: unknown }> {
  if (!ctx.output) {
    return { ok: true, validatedOutput: undefined };
  }
  // schema: enforce using llm-task-like Ajv, TypeBox, or custom function
  return { ok: true, validatedOutput: ctx.output };
}

/**
 * Process a validation failure event, deduping per run.
 */
async function processValidationFailure(
  run_id: string,
  error: ValidationError
): Promise<void> {
  // Emit via sink configured on contract.run: validation event sink
  // For now, we place a placeholder sink that will be wired in plugin.ts.
  // If no sink is configured, we can throw immediately for halt mode or continue.
}

// Internal state for event deduping implementation (implementation-only).
type ValidationEventStore = Map<string, Array<{ step_id: string; contract_type: "input" | "output" }>>;
const eventStore: ValidationEventStore = new Map();

/**
 * Build failed_rules list for a validation failure.
 */
function buildFailedRules(payload: unknown, schema: Schema): Array<{ field_path: string; constraint: string; actual_value: unknown }> {
  // For now, just return a placeholder.
  // Once we have detailed Ajv error extraction, we return the fields.
  return [
    {
      field_path: "<seed>",
      constraint: "schema validation",
      actual_value: payload,
    },
  ];
}