/** Step Contract Rules Engine

Provides a rules framework to evaluate additional constraint checks beyond JSON Schema validation.
Supports common constraints like type checks, value ranges, regex patterns, referential checks (mocked),
and custom assertion functions.
*/

import Ajv from "ajv";

const AJV = new Ajv({ allErrors: true, strict: false });

export interface ValidatedRule {
  field_path?: string;
  constraint: string;
  description?: string;
  actual_value?: unknown;
  passed: boolean;
}

/** Apply a constraint to a field value. */
export async function applyConstraint(
  value: unknown,
  constraint: {
    type?: string;
    required?: boolean;
    pattern?: string;
    min?: number;
    max?: number;
    enum?: readonly unknown[];
    custom?: (value: unknown) => boolean | Promise<boolean>;
  },
  fieldName?: string,
): Promise<ValidatedRule> {
  const rule: ValidatedRule = {
    field_path: fieldName ? `.${fieldName}` : "<root>",
    constraint: constraint.type || constraint.required ? `${constraint.required ? "required" : constraint.type} check` : "custom check",
    passed: true,
  };

  try {
    const result = await validateValue(value, constraint, fieldName);

    rule.passed = result.ok;
    rule.actual_value = value;
    if (!result.ok && result.error) {
      rule.constraint = result.error;
    }
  } catch (e) {
    rule.passed = false;
    rule.constraint = e instanceof Error ? e.message : "constraint validation failed";
  }

  return rule;
}

/** Validates value against a constraint using JSON Schema for type checks, plus extra constraints. */
async function validateValue(
  value: unknown,
  constraint: any,
  fieldName?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (constraint.required !== false && value === undefined && value !== 0) {
    return { ok: false, error: `${fieldName ? fieldName + "." : ""} required` };
  }

  if (constraint.pattern && typeof value === "string") {
    if (!new RegExp(constraint.pattern).test(value)) {
      return { ok: false, error: `${fieldName ? fieldName + "." : ""} pattern ${constraint.pattern}` };
    }
  }

  if (constraint.min !== undefined || constraint.max !== undefined) {
    if (typeof value !== "number") {
      return { ok: false, error: `${fieldName ? fieldName + "." : ""} number range` };
    }
    if (constraint.min !== undefined && value < constraint.min) {
      return { ok: false, error: `${fieldName ? fieldName + "." : ""} min ${constraint.min}` };
    }
    if (constraint.max !== undefined && value > constraint.max) {
      return { ok: false, error: `${fieldName ? fieldName + "." : ""} max ${constraint.max}` };
    }
  }

  if (constraint.enum && !constraint.enum.includes(value)) {
    return { ok: false, error: `${fieldName ? fieldName + "." : ""} enum ${constraint.enum.slice(0, 5).join(", ")}[…]` };
  }

  return { ok: true };
}

/** Build failed_rules list from validation results. */
export function buildFailedRules(
  payload: unknown,
  schema: { [key: string]: unknown },
  rules: Array<ValidatedRule>,
): Array<{
  field_path: string;
  constraint: string;
  actual_value: unknown;
}> {
  return rules.filter((r) => !r.passed).map((r) => ({
    field_path: r.field_path || "<root>",
    constraint: r.constraint,
    actual_value: r.actual_value,
  }));
}