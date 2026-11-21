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
 *     in a shape that type can be read from. No declared type, or a value already of the declared
 *     type, is passed through untouched.
 *   - An array field given a string: JSON array text is parsed; any other string is ONE entry
 *     (`"Paris, France"` → `["Paris, France"]`, `"none"` → `["none"]`) — a string is never split on
 *     commas or newlines. Text that is bracketed (`[…]`) but is not a JSON array is invalid, with a
 *     message asking for a JSON array (`['a.ts','b.ts']` is refused, not guessed at).
 *   - Numbers are read only from plain decimal text (`/^-?\d+(\.\d+)?$/`: no hex, no exponent).
 *     Booleans from `true`/`false`, `"1"`/`"0"` and the numbers 1/0. An object field given JSON
 *     object text gets the parsed object.
 *   - A required argument that is `undefined`, `null` or an empty/blank string is missing — unless
 *     its schema says `minLength: 0` (an empty file's content is a value, not an omission).
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
  /** What to send instead, when the shape alone does not say (bracketed text that is not a JSON array). */
  hint?: string;
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
    parts.push(`argument "${issue.field}" must be ${article(issue.expected)} ${issue.expected}, got ${issue.received}${issue.hint ? ` (${issue.hint})` : ''}`);
  }
  return `${tool}: ${parts.join('; ')}. Call the tool again with the corrected arguments.`;
}

const article = (type: string): string => (/^[aeiou]/i.test(type) ? 'an' : 'a');

const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Blank = missing, unless the property's schema allows the empty string (`minLength: 0`). */
function isMissing(v: unknown, propSchema: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'string' || v.trim() !== '') return false;
  return (propSchema as { minLength?: unknown } | null | undefined)?.minLength !== 0;
}

/** Plain decimal text: an optional minus, digits, an optional fraction. No hex, exponent, `Infinity` or blank. */
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

/** The decimal text of a finite number, as that number; `undefined` for anything else. */
function numberFromText(text: string, integer: boolean): number | undefined {
  const trimmed = text.trim();
  if (!DECIMAL_TEXT.test(trimmed)) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  if (integer && !Number.isInteger(n)) return undefined;
  return n;
}

/** `true`/`false`/`"1"`/`"0"` text, or the numbers 1/0, as a boolean; `undefined` for anything else. */
function booleanFrom(value: string | number): boolean | undefined {
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
  const t = value.trim().toLowerCase();
  return t === 'true' || t === '1' ? true : t === 'false' || t === '0' ? false : undefined;
}

const JSON_ARRAY_HINT = 'send a JSON array, e.g. ["a.ts","b.ts"], or a single string for one entry';

/**
 * An array read from text: JSON array text is parsed; any other string is ONE entry — never split on commas or newlines
 * (`"Paris, France"` is one value). Bracketed text (`[…]`) that is not a JSON array is refused (`null`): it was meant as a list
 * and cannot be read as one. A bracketed path that does not END in `]` (`[id].tsx`) is an ordinary single entry.
 */
function arrayFromText(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return [trimmed];
  const parsed = parseJsonOr<unknown>(trimmed, null);
  return Array.isArray(parsed) ? parsed : null;
}

/** JSON text of a plain object, parsed (THE shared `parseJsonObject` read); `value` unchanged for anything else. */
function objectFromText(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return value;
  const parsed = parseJsonObject<Json | null>(trimmed);
  // parseJsonObject answers `{}` for unparseable text: only a real `{}` reads as an empty object.
  return parsed && (Object.keys(parsed).length > 0 || /^\{\s*\}$/.test(trimmed)) ? parsed : value;
}

const declaredType = (schema: unknown): string | undefined => {
  const t = (schema as { type?: unknown } | null)?.type;
  return typeof t === 'string' ? t : undefined;
};

/** A scalar coerced to a declared scalar type, or `value` unchanged. */
function coerceScalar(value: unknown, type: string | undefined): unknown {
  if (type === 'boolean' && (typeof value === 'string' || typeof value === 'number')) return booleanFrom(value) ?? value;
  if (typeof value !== 'string' || type === undefined) return value;
  if (type === 'integer' || type === 'number') return numberFromText(value, type === 'integer') ?? value;
  if (type === 'object') return objectFromText(value);
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
      if (typeof value === 'string') {
        const list = arrayFromText(value);
        if (list === null) {
          invalid.push({ field, expected: type, received: 'string', hint: JSON_ARRAY_HINT });
          continue;
        }
        next = list;
      }
      const itemType = declaredType((propSchema as { items?: unknown }).items);
      if (Array.isArray(next) && itemType) next = next.map((item) => coerceScalar(item, itemType));
    } else {
      next = coerceScalar(value, type);
    }
    if (isIncompatible(next, type)) invalid.push({ field, expected: type, received: kindOf(next) });
    else args[field] = next;
  }

  const missing = required.filter((field) => isMissing(args[field], properties[field]));
  if (missing.length || invalid.length) throw new BuiltinToolArgError(tool, missing, invalid);
  return args;
}
