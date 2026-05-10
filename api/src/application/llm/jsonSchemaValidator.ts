/**
 * Minimal JSON-Schema-draft-07 subset validator — the gateway uses this in
 * `response_format: { type: 'json_schema', strict: true }` mode to detect
 * non-conforming model output and retry across the failover chain before
 * returning to the caller.
 *
 * Why hand-rolled instead of `ajv`:
 *   1. ajv is ~150 kB minified — too heavy for a Cloudflare Worker that
 *      already has a strict bundle budget.
 *   2. We don't need full draft-07; the keywords below cover the contracts
 *      tenant apps actually use (typed objects with required/enum/items).
 *   3. Fast path: most validations succeed in <1 ms.
 *
 * Supported keywords:
 *   - type        — one of `string | number | integer | boolean | array | object | null`
 *                  (or an array of those for unions)
 *   - required    — list of property names
 *   - properties  — per-property sub-schemas
 *   - additionalProperties — true | false | sub-schema
 *   - items       — sub-schema for every array element (tuple form not supported)
 *   - enum        — finite set of allowed values
 *   - minimum / maximum (numeric)
 *   - minLength / maxLength (string)
 *   - minItems / maxItems (array)
 *   - oneOf / anyOf — must match exactly-one / at-least-one (no scoring)
 *
 * Unsupported (returns `null` — treated as passing): `$ref`, `format`,
 * `pattern`, `if/then/else`, `dependencies`, custom keywords. The caller's
 * Zod (or whatever) is the safety net for those cases.
 */

export interface ValidationError {
  /** Dot-and-bracket path through the document, e.g. `roadmap[0].id`. */
  path:    string;
  message: string;
}

interface JsonSchema {
  type?:                 string | string[];
  required?:             string[];
  properties?:           Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?:                JsonSchema;
  enum?:                 unknown[];
  minimum?:              number;
  maximum?:              number;
  minLength?:            number;
  maxLength?:            number;
  minItems?:             number;
  maxItems?:             number;
  oneOf?:                JsonSchema[];
  anyOf?:                JsonSchema[];
  [key: string]:         unknown;
}

/**
 * Validate `value` against `schema`. Returns an array of errors (empty
 * when conforming). Stops collecting at `maxErrors` to keep responses small.
 */
export function validateJsonSchema(
  value:  unknown,
  schema: unknown,
  opts: { maxErrors?: number } = {},
): ValidationError[] {
  const errors: ValidationError[] = [];
  const max = opts.maxErrors ?? 12;
  walk(value, (schema ?? {}) as JsonSchema, '', errors, max);
  return errors;
}

function walk(value: unknown, schema: JsonSchema, path: string, errs: ValidationError[], max: number): void {
  if (errs.length >= max) return;

  // type
  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((t) => matchesType(value, t))) {
      errs.push({ path, message: `expected ${expected.join(' | ')}, got ${describeType(value)}` });
      return; // type mismatch makes other keywords meaningless
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => deepEq(e, value))) {
      errs.push({ path, message: `value not in enum [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}]` });
    }
  }

  // String constraints
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errs.push({ path, message: `string shorter than minLength=${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errs.push({ path, message: `string longer than maxLength=${schema.maxLength}` });
    }
  }

  // Number constraints
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errs.push({ path, message: `number below minimum=${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errs.push({ path, message: `number above maximum=${schema.maximum}` });
    }
  }

  // Array constraints
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errs.push({ path, message: `array shorter than minItems=${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errs.push({ path, message: `array longer than maxItems=${schema.maxItems}` });
    }
    if (schema.items) {
      for (let i = 0; i < value.length && errs.length < max; i++) {
        walk(value[i], schema.items, `${path}[${i}]`, errs, max);
      }
    }
  }

  // Object constraints
  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>;

    if (Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (typeof field === 'string' && !(field in obj)) {
          errs.push({ path: joinPath(path, field), message: 'required field missing' });
          if (errs.length >= max) return;
        }
      }
    }

    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in obj && errs.length < max) walk(obj[k], sub, joinPath(path, k), errs, max);
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      const known = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(obj)) {
        if (!known.has(k)) {
          errs.push({ path: joinPath(path, k), message: 'additional property not allowed' });
          if (errs.length >= max) return;
        }
      }
    } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
      const known = new Set(schema.properties ? Object.keys(schema.properties) : []);
      for (const k of Object.keys(obj)) {
        if (!known.has(k) && errs.length < max) {
          walk(obj[k], schema.additionalProperties, joinPath(path, k), errs, max);
        }
      }
    }
  }

  // oneOf — exactly one must match
  if (Array.isArray(schema.oneOf)) {
    const matchCount = schema.oneOf.reduce((n, s) => n + (validateJsonSchema(value, s, { maxErrors: 1 }).length === 0 ? 1 : 0), 0);
    if (matchCount !== 1) {
      errs.push({ path, message: `value matched ${matchCount} of ${schema.oneOf.length} oneOf branches (need exactly 1)` });
    }
  }

  // anyOf — at least one must match
  if (Array.isArray(schema.anyOf)) {
    const anyMatch = schema.anyOf.some((s) => validateJsonSchema(value, s, { maxErrors: 1 }).length === 0);
    if (!anyMatch) {
      errs.push({ path, message: `value matched none of ${schema.anyOf.length} anyOf branches` });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny utilities
// ─────────────────────────────────────────────────────────────────────────────

function matchesType(value: unknown, t: string): boolean {
  switch (t) {
    case 'string':  return typeof value === 'string';
    case 'number':  return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null':    return value === null;
    case 'array':   return Array.isArray(value);
    case 'object':  return isPlainObject(value);
    default:        return false;
  }
}

function describeType(value: unknown): string {
  if (value === null)        return 'null';
  if (Array.isArray(value))  return 'array';
  return typeof value;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(base: string, key: string): string {
  if (base.length === 0) return key;
  return `${base}.${key}`;
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
