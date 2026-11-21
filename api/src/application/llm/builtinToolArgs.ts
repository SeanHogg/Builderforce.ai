/**
 * Application — the ONE schema-driven argument step every built-in tool call passes through
 * before its handler runs (`callBuiltinTool`).
 *
 * Models routinely send a tool's arguments in a looser shape than the catalog declares: an array
 * as JSON text (`files: "[\"a.ts\"]"`) or as a bare path (`files: "a.ts"`), a number as its decimal
 * text (`projectId: "42"`), a boolean as `"true"`. Handlers used to each re-decide what to do with
 * that, and the usual answer was a silent drop (`Array.isArray(a.files) ? … : undefined`). This
 * module coerces those shapes ONCE, driven only by the tool's declared JSON input schema, and
 * refuses a call that omits a required argument with a {@link BuiltinToolArgError} — a 400-class
 * {@link ValidationError} whose message names the tool and the fields, so the model can correct
 * the call instead of reading "upstream error".
 *
 * Rules:
 *   - Coercion happens only when the property's schema declares a single `type` and the value is
 *     a string in a shape that type can be read from. No declared type, or a value already of the
 *     declared type, is passed through untouched.
 *   - A required argument that is `undefined`, `null` or an empty/blank string is missing.
 *   - A value whose JS kind can never be the declared type (an object where an array is declared,
 *     an array where a number is) is invalid. A string that does not read as a number is left to
 *     the handler, whose own parse (`idArg`, …) answers with a message specific to the field.
 *   - Only the top level of the arguments object is touched; array items are coerced when the
 *     schema declares a scalar `items.type`.
 */

import { ValidationError } from '../../domain/shared/errors';
import { parseJsonObject, parseJsonOr } from '../../domain/shared/json';

type Json = Record<string, unknown>;

/** One argument whose value can never satisfy its declared type. */
export interface BuiltinToolArgIssue {
  field: string;
  /** The declared JSON-schema type. */
  expected: string;
  /** The JS kind actually received (`object`, `array`, `number`, …). */
  received: string;
}

/** A built-in tool call whose arguments do not satisfy the tool's declared input schema (HTTP 400). */
export class BuiltinToolArgError extends ValidationError {
  readonly code = 'invalid_tool_arguments';
  constructor(
    readonly tool: string,
    readonly missing: readonly string[],
    readonly invalid: readonly BuiltinToolArgIssue[],
  ) {
    super(describe(tool, missing, invalid));
    this.name = 'BuiltinToolArgError';
  }
}

function describe(tool: string, missing: readonly string[], invalid: readonly BuiltinToolArgIssue[]): string {
  const parts: string[] = [];
  if (missing.length) {
    const quoted = missing.map((f) => `"${f}"`).join(', ');
    // "<field> is required" per field, so the sentence reads the same as a handler's own refusal.
    parts.push(`missing required argument${missing.length > 1 ? 's' : ''} ${quoted} (${missing.map((f) => `${f} is required`).join('; ')})`);
  }
  for (const issue of invalid) {
    parts.push(`argument "${issue.field}" must be ${article(issue.expected)} ${issue.expected}, got ${issue.received}`);
  }
  return `${tool}: ${parts.join('; ')}. Call the tool again with the corrected arguments.`;
}

const article = (type: string): string => (/^[aeiou]/i.test(type) ? 'an' : 'a');

const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const isMissing = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** The decimal text of a finite number, as that number; `undefined` for anything else. */
function numberFromText(text: string, integer: boolean): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  if (integer && !Number.isInteger(n)) return undefined;
  return n;
}

function booleanFromText(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  return t === 'true' ? true : t === 'false' ? false : undefined;
}

/** An array read from text: JSON array text, else a comma/newline-separated list (one entry for a bare value). */
function arrayFromText(text: string): unknown[] {
  const trimmed = text.trim();
  // Not JSON falls through to the list split: a bracketed path (`[id].tsx`) is a legitimate entry.
  const parsed = trimmed.startsWith('[') ? parseJsonOr<unknown>(trimmed, null) : null;
  if (Array.isArray(parsed)) return parsed;
  return trimmed.split(/[,\n]/).map((s) => s.trim()).filter((s) => s !== '');
}

const declaredType = (schema: unknown): string | undefined => {
  const t = (schema as { type?: unknown } | null)?.type;
  return typeof t === 'string' ? t : undefined;
};

/** A scalar coerced to a declared scalar type, or `value` unchanged. */
function coerceScalar(value: unknown, type: string | undefined): unknown {
  if (typeof value !== 'string' || type === undefined) return value;
  if (type === 'integer' || type === 'number') return numberFromText(value, type === 'integer') ?? value;
  if (type === 'boolean') return booleanFromText(value) ?? value;
  return value;
}

/** Whether a (post-coercion) value's JS kind can never satisfy the declared type. */
function isIncompatible(value: unknown, type: string): boolean {
  const kind = kindOf(value);
  switch (type) {
    case 'array': return kind !== 'array';
    case 'integer':
    case 'number': return kind === 'object' || kind === 'array' || kind === 'boolean';
    case 'boolean': return kind === 'object' || kind === 'array' || kind === 'number';
    // `string` / `object` are left to the handler: several read either shape on purpose.
    default: return false;
  }
}

/** The arguments object a call carried: an object, JSON object text, or `{}`. */
// Unparseable text is no arguments, so the required-field check names what is missing.
const argumentsObject = (raw: unknown): Json => parseJsonObject<Json>(raw);

/**
 * The call's arguments, coerced to the tool's declared input schema; throws
 * {@link BuiltinToolArgError} when a required argument is missing or a value can never be its
 * declared type. A schema without `properties` / `required` passes the arguments through.
 */
export function prepareBuiltinToolArgs(tool: string, schema: unknown, raw: unknown): Json {
  const args = { ...argumentsObject(raw) };
  const s = (schema && typeof schema === 'object' ? schema : {}) as { properties?: unknown; required?: unknown };
  const properties = (s.properties && typeof s.properties === 'object' ? s.properties : {}) as Record<string, unknown>;
  const required = Array.isArray(s.required) ? s.required.filter((f): f is string => typeof f === 'string') : [];

  const invalid: BuiltinToolArgIssue[] = [];
  for (const [field, propSchema] of Object.entries(properties)) {
    const value = args[field];
    if (value === undefined || value === null) continue;
    const type = declaredType(propSchema);
    if (type === undefined) continue;
    let next: unknown = value;
    if (type === 'array') {
      if (typeof value === 'string') next = arrayFromText(value);
      const itemType = declaredType((propSchema as { items?: unknown }).items);
      if (Array.isArray(next) && itemType) next = next.map((item) => coerceScalar(item, itemType));
    } else {
      next = coerceScalar(value, type);
    }
    if (isIncompatible(next, type)) invalid.push({ field, expected: type, received: kindOf(next) });
    else args[field] = next;
  }

  const missing = required.filter((field) => isMissing(args[field]));
  if (missing.length || invalid.length) throw new BuiltinToolArgError(tool, missing, invalid);
  return args;
}
