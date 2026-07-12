/**
 * Payload Generation Engine
 * Centralized payload generation based on declarative config.
 */

import type {
  FieldResolution,
  InputContext,
  LogEntry,
  OutputField,
  PayloadDefinition,
  PayloadGenerator,
  Result,
  TypeCoercion,
  ValidationError,
} from "./types.js";

/**
 * Custom function registry signature.
 */
export type CustomFunction = (args: {
  context: InputContext;
  resolved: Record<string, FieldResolution>;
  sourcePath: string;
  outputName: string;
}) => unknown;

/**
 * Path components for source resolution.
 */
type PathSegment = string | number;

/**
 * Tokenize a path string into segments supporting:
 *   dot notation:   "user.address.city"
 *   bracket arrays: "items[0].name"
 * Pathological edge cases are handled conservatively.
 */
function tokenizePath(path: string): PathSegment[] {
  const tokens: PathSegment[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) {
      tokens.push(m[1]);
    } else if (m[2] !== undefined) {
      tokens.push(parseInt(m[2], 10));
    }
  }
  return tokens;
}

/**
 * Resolve a source field from context.
 * Returns exists=false for undefined/null/missing parent path.
 */
function resolveFieldPath(context: InputContext, path: string): FieldResolution {
  if (path === "") return { value: undefined, exists: false };
  if (context === null || context === undefined) return { value: undefined, exists: false };
  const tokens = tokenizePath(path);
  let current: unknown = context;
  for (const seg of tokens) {
    if (current === null || current === undefined) {
      return { value: undefined, exists: false };
    }
    if (typeof seg === "number") {
      if (Array.isArray(current) && seg >= 0 && seg < current.length) {
        current = current[seg];
      } else {
        return { value: undefined, exists: false };
      }
    } else {
      if (typeof current === "object" && !Array.isArray(current) && Object.prototype.hasOwnProperty.call(current, seg)) {
        current = (current as Record<string, unknown>)[seg];
      } else {
        return { value: undefined, exists: false };
      }
    }
  }
  return { value: current, exists: current !== undefined && current !== null };
}

/**
 * Evaluate a simple condition against a resolved value.
 */
function evaluateCondition(
  source: FieldResolution,
  operator: string,
  value: unknown,
): boolean {
  const condVal = source.value;
  switch (operator) {
    case "exists":
      return source.exists;
    case "equals":
      return condVal === value;
    case "notEquals":
      return condVal !== value;
    case "contains":
      if (typeof condVal === "string" && typeof value === "string") {
        return condVal.includes(value);
      }
      if (Array.isArray(condVal)) {
        return condVal.some((v) => v === value);
      }
      return false;
    case "startsWith":
      return typeof condVal === "string" && typeof value === "string" && condVal.startsWith(value);
    case "endsWith":
      return typeof condVal === "string" && typeof value === "string" && condVal.endsWith(value);
    case "greaterThan":
      return typeof condVal === "number" && typeof value === "number" && condVal > value;
    case "lessThan":
      return typeof condVal === "number" && typeof value === "number" && condVal < value;
    default:
      return false;
  }
}

/**
 * Coerce a single primitive value to the requested type.
 */
function coerceType(value: unknown, coercion: TypeCoercion): unknown {
  const { type, nullable } = coercion;
  if (value === null || value === undefined) {
    if (nullable) return value;
    return undefined;
  }
  switch (type) {
    case "string":
      return String(value);
    case "number":
      if (typeof value === "number") return value;
      return parseFloat(String(value));
    case "integer": {
      const num = Number(value);
      return Math.trunc(num);
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      return String(value).toLowerCase() !== "false" && String(value) !== "0" && String(value) !== "";
    case "date":
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "number") return new Date(value).toISOString();
      if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
      }
      return undefined;
    case "epoch":
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
      }
      if (value instanceof Date) return value.getTime();
      return undefined;
    default:
      return value;
  }
}

/**
 * Apply array transform: 'map(prop)' or 'fn:fnName'.
 */
function applyArrayTransform(
  arr: unknown[],
  transformExpr: string,
  _context: InputContext,
  _resolved: Record<string, FieldResolution>,
  functions: Record<string, CustomFunction>,
): unknown[] {
  if (transformExpr.startsWith("map(") && transformExpr.endsWith(")")) {
    const prop = transformExpr.slice(4, -1).trim().replace(/^["']|["']$/g, "");
    return arr.map((el) =>
      el && typeof el === "object" && !Array.isArray(el) ? (el as Record<string, unknown>)[prop] : undefined,
    );
  }
  if (transformExpr.startsWith("fn:")) {
    const fnName = transformExpr.slice(3).trim();
    if (functions[fnName]) {
      return functions[fnName]({ context: _context, resolved: _resolved, sourcePath: "", outputName: "" }) as unknown[];
    }
  }
  return arr;
}

/**
 * Built-in derived functions.
 */
function runDerivedFunction(
  fnName: string,
  raw: unknown,
  _context: InputContext,
  resolved: Record<string, FieldResolution>,
): unknown {
  switch (fnName) {
    case "fullName": {
      if (raw !== undefined) return raw;
      const first = resolved["firstName"]?.value ?? resolved["user.firstName"]?.value ?? "";
      const last = resolved["lastName"]?.value ?? resolved["user.lastName"]?.value ?? "";
      const parts = [String(first || ""), String(last || "")].filter(Boolean);
      return parts.length > 0 ? parts.join(" ") : undefined;
    }
    case "upper": {
      const src = raw !== undefined ? raw : resolved["value"]?.value;
      return typeof src === "string" ? src.toUpperCase() : undefined;
    }
    case "lower": {
      const src = raw !== undefined ? raw : resolved["value"]?.value;
      return typeof src === "string" ? src.toLowerCase() : undefined;
    }
    default:
      return raw;
  }
}

/**
 * Extract the requirements from a schema (used to validate top-level fields).
 */
function getSchemaRequiredFields(schema: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const required = schema.required;
  if (Array.isArray(required)) {
    for (const r of required) out.add(String(r));
  }
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    for (const [k, def] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (def && typeof def === "object" && !Array.isArray(def) && (def as Record<string, unknown>).required === true) {
        out.add(k);
      }
    }
  }
  return out;
}

function getSchemaProperty(schema: Record<string, unknown>, prop: string): Record<string, unknown> | undefined {
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    const p = (schema.properties as Record<string, unknown>)[prop];
    if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  }
  const topLevel = schema[prop];
  if (topLevel && typeof topLevel === "object" && !Array.isArray(topLevel)) return topLevel as Record<string, unknown>;
  return undefined;
}

function validateProperty(
  propName: string,
  def: Record<string, unknown>,
  value: unknown,
  errors: ValidationError[],
  log: LogEntry[],
  contextId: string,
): void {
  const type = def.type as string | undefined;
  if (type) {
    const isValidType = (() => {
      switch (type) {
        case "string":
          return typeof value === "string";
        case "number":
          return typeof value === "number" && !Number.isNaN(value);
        case "integer":
          return typeof value === "number" && Number.isInteger(value);
        case "boolean":
          return typeof value === "boolean";
        case "array":
          return Array.isArray(value);
        case "object":
          return typeof value === "object" && !Array.isArray(value) && value !== null;
        case "null":
          return value === null;
        default:
          return true;
      }
    })();
    if (!isValidType) {
      logEntry(log, {
        level: "error",
        contextId,
        field: propName,
        reason: `schema validation failed: expected ${type}, got ${typeof value}`,
        inputState: { value },
      });
      errors.push({
        field: propName,
        schemaPath: `properties/${propName}/type`,
        type: "type",
        message: `Expected ${type} but got ${typeof value}`,
        input: value,
      });
      return;
    }
  }
  if (def.enum && Array.isArray(def.enum)) {
    if (!def.enum.some((entry) => entry === value)) {
      logEntry(log, {
        level: "error",
        contextId,
        field: propName,
        reason: `enum validation failed`,
        inputState: { value, enum: def.enum },
      });
      errors.push({
        field: propName,
        schemaPath: `properties/${propName}/enum`,
        type: "enum",
        message: `Value ${String(value)} not in enum ${JSON.stringify(def.enum)}`,
        input: value,
      });
    }
  }
}

function logEntry(log: LogEntry[], entry: Omit<LogEntry, "timestamp">): void {
  log.push({ ...entry, timestamp: new Date().toISOString() });
}

/**
 * Factory to create a PayloadGenerator instance.
 */
export function createPayloadGenerator(
  payloadDefinition: PayloadDefinition,
  options?: {
    functions?: Record<string, CustomFunction>;
  },
): PayloadGenerator {
  const functions = options?.functions ?? {};
  const logRef: LogEntry[] = [];
  const contextId = `gen:${payloadDefinition.id}`;

  const planFields = (): OutputField[] => [...payloadDefinition.fields];

  const resolveAll = (context: InputContext, fields: OutputField[]): Record<string, FieldResolution> => {
    const needed = new Set<string>();
    for (const f of fields) {
      needed.add(f.source.path);
      if (f.transform?.includeIf) needed.add(f.transform.includeIf.field);
      if (f.transform?.arrayTransform) needed.add(f.transform.arrayTransform.field);
    }
    const resolved: Record<string, FieldResolution> = {};
    for (const path of needed) {
      const res = resolveFieldPath(context, path);
      resolved[path] = res;
    }
    return resolved;
  };

  const transformField = (
    field: OutputField,
    rawValue: unknown,
    context: InputContext,
    resolved: Record<string, FieldResolution>,
  ): unknown => {
    let value = rawValue;

    // Array transform
    if (field.transform?.arrayTransform) {
      const arrRes = resolved[field.transform.arrayTransform.field];
      if (arrRes.exists && Array.isArray(arrRes.value)) {
        value = applyArrayTransform(arrRes.value, field.transform.arrayTransform.transform, context, resolved, functions);
      } else if (arrRes.exists && !Array.isArray(arrRes.value)) {
        value = [];
      }
    }

    // Derived function
    if (field.transform?.derivedFunction) {
      value = runDerivedFunction(field.transform.derivedFunction, value, context, resolved);
    }

    // Custom function
    if (field.customFunction && functions[field.customFunction]) {
      value = functions[field.customFunction]({ context, resolved, sourcePath: field.source.path, outputName: field.name });
    }

    // Enum mapping
    if (field.transform?.enumMap && typeof value === "string") {
      value = field.transform.enumMap[value] ?? value;
    }

    // Type coercion
    if (field.transform?.type) {
      value = coerceType(value, field.transform.type);
    }

    return value;
  };

  const validate = (payload: Record<string, unknown>): ValidationError[] => {
    const errors: ValidationError[] = [];
    const required = getSchemaRequiredFields(payloadDefinition.schema);

    for (const r of required) {
      if (!(r in payload) || payload[r] === undefined || payload[r] === null) {
        logEntry(logRef, {
          level: "error",
          contextId,
          field: r,
          reason: `required field '${r}' missing or null`,
        });
        errors.push({
          field: r,
          schemaPath: `properties/${r}`,
          type: "required",
          message: `Required field '${r}' is missing from payload`,
        });
      }
    }

    for (const [propName, value] of Object.entries(payload)) {
      const def = getSchemaProperty(payloadDefinition.schema, propName);
      if (def) validateProperty(propName, def, value, errors, logRef, contextId);
    }

    return errors;
  };

  const generate = (context: InputContext): Result<Record<string, unknown>> => {
    logRef.length = 0;
    const fields = planFields();
    const resolved = resolveAll(context, fields);
    const payload: Record<string, unknown> = {};
    const errors: ValidationError[] = [];

    for (const field of fields) {
      const outName = field.alias ?? field.name;

      // Conditional inclusion
      if (field.transform?.includeIf) {
        const cond = field.transform.includeIf;
        const condRes = resolved[cond.field] ?? { value: undefined, exists: false };
        const include = evaluateCondition(condRes, cond.operator, cond.value);
        if (!include) continue;
      }

      const srcRes = resolved[field.source.path];
      if (!srcRes) {
        if (field.source.required) {
          logEntry(logRef, {
            level: "error",
            contextId,
            field: outName,
            reason: `source path '${field.source.path}' missing`,
          });
          errors.push({
            field: outName,
            type: "required",
            message: `Required source '${field.source.path}' is missing`,
          });
        }
        continue;
      }

      if (!srcRes.exists) {
        if (field.source.required) {
          logEntry(logRef, {
            level: "error",
            contextId,
            field: outName,
            reason: `required field '${field.source.path}' missing`,
          });
          errors.push({
            field: outName,
            type: "required",
            message: `Required field '${field.source.path}' is missing`,
          });
          continue;
        }
        if (field.source.defaultValue !== undefined) {
          payload[outName] = field.source.defaultValue;
        }
        continue;
      }

      const transformed = transformField(field, srcRes.value, context, resolved);

      if (transformed === undefined && field.source.defaultValue !== undefined) {
        payload[outName] = field.source.defaultValue;
      } else if (transformed !== undefined) {
        payload[outName] = transformed;
      }
    }

    // Apply schema-level defaults for any still-missing properties that have defaults
    const schemaProps = payloadDefinition.schema.properties;
    if (schemaProps && typeof schemaProps === "object" && !Array.isArray(schemaProps)) {
      for (const [key, def] of Object.entries(schemaProps as Record<string, unknown>)) {
        if (!(key in payload)) {
          const propDef = def as Record<string, unknown>;
          if (propDef.default !== undefined) {
            payload[key] = propDef.default;
          }
        }
      }
    }

    const validationErrors = validate(payload);
    if (validationErrors.length > 0) {
      return { success: false, errors: [...errors, ...validationErrors] };
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true, data: payload };
  };

  return {
    get definition(): PayloadDefinition {
      return payloadDefinition;
    },
    generate,
    generateTyped<T = Record<string, unknown>>(context: InputContext): Result<T> {
      return generate(context) as Result<T>;
    },
    getLog(): LogEntry[] {
      return [...logRef];
    },
    resetLog(): void {
      logRef.length = 0;
    },
  };
}
