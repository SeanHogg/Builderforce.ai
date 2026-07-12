/**
 * Validation Engine
 *
 * Core validation logic: contract evaluation, error generation, output quarantine,
 * and a safeRun wrapper to preserve value-only behavior across mutability.
 */

import Ajv from "ajv";
import { Type } from "@sinclair/typebox";
import {
  ContractMode,
  FailureMode,
  Schema,
  ValidationHookContext,
  ValidationResult,
  ValidationError,
} from "./types.js";

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
    const validate =
      "compile" in schema && typeof schema.compile === "function"
        ? (schema as Ajv.ValidateFunction).compile()
        : AJV.compile(
            Type.Kind === "Type" && ((schema as any) as TypeBox.StrictBoxedType<any>).schema
              ? // TypeBox.type() produces a { schema: ... } wrapped object
                (schema as TypeBox.TypeBoxType)
              : (schema as Record<string, unknown>)
          );
    const ok = validate(payload);
    return ok;
  }

  return true;
}

/**
 * Generate a ValidationError event from validation failure details.
 */
export function generateValidationError(
  step_id: string,
  contract_type: "input" | "output",
  failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>,
  metadata: {
    step_name?: string;
    pipeline_run_id?: string;
    failure_mode?: FailureMode;
    actor?: string;
  }
): ValidationError {
  if (!failed_rules.length) {
    throw new Error(`contract_type "${contract_type}" endpoint no field details sourced`);
  }

  return {
    step_id,
    step_name: metadata.step_name,
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

  try {
    const json = JSON.stringify(output);
    return { output: JSON.parse(json), quarantined: true, metadata: { reason } };
  } catch {
    return { output: { __validation_error: reason, bad: output }, quarantined: true, metadata: {} };
  }
}

/**
 * Emit a validation failure to an observable sink managed by the plugin service.
 * This is intended to be hooked into onDiagnosticEvent in plugin.ts.
 */
export async function emitValidationFailure(
  error: ValidationError,
  sink: (event: unknown) => Promise<void>
): Promise<void> {
  if (!error.step_id || !error.contract_type) {
    throw new Error("emitValidationFailure requires step_id and contract_type");
  }
  if (!error.timestamp) {
    error.timestamp = new Date().toISOString();
  }
  await sink(error);
}

// Marker type for the sink provided by plugin.ts.
// Not imported here; used when validating external contracts (e.g., in CLI).
export type ValidationEventSink = (event: unknown) => Promise<void>;

// Per-run lock to prevent duplicate events for AC-1 (within 50 ms of receipt).
type RunLock = Map<string, Array<{ step_id: string; contract_type: "input" | "output" }>>;
const runLock: RunLock = new Map();

/**
 * Dedupe validation failures by run_id and step_id.
 */
export function dedupeValidationFailure(
  run_id: string,
  step_id: string,
  contract_type: "input" | "output"
): boolean {
  if (!run_id || !step_id) {
    return false;
  }
  const key = `${run_id}:${step_id}:${contract_type}`;
  if (runLock.has(key)) {
    return false;
  }
  const entry = runLock.get(run_id) ?? [];
  entry.push({ step_id, contract_type });
  runLock.set(run_id, entry);
  return true;
}

/**
 * Reset run locks (useful for per-run testing).
 */
export function resetRunLocks(): void {
  runLock.clear();
}

/**
 * Build failed_rules for a validation failure.
 */
export function buildFailedRules(payload: unknown, schema: Schema | undefined): Array<{ field_path: string; constraint: string; actual_value: unknown }> {
  if (!schema) {
    return [{ field_path: "<noselect>", constraint: "schema not supplied", actual_value: payload }];
  }

  if (typeof schema === "function") {
    return [{ field_path: "<function_check>", constraint: "custom assertion", actual_value: payload }];
  }

  if (typeof schema === "object" && !Array.isArray(schema)) {
    return [{ field_path: "<schema_check>", constraint: "JSON Schema / TypeBox", actual_value: payload }];
  }

  return [{ field_path: "<default>", constraint: "unknown schema format", actual_value: payload }];
}

/**
 * Pre-input validation hook (for use with @validate_step).
 */
export async function preInputValidation(
  ctx: ValidationHookContext & { input: unknown },
  schema: Schema | undefined,
  sink: ValidationEventSink,
  mode: ContractMode = ContractMode.ENFORCED,
  failureMode?: FailureMode
): Promise<{ ok: false; error: ValidationError } | { ok: true; validated_input: unknown }> {
  if (mode === ContractMode.DISABLED || mode === ContractMode.AUDIT_ONLY) {
    // Audit-only: always log; enforce-only mode will reject later
    const rules = buildFailedRules(ctx.input, schema);
    const error = generateValidationError(ctx.run_id || "unknown", "input", rules, {
      step_name: ctx.metadata?.step_name as string | undefined,
      pipeline_run_id: ctx.metadata?.pipeline_run_id as string | undefined,
      failure_mode: failureMode,
      actor: ctx.source,
    });
    if (mode === ContractMode.ENFORCED && failureMode !== FailureMode.WARN_AND_CONTINUE) {
      await emitValidationFailure(error, sink);
      return { ok: false, error };
    }
    return { ok: true, validated_input: ctx.input };
  }

  const valid = await validatePayload(ctx.input, schema);
  if (valid) {
    return { ok: true, validated_input: ctx.input };
  }

  const rules = buildFailedRules(ctx.input, schema);
  const error = generateValidationError(ctx.run_id || "unknown", "input", rules, {
    step_name: ctx.metadata?.step_name as string | undefined,
    pipeline_run_id: ctx.metadata?.pipeline_run_id as string | undefined,
    failure_mode: failureMode,
    actor: ctx.source,
  });
  await emitValidationFailure(error, sink);
  if (failureMode === FailureMode.WARN_AND_CONTINUE) {
    return { ok: true, validated_input: ctx.input };
  }
  return { ok: false, error };
}

/**
 * Post-output validation hook (for use with @validate_step).
 */
export async function postOutputValidation(
  ctx: ValidationHookContext & { output: unknown },
  schema: Schema | undefined,
  sink: ValidationEventSink,
  mode: ContractMode = ContractMode.ENFORCED,
  failureMode?: FailureMode
): Promise<{ ok: false; error: ValidationError } | { ok: true; validated_output: unknown }> {
  if (mode === ContractMode.DISABLED || mode === ContractMode.AUDIT_ONLY) {
    const rules = buildFailedRules(ctx.output, schema);
    const error = generateValidationError(ctx.run_id || "unknown", "output", rules, {
      step_name: ctx.metadata?.step_name as string | undefined,
      pipeline_run_id: ctx.metadata?.pipeline_run_id as string | undefined,
      failure_mode: failureMode,
      actor: ctx.source,
    });
    if (mode === ContractMode.ENFORCED && failureMode !== FailureMode.WARN_AND_CONTINUE) {
      await emitValidationFailure(error, sink);
      return { ok: false, error };
    }
    return { ok: true, validated_output: ctx.output };
  }

  const valid = await validatePayload(ctx.output, schema);
  if (valid) {
    return { ok: true, validated_output: ctx.output };
  }

  const rules = buildFailedRules(ctx.output, schema);
  const error = generateValidationError(ctx.run_id || "unknown", "output", rules, {
    step_name: ctx.metadata?.step_name as string | undefined,
    pipeline_run_id: ctx.metadata?.pipeline_run_id as string | undefined,
    failure_mode: failureMode,
    actor: ctx.source,
  });
  await emitValidationFailure(error, sink);
  if (failureMode === FailureMode.WARN_AND_CONTINUE) {
    return { ok: true, validated_output: ctx.output };
  }
  return { ok: false, error };
}