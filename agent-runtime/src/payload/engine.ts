/**
 * Payload Generation Engine
 * Centralized payload generation based on declarative configs.
 */

import type {
  InputContext,
  SourceDefinition,
  OutputField,
  TransformationRule,
  PayloadDefinition,
  FieldResolution,
  LogEntry,
  ValidationError,
  Result as ResultType,
} from './types.js';

/**
 * History of generated log entries.
 */
export type PayloadEngineLog = Array<LogEntry>;

/**
 * Factory creation return type.
 */
export type PayloadGenerator = {
  definition: PayloadDefinition;
  generate(context: InputContext): ResultType;
  generateTyped<T = unknown>(context: InputContext): ResultType<T>;
  getLog(): PayloadEngineLog;
  resetLog(): void;
};

/**
 * Path components for source resolution.
 */
type PathSegment = string | number;

/**
 * Resolve a source field from context.
 * Supports nested paths with separators ('.', '/', '[]').
 */
function resolveFieldPath(
  context: InputContext,
  path: string,
  separator: string,
): FieldResolution {
  const segments = path.split(separator).filter(Boolean).map((s) => s.trim());
  let current: unknown = context;
  let exists = true;

  for (const seg of segments) {
    if (current === null || current === undefined) {
      exists = false;
      break;
    }
    if (typeof current === 'object' && !Array.isArray(current) && seg in current) {
      current = (current as Record<string, unknown>)[seg];
    } else if (Array.isArray(current) && /^\d+$/.test(seg)) {
      const idx = Number(seg);
      if (idx >= 0 && idx < current.length) {
        current = current[idx];
      } else {
        current = undefined;
        exists = false;
        break;
      }
    } else {
      current = undefined;
      exists = false;
      break;
    }
  }

  return { value: current, exists: !!exists };
}

/**
 * Plan all sources configured across fields (direct sources + includeIf).
 */
function planAllSources(def: PayloadDefinition, inputs: InputContext): string[] {
  const sources = new Set<string>();

  for (const f of def.fields) {
    sources.add(f.source.path);

    if (f.includeIf) {
      sources.add(f.includeIf.field);
    }

    if (f.transform?.derivedFunction) {
      sources.add(f.transform.derivedFunction);
    }
  }

  return Array.from(sources);
}

/**
 * Plan all output fields (including includesIf).
 */
function planAllFields(def: PayloadDefinition): Array<{ field: string; includeIf?: object }> {
  const plan: Array<{ field: string; includeIf?: object }> = [];

  for (const f of def.fields) {
    plan.push({
      field: f.alias ?? f.name,
      includeIf: f.includeIf,
    });
  }

  return plan;
}

/**
 * Resolve source values for a given context and definition.
 * Async fields are treated as blocked — not-resolved to fail fast; they are NOT resolved here.
 */
function resolveSources(
  def: PayloadDefinition,
  inputs: InputContext,
  separator: string,
  sources: string[],
  log: PayloadEngineLog,
): Record<string, FieldResolution> {
  const resolved: Record<string, FieldResolution> = {};

  for (const path of sources) {
    const entry = resolveFieldPath(inputs, path, separator);
    resolved[path] = { value: undefined, exists: false };
    if (entry.exists) {
      resolved[path] = entry;
    } else {
      logEntry(log, {
        level: 'warn',
        contextId: 'unknown',
        field: path,
        reason: 'Source field missing',
        inputState: {},
      });
    }
  }

  return resolved;
}

/**
 * Prepare field values after resolution and before validation.
 * Handles includeIf, defaults, array transforms, and omits missing optional fields.
 */
function prepareFieldValues(
  def: PayloadDefinition,
  resolved: Record<string, FieldResolution>,
  plan: Array<{ field: string; includeIf?: object }>,
  log: PayloadEngineLog,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const item of plan) {
    const fieldDef = def.fields.find((f2) => f2.alias ?? f2.name === item.field);
    if (!fieldDef) {
      logEntry(log, {
        level: 'error',
        contextId: 'unknown',
        field: item.field,
        reason: 'Field definition missing',
      });
      continue;
    }

    const srcRes = resolved[fieldDef.source.path];
    if (!srcRes) {
      logEntry(log, {
        level: 'error',
        contextId: 'unknown',
        field: fieldDef.source.path,
        reason: 'Source resolution missing',
      });
      continue;
    }

    let value: unknown = undefined;
    let shouldInclude = true;

    // includeIf conditional
    if (fieldDef.includeIf) {
      const srcPath = fieldDef.includeIf.field;
      const condRes = resolved[srcPath];
      if (!condRes) {
        logEntry(log, {
          level: 'warn',
          contextId: 'unknown',
          field: fieldDef.name,
          reason: 'includeIf source not resolved',
        });
        continue;
      }

      const condVal = condRes.value;
      const tgt = fieldDef.includeIf;
      const op = tgt.operator;

      let match = false;
      switch (op) {
        case 'equals':
          match = condVal === tgt.value;
          break;
        case 'notEquals':
          match = condVal !== tgt.value;
          break;
        case 'contains':
          match = typeof condVal === 'string' && typeof tgt.value === 'string' && condVal.includes(tgt.value);
          break;
        case 'startsWith':
          match = typeof condVal === 'string' && typeof tgt.value === 'string' && condVal.startsWith(tgt.value);
          break;
        case 'endsWith':
          match = typeof condVal === 'string' && typeof tgt.value === 'string' && condVal.endsWith(tgt.value);
          break;
        case 'greaterThan':
          match = typeof condVal === 'number' && typeof tgt.value === 'number' && condVal > tgt.value;
          break;
        case 'lessThan':
          match = typeof condVal === 'number' && typeof tgt.value === 'number' && condVal < tgt.value;
          break;
        case 'exists':
          match = condVal !== undefined && condVal !== null;
          break;
        default:
          logEntry(log, {
            level: 'error',
            contextId: 'unknown',
            field: fieldDef.name,
            reason: `Unsupported operator: ${op}`,
          });
          continue;
      }
      shouldInclude = match;
    }

    if (!shouldInclude) {
      continue;
    }

    if (!srcRes.exists) {
      if (fieldDef.source.required === true) {
        const name = fieldDef.name;
        logEntry(log, {
          level: 'error',
          contextId: 'unknown',
          field: name,
          reason: `Required field '${fieldDef.source.path}' missing or null`,
          inputState: {},
        });
        continue;
      } else if (fieldDef.source.defaultValue !== undefined) {
        value = fieldDef.source.defaultValue;
      } else {
        continue;
      }
    } else {
      value = srcRes.value;
    }

    // array transforms
    if (fieldDef.transform?.arrayTransform) {
      const arrayInputPath = fieldDef.transform.arrayTransform.field;
      const outputName = fieldDef.name;
      const arrRes = resolved[arrayInputPath];
      if (!arrRes) {
        logEntry(log, {
          level: 'warn',
          contextId: 'unknown',
          field: outputName,
          reason: 'arrayTransform source not resolved',
        });
        continue;
      }
      const arr = arrRes.value;
      if (!Array.isArray(arr)) {
        logEntry(log, {
          level: 'warn',
          contextId: 'unknown',
          field: outputName,
          reason: 'arrayTransform source is not an array',
        });
        continue;
      }
      const tExpr = fieldDef.transform.arrayTransform.transform;
      if (tExpr.startsWith('fn:')) {
        const fnName = tExpr.slice(3).trim();
        value = invokeDerivedOrCustom(fnName, arr);
      } else {
        value = invokeDerivedOrCustom(tExpr, arr);
      }
    }

    values[item.field] = value;
  }

  return values;
}

/**
 * Execute derived or custom functions against arrays.
 * Supports 'map(prop)' or 'fn:fnName'.
 */
function invokeDerivedOrCustom(fn: string, arg: unknown): unknown {
  if (fn.startsWith('map(') && fn.endsWith(')') && !fn.startsWith('fn:')) {
    const prop = fn.slice(4, -1).trim();
    if (arg && Array.isArray(arg)) {
      return arg.map((it) => (it && typeof it === 'object' ? (it as Record<string, unknown>)[prop] : void 0));
    }
    return [];
  }
  if (typeof fn === 'string' && fn.startsWith('fn:')) {
    return `UNRESOLVED_IMPLEMENTED_FN:${fn}`;
  }
  return `UNKNOWN_DERIVED_FN:${fn}`;
}

/**
 * Apply transformation rules (type coercion, enum mapping, derivedFunction).
 */
function applyTransforms(
  values: Record<string, unknown>,
  def: PayloadDefinition,
  log: PayloadEngineLog,
  contextId: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };

  for (const fieldDef of def.fields) {
    const fieldName = fieldDef.alias ?? fieldDef.name;
    const raw = values[fieldDef.source.path];

    if (raw === undefined) continue;

    let final: unknown = raw;
    out[fieldName] = final;

    // derivedFunction
    if (fieldDef.transform?.derivedFunction) {
      const fnName = fieldDef.transform.derivedFunction;
      const arrSrc = Array.isArray(raw) ? raw : undefined;
      out[fieldName] = invokeDerivedOrCustom(fnName, arrSrc);
    }

    // enumMap
    if (fieldDef.transform?.enumMap) {
      if (typeof raw === 'string') {
        out[fieldName] = fieldDef.transform.enumMap[raw] ?? raw;
      }
    }

    // type coercion
    const t = fieldDef.transform?.type;
    if (t) {
      const coerced = coerceType(raw, t, fieldName, log, contextId);
      out[fieldName] = coerced;
    }
  }

  return out;
}

/**
 * Type coercion helper.
 */
function coerceType(
  value: unknown,
  to: string,
  field: string,
  log: PayloadEngineLog,
  contextId: string,
): unknown {
  if (value === null || value === undefined) return value;

  switch (to) {
    case 'string':
      return String(value);
    case 'number':
      return typeof value === 'number' ? value : parseFloat(String(value));
    case 'integer':
      const num = Number(value);
      return Number.isInteger(num) ? num : Math.trunc(num);
    case 'boolean':
      return Boolean(value);
    case 'date':
    case 'epoch':
      if (typeof value === 'number') {
        return new Date(value);
      }
      const date = new Date(String(value));
      if (isNaN(date.getTime())) {
        logEntry(log, {
          level: 'error',
          contextId,
          field,
          reason: 'date coercion failed',
          inputState: { value },
        });
        return null;
      }
      return date;
    default:
      return value;
  }
}

/**
 * Log a structured entry.
 */
function logEntry(log: PayloadEngineLog, entry: Omit<LogEntry, 'timestamp'>): void {
  log.push({ ...entry, timestamp: new Date().toISOString() });
}

/**
 * Factory to create a PayloadGenerator instance.
 */
export function createPayloadGenerator(
  payloadDefinition: PayloadDefinition,
  log?: PayloadEngineLog,
): PayloadGenerator {
  const bufLogger = Array.isArray(log) ? log : [];
  const logRef = bufLogger;
  const separator = payloadDefinition.schemaVersion === 'compact' ? '.' : '.';
  const contextId = `gen:${payloadDefinition.id}`;

  const sourcesSet = planAllSources(payloadDefinition, {} as InputContext);
  const planFields = planAllFields(payloadDefinition);

  return {
    get definition(): PayloadDefinition {
      return payloadDefinition;
    },
    getLog(): PayloadEngineLog {
      return [...logRef];
    },
    resetLog(): void {
      logRef.length = 0;
    },
    generate(context) {
      const sources = planAllSources(payloadDefinition, context);
      const resolved = resolveSources(payloadDefinition, context, separator, sources, logRef);
      const prepared = prepareFieldValues(payloadDefinition, resolved, planFields, logRef);
      const transformed = applyTransforms(prepared, payloadDefinition, logRef, contextId);
      const errors: ValidationError[] = [];

      if (payloadDefinition.schema) {
        const isValid = validateAgainstSchema(payloadDefinition.schema, transformed, payloadDefinition.schemaVersion, errors, logRef, contextId);
        if (!isValid) {
          return { success: false, errors };
        }
      }

      const payload = assemblePayload(payloadDefinition, transformed);
      return { success: true, data: payload };
    },
    generateTyped(context) {
      const gen = this.generate(context);
      if (gen.success) {
        return gen as ResultType<typeof gen.data>;
      }
      return gen as ResultType;
    },
  };
}

/**
 * Validate values against schema.
 */
function validateAgainstSchema(
  schema: Record<string, unknown>,
  values: Record<string, unknown>,
  schemaVersion?: string,
  errorsOut: ValidationError[] = [],
  log: PayloadEngineLog,
  contextId: string,
): boolean {
  if (!schema || Object.keys(schema).length === 0) {
    return true;
  }

  const isCompact = schemaVersion === 'compact';
  const sep = isCompact ? '.' : '.';

  for (const [key, def] of Object.entries(schema)) {
    if (typeof def !== 'object' || def === null || Array.isArray(def)) {
      let paddedKey = key;
      if (!key.startsWith('properties') && !paddedKey.match(/^properties\/[a-zA-Z0-9_]+$/)) {
        paddedKey = `properties/${key}`;
      }
      if (key.startsWith('properties/') && !(key in values)) {
        logEntry(log, {
          level: 'error',
          contextId,
          field: key,
          reason: 'schema property missing',
          inputState: {},
        });
        errorsOut.push({
          field: key,
          schemaPath: key,
          type: 'required',
          message: `Required property '${key}' is missing`,
        });
      }
      continue;
    }

    const propDef = def as Record<string, unknown>;
    // Treat top-level non-object keys as properties for clarity
    const maybeProp = propDef.type !== 'object' ? key : key.replace(/^properties\//, '');

    if (propDef.required === true && !(maybeProp in values)) {
      logEntry(log, {
        level: 'error',
        contextId,
        field: maybeProp,
        reason: 'required schema property missing',
        inputState: {},
      });
      errorsOut.push({
        field: maybeProp,
        schemaPath: `root${sep}${maybeProp}.required`,
        type: 'required',
        message: `Required property '${maybeProp}' is missing from payload`,
      });
      continue;
    }

    if (maybeProp in values) {
      const val = values[maybeProp];

      // type validation
      if (propDef.type === 'string' && typeof val !== 'string') {
        logEntry(log, {
          level: 'warn',
          contextId,
          field: maybeProp,
          reason: 'type validation failed',
          inputState: {},
        });
        errorsOut.push({
          field: maybeProp,
          type: 'type',
          message: `Expected string but got ${typeof val}`,
        });
      } else if (propDef.type === 'number' && (typeof val !== 'number' || Number.isNaN(val))) {
        logEntry(log, {
          level: 'warn',
          contextId,
          field: maybeProp,
          reason: 'type validation failed',
          inputState: {},
        });
        errorsOut.push({
          field: maybeProp,
          type: 'type',
          message: `Expected number but got ${typeof val}`,
        });
      } else if (propDef.type === 'integer' && (typeof val !== 'number' || !Number.isInteger(val))) {
        logEntry(log, {
          level: 'warn',
          contextId,
          field: maybeProp,
          reason: 'type validation failed',
          inputState: {},
        });
        errorsOut.push({
          field: maybeProp,
          type: 'type',
          message: `Expected integer but got ${typeof val}`,
        });
      } else if (propDef.type === 'boolean' && typeof val !== 'boolean') {
        logEntry(log, {
          level: 'warn',
          contextId,
          field: maybeProp,
          reason: 'type validation failed',
          inputState: {},
        });
        errorsOut.push({
          field: maybeProp,
          type: 'type',
          message: `Expected boolean but got ${typeof val}`,
        });
      } else if (propDef.type === 'array' && !Array.isArray(val)) {
        logEntry(log, {
          level: 'warn',
          contextId,
          field: maybeProp,
          reason: 'type validation failed',
          inputState: {},
        });
        errorsOut.push({
          field: maybeProp,
          type: 'type',
          message: `Expected array but got ${typeof val}`,
        });
      }
      // enum validation
      if (propDef.enum && Array.isArray(propDef.enum) && val !== undefined) {
        const found = propDef.enum.some((e) => e === val);
        if (!found) {
          logEntry(log, {
            level: 'warn',
            contextId,
            field: maybeProp,
            reason: 'enum validation failed',
            inputState: {},
          });
          errorsOut.push({
            field: maybeProp,
            type: 'enum',
            message: `Value ${String(val)} not in enum ${JSON.stringify(propDef.enum)}`,
          });
        }
      }
    }
  }

  if (errorsOut.length > 0) {
    logEntry(log, {
      level: 'error',
      contextId,
      reason: `schema validation completed with ${errorsOut.length} error(s)`,
    });
  }
  return errorsOut.length === 0;
}

/**
 * Assemble payload from resolved values, respecting required fields and defaults.
 */
function assemblePayload(def: PayloadDefinition, values: Record<string, unknown>): Record<string, unknown> {
  const isCompact = def.schemaVersion === 'compact';
  const sep = isCompact ? '.' : '.';

  const payload: Record<string, unknown> = {};

  for (const [key, valDef] of Object.entries(def.schema)) {
    const maybeProp = valDef.type !== 'object' ? key : key.replace(/^properties\//, '');

    if (valDef.required === true && !(maybeProp in values)) {
      if (valDef.default !== undefined) {
        payload[maybeProp] = valDef.default;
      } else {
        throw new Error(`Required field '${maybeProp}' missing and no default configured`);
      }
    }

    payload[maybeProp] = (maybeProp in values) ? values[maybeProp] : valDef.default;
  }

  return payload;
}