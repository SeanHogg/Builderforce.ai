/**
 * Common test utilities and fixtures.
 * Shared by payloads, display, and reasoning modules; each module may add its own.
 */

import { describe, it } from '@jest/globals';

/**
 * Type-safe describe helper that attaches module name for better reporting.
 */
export function describeModule(module: string, fn: (describe: typeof describe) => void) {
  const originalDescribe = describe;
  describe = (name: string, fn2: Parameters<typeof describeModule>[1]) => {
    originalDescribe(module + ': ' + name, fn2);
  };
  fn(originalDescribe);
  describe = originalDescribe; // restore
}

/**
 * Round-trip test: serialize to JSON and verify equivalence.
 */
export function assertRoundTrip<T>(value: T, name = 'Round-trip') {
  const serialized = JSON.parse(JSON.stringify(value));
  expect(serialized).toEqual(value);
}

/**
 * Path coverage checks (used inline in assertions for corridor scope tracking).
 */
export function assertStrictSchema<T extends Record<string, any>>(
  value: T,
  required: (keyof T)[],
) {
  const missing: (keyof T)[] = [];
  const { typeError, missingField } = validateAllowedFields<T>(value, required);

  if (typeError) {
    throw new Error(`Schema violation: ${typeError}`);
  }
  if (missingField) {
    throw new Error(`Schema violation: missing required field ${missingField}`);
  }
}

/**
 * Validate that value contains allowed fields and correct types (simple schema validation).
 */
function validateAllowedFields<T extends Record<string, any>>(
  value: T,
  allowed: (keyof T)[],
  parentKey = '',
): { typeError?: string; missingField?: string } {
  for (const key of allowed) {
    if (value[key] === undefined) {
      const path = parentKey ? `${parentKey}.${String(key)}` : String(key);
      return { missingField: path };
    }
    // no deep type validator here; further schema enforcement lives in mod-specific suites
  }
}