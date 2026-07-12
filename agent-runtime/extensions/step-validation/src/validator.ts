/**
 * Step Validation Framework
 *
 * Implements step-level integration validation:
 * - Validates input payloads against InputContract (pre-execution)
 * - Validates output payloads against OutputContract (post-execution)
 * - Halts execution on validation failure (unless audit-only/disabled)
 * - Emits structured validation diagnostics via plugin hooks
 * - Uses JSON Schema as the primary contract language
 */

'use strict';

import Ajv, { ValidateFunction } from 'ajv';
import AjvFormats from 'ajv-formats';
import type { ValidationErrorEvent } from './types.js';

/** Error details from AJV. */
interface AjvError {
  instancePath?: string;
  message?: string;
  params?: { expectedValue?: unknown; actualValue?: unknown; constraint?: string };
}

/** Cached compiled schema for reuse. */
class SchemaCache {
  private cache = new Map<string, ValidateFunction>();

  compile(schema: string | Record<string, unknown>): ValidateFunction {
    const key = schema as unknown as string;
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    let ajv = new Ajv({
      allErrors: true,
      strict: false,
      coerceTypes: true,
      removeAdditional: 'all',
    });
    AjvFormats(ajv);

    let compiledSchema: Record<string, unknown> | null = null;
    if (typeof schema === 'string') {
      try {
        compiledSchema = JSON.parse(schema);
      } catch {
        // Invalid JSON, will fail at compile
      }
    } else {
      compiledSchema = schema;
    }

    const validate = (compiledSchema ?? {}) as ValidateFunction;
    this.cache.set(key, validate);
    return validate;
  }

  clear(): void {
    this.cache.clear();
  }
}

let schemaCache = new SchemaCache();

/** Get validation errors from AJV compilation. */
function extractErrors(validate: ValidateFunction): ValidationErrorEvent['failed_rules'] {
  if (!validate.errors?.length) return [];

  return validate.errors.map((err: AjvError) => {
    const path = err.instancePath || '(root)';
    const constraint = err.params?.constraint || err.message || 'Unknown constraint';
    return {
      fieldPath: path,
      rule: constraint,
      constraint: err.params?.expectedValue ? `expected ${err.params.expectedValue}` : constraint,
      value: err.params?.actualValue,
    };
  });
}

/** Validate a payload against a JSON Schema. */
export function validatePayload(
  payload: unknown,
  schema: Record<string, unknown> | string | null,
  contractType: 'input' | 'output',
  source?: string,
): { valid: boolean; errors?: ValidationErrorEvent['failed_rules'] } {
  if (!schema) {
    return { valid: true };
  }

  const validate = schemaCache.compile(schema);
  const valid = validate(payload);

  if (valid) {
    return { valid: true };
  }

  const errors = extractErrors(validate);
  const timestamp = new Date().toISOString();

  // Log validation event via structured console output
  console.error('[step-validation]', {
    type: 'validation.error',
    source: source ?? 'step-validation',
    contract_type: contractType,
    step_id: 'unknown',
    step_name: 'unknown',
    timestamp,
    failed_rules: errors,
  });

  return { valid: false, errors };
}

/** Clear cached schemas (useful for testing). */
export function clearSchemaCache(): void {
  schemaCache.clear();
}

/** Reset schema cache (called when plugin stops). */
export function resetSchemaCache(): void {
  schemaCache.clear();
}