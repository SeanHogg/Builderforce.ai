/** Validation Engine

Core validation logic: contract evaluation, error generation, output quarantine,
and a safeRun wrapper. Works both inside the plugin and offline (CLI).
*/

import Ajv, { ValidateFunction } from "ajv";
import { buildFailedRules, applyConstraint, type ValidatedRule } from "./rules.js";
import type { ContractMode, FailureMode, Schema } from "./types.js";

const AJV = new Ajv({ allErrors: true, strict: false });

/** Evaluate a schema against a payload. Supports JSON Schema or assertion function. */
export async function validatePayload(payload: unknown, schema?: Schema): Promise<{
  ok: boolean;
  errors?: Array<{ field_path: string; constraint: string; actual_value: unknown }>;
}> {
  if (!schema) {
    return { ok: true };
  }
  if (typeof schema === "function") {
    try {
      const result = schema(payload);
      return result instanceof Promise
        ? { ok: await result, errors: result instanceof Promise ? [{ field_path: "<function_check>", constraint: "custom assertion", actual_value: payload }] : [] }
        : { ok: Boolean(result), errors: !result ? [{ field_path: "<function_check>", constraint: "custom assertion", actual_value: payload }] : [] };
    } catch (e) {
      return { ok: false, errors: [{ field_path: "<function_check>", constraint: e instanceof Error ? e.message : "custom assertion failed", actual_value: payload }] };
    }
  }
  let validate: ValidateFunction;
  if ("compile" in schema && typeof schema.compile === "function") {
    validate = schema.compile();
  } else if (typeof schema === "object" && schema.jsonSchemaVersion === "https://json-schema.org/draft/2020-12/schema") {
    validate = AJV.compile(schema);
  } else {
    validate = AJV.compile(schema);
  }
  const valid = validate(payload);
  return {
    ok: valid,
    errors: valid
      ? undefined
      : validate.errors?.map((e) => ({
          field_path: e.instancePath || "<root>",
          constraint: e.message || "validation failed",
          actual_value: (payload as any)[e.instancePath?.replace(/^\./, "")] ?? payload,
        })) ?? [{ field_path: "<schema_check>", constraint: "JSON Schema validation failed", actual_value: payload }],
  };
}

/** Dedupe validation events by run_id and step_id/type. */
type RunLock = Map<string, Map<string, Set<"input" | "output">>>;
const runLock: RunLock = new Map();

export function dedupeValidationFailure(run_id: string, step_id: string, contract_type: "input" | "output"): boolean {
  if (!run_id || !step_id) return false;
  const run = runLock.get(run_id) ?? new Map();
  const key = `${contract_type}`;
  const atype = run.get(key) ?? new Set();
  if (atype.has(key)) return false;
  atype.add(key);
  run.set(key, atype);
  runLock.set(run_id, run);
  return true;
}

/** Reset run locks (useful for per-run testing). */
export function resetRunLocks(): void {
  runLock.clear();
}

/** Mark a validation failure as emitted. */
export function setValidationEmit(run_id: string, step_id: string, contract_type: "input" | "output"): void {
  const run = runLock.get(run_id) ?? new Map();
  const key = `${contract_type}`;
  const atype = run.get(key) ?? new Set();
  atype.add(key);
  run.set(key, atype);
  runLock.set(run_id, run);
}

/** Generate a ValidationError event from validation failure details. */
export function generateValidationError(
  step_id: string,
  contract_type: "input" | "output",
  failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>,
  metadata: {
    step_name?: string;
    pipeline_run_id?: string;
    failure_mode?: FailureMode;
    actor?: string;
    timestamp?: string;
  } = {},
): { step_id: string; step_name?: string; contract_type: "input" | "output"; failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>; pipeline_run_id?: string; timestamp?: string; failure_mode?: FailureMode; actor?: string } {
  return {
    step_id,
    step_name: metadata.step_name,
    contract_type,
    failed_rules,
    pipeline_run_id: metadata.pipeline_run_id,
    timestamp: metadata.timestamp ?? new Date().toISOString(),
    failure_mode: metadata.failure_mode,
    actor: metadata.actor,
  };
}

/** Quarantine invalid output. */
export function quarantineOutput(output: unknown, reason: string): { output: unknown; quarantined: boolean; metadata?: Record<string, unknown> } {
  if (typeof output !== "object" || output === null) {
    return { output: { __validation_error: reason }, quarantined: true };
  }
  try {
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);
    return { output: parsed, quarantined: true, metadata: { reason } };
  } catch {
    return { output: { __validation_error: reason, bad: output }, quarantined: true };
  }
}

/** Pre-input validation hook. Works outside the plugin too. */
export async function preInputValidation(
  ctx: { run_id?: string; source?: string; metadata?: { step_name?: string; pipeline_run_id?: string } },
  payload: unknown,
  schema?: Schema,
): Promise<{
  ok: boolean;
  error?: { step_id: string; contract_type: "input"; failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>; actor?: string; run_id?: string };
  validated_input?: unknown;
} | {
  ok: false;
  error: { step_id: string; contract_type: "input"; failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>; actor?: string; run_id?: string };
}> {
  const result = await validatePayload(payload, schema);
  if (result.ok) {
    return { ok: true, validated_input: payload };
  }
  return {
    ok: false,
    error: {
      step_id: ctx.run_id || "unknown",
      contract_type: "input",
      failed_rules: result.errors ?? [],
      actor: ctx.source,
      run_id: ctx.run_id,
    },
  };
}

/** Post-output validation hook. Works outside the plugin too. */
export async function postOutputValidation(
  ctx: { run_id?: string; source?: string; metadata?: { step_name?: string; pipeline_run_id?: string } },
  output: unknown,
  schema?: Schema,
): Promise<{
  ok: boolean;
  error?: { step_id: string; contract_type: "output"; failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>; actor?: string; run_id?: string };
  validated_output?: unknown;
} | {
  ok: false;
  error: { step_id: string; contract_type: "output"; failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>; actor?: string; run_id?: string };
}> {
  const result = await validatePayload(output, schema);
  if (result.ok) {
    return { ok: true, validated_output: output };
  }
  return {
    ok: false,
    error: {
      step_id: ctx.run_id || "unknown",
      contract_type: "output",
      failed_rules: result.errors ?? [],
      actor: ctx.source,
      run_id: ctx.run_id,
    },
  };
}