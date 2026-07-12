/**
 * Payload Generation Engine
 * Centralized payload generation based on declarative configs.
 */

import type { InputContext, FieldResolution, ValidationError, LogEntry, PayloadDefinition, Result as ResultType } from './types.js';

/**
 * History of all generated log entries.
 */
export type PayloadEngineLog = Array<LogEntry>;

/**
 * PayloadGenerator factory return.
 */
export type PayloadGenerator = {
  /**
   * Generate payload from input context.
   */
  generate(context: InputContext): ResultType;
  /**
   * Generate and validate payload; returns typed object on success.
   */
  generateTyped<T = unknown>(context: InputContext): ResultType<T>;
  /**
   * Get the last log entries.
   */
  getLog(): PayloadEngineLog;
  /**
   * Get the configured payload definition.
   */
  definition: PayloadDefinition;
  /**
   * Reset the internal log.
   */
  resetLog(): void;
};

/**
 * Path components for source resolution.
 */
type PathChunk = string | number;

/**
 * Create a logger for this generator instance.
 */
function createLogger(contextId: string): PayloadEngineLog {
  return [];
}

/**
 * Add a log entry.
 */
function logEntry(log: PayloadEngineLog, entry: LogEntry): void {
  log.push({ ...entry, timestamp: entry.timestamp || new Date().toISOString() });
}

/**
 * Resolve a source field from context.
 * supports nested paths with separators ('.', '/', '[]').
 */
function resolveFieldPath(
  context: InputContext,
  path: string,
  separator: string,
): FieldResolution {
  const chunks = path.split(separator) as PathChunk[];
  let current: unknown = context;
  let exists = true;

  for (const chunk of chunks) {
    if (current === null || current === undefined) {
      exists = false;
      break;
    }
    if (typeof current === 'object' && !Array.isArray(current) && chunk in current) {
      current = (current as Record<string, unknown>)[chunk];
    } else if (Array.isArray(current) && typeof chunk === 'number' && current[chunk] !== undefined) {
      current = current[chunk];
    } else {
      current = undefined;
      exists = false;
      break;
    }
  }

  return { value: current, exists: !!exists };
}

/**
 * Plan all sources configured across fields (direct sources + includesIf).
 */
function planAllSources(def: PayloadDefinition, inputs: InputContext): string[] {
  const sources = new Set<string>();

  for (const f of def.fields) {
    // direct source
    sources.add(f.source.path);

    // includeIf source (new source, required if both includeIf and src are required)
    if (f.includeIf) {
      sources.add(f.includeIf.field);
    }

    // derivedFunction (resolve later)
    if (f.transform?.derivedFunction) {
      sources.add(f.transform.derivedFunction);
    }
  }

  return Array.from(sources);
}

/**
 * Plan all output fields (including includesIf).
 */
function planAllFields(def: PayloadDefinition): Array<{ field: string; includeIf?: Object }> {
  const plan: Array<{ field: string; includeIf?: Object }> = [];

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
 * Async fields are treated as blocked/not-resolved to fail fast; they are NOT resolved here.
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
        reason: 'source field missing from input',
        inputState: inputs,
      });
    }
  }

  return resolved;
}

/**
 * Prepare field values after resolution and before validation.
 * Handles includeIf, defaults, array transforms, and omit missing optional fields.
 */
function prepareFieldValues(
  def: PayloadDefinition,
  resolved: Record<string, FieldResolution>,
  plan: Array<{ field: string; includeIf?: Object }>,
  log: PayloadEngineLog,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const item of plan) {
    // Find the corresponding field definition
    const f = def.fields.find((f2) => f2.alias ?? f2.name === item.field);
    if (!f) {
      logEntry(log, {
        level: 'error',
        contextId: 'unknown',
        field: item.field,
        reason: 'field definition missing from definition.fields',
      });
      continue;
    }

    const source = resolved[f.source.path];
    if (!source) {
      logEntry(log, {
        level: 'error',
        contextId: 'unknown',
        field: f.source.path,
        reason: 'source resolution result missing',
      });
      continue;
    }

    let value: unknown = undefined;
    let shouldInclude = true;

    // includeIf conditional
    if (f.includeIf) {
      const includeSourcePath = f.includeIf.field;
      const condEntry = resolved[includeSourcePath];
      if (!condEntry) {
        logEntry(log, {
          level: 'warn',
          contextId: 'unknown',
          field: f.source.path,
          reason: 'includeIf source field not resolved',
        });
        continue;
      }

      const includeValue = condEntry.value;
      const target = f.includeIf;
      const op = target.operator;
      const refVal = f.alias ?? f.name;

      let match = false;
      switch (op) {
        case 'equals':
          match = includeValue === target.value;
          break;
        case 'notEquals':
          match = includeValue !== target.value;
          break;
        case 'contains':
          match = typeof includeValue === 'string' && target.value && typeof target.value === 'string' && includeValue.includes(target.value);
          break;
        case 'startsWith':
          match = typeof includeValue === 'string' && target.value && typeof target.value === 'string' && includeValue.startsWith(target.value);
          break;
        case 'endsWith':
          match = typeof includeValue === 'string' && target.value && typeof target.value === 'string' && includeValue.endsWith(target.value);
          break;
        case 'greaterThan':
          match = typeof includeValue === 'number' && typeof target.value === 'number' && includeValue > target.value;
          break;
        case 'lessThan':
          match = typeof includeValue === 'number' && typeof target.value === 'number' && includeValue < target.value;
          break;
        case 'in':
          match = Array.isArray(target.value) && target.value.includes(includeValue);
          break;
        case 'exists':
          match = includeValue !== undefined && includeValue !== null;
          break;
        default:
          logEntry(log, {
            level: 'error',
            contextId: 'unknown',
            field: refVal,
            reason: `unsupported includeIf operator ${op}`,
          });
          continue;
      }
      shouldInclude = match;
    }

    if (!shouldInclude) {
      continue;
    }

    if (!source.exists) {
      if (typeof f.source.required === 'boolean' && f.source.required) {
        const refName = f.alias ?? f.name;
        logEntry(log, {
          level: 'error',
          contextId: 'unknown',
          field: refName,
          reason: `required field '${f.source.path}' missing or null`,
          inputState: inputs,
        });
        continue; // skip; error recorded but not returned
      } else if (f.source.defaultValue !== undefined) {
        value = f.source.defaultValue;
      } else {
        // optional, omit
        continue;
      }
    } else {
      value = source.value;
    }

    // apply array transforms (if configured)
    if (f.transform?.arrayTransform) {
      const arrayEntryHref = (f.transform.arrayTransform.field as string);
      const atPath = f.alias ?? f.name;
      const arrayRes = resolved[arrayEntryHref];
      if (!arrayRes) {
        logEntry(log, {
          level: 'warn',
          contextId: 'unknown',
          field: atPath,
          reason: 'arrayTransform source field not resolved',
        });
        continue;
      }
      const arr = arrayRes.value;
      if (!Array.isArray(arr)) {
        logEntry(log, {
          level: 'warn',
          contextId: 'unknown',
          field: atPath,
          reason: `arrayTransform source is not an array`,
        });
        continue;
      }
      const tExpr = f.transform.arrayTransform.transform;
      // custom function name vs simple transform
      let transformed: unknown;
      if (tExpr.startsWith('fn:')) {
        // function-based: 'fn:fnName'
        const fnName = tExpr.slice(3).trim();
        transformed = invokeDerivedOrCustom(fnName, arr);
      } else {
        transformed = invokeDerivedOrCustom(tExpr, arr);
      }
      value = transformed;
    }

    values[item.field] = value;
  }

  return values;
}

/**
 * Helper to execute derived/Custom functions against arrays.
 * Supports 'map(prop)' or 'fn:fnName'.
 */
function invokeDerivedOrCustom(fn: string, arg: unknown): unknown {
  // If fn is a plain function name like 'map(prop)', treat as derived.
  if (fn.startsWith('map(') && fn.endsWith(')') && !fn.startsWith('fn:')) {
    const prop = fn.slice(4, -1).trim();
    if (arg && Array.isArray(arg)) {
      return arg.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>)[prop] : void 0));
    }
    return [];
  }
  // Otherwise, treat as custom/fnName function call
  // NOTE: This is a default; callers can extend by registering functions or local implementations.
  if (typeof fn === 'string' && fn.startsWith('fn:')) {
    return `UNRESOLVED_IMPLEMENTED_FN:${fn}`;
  }
  return `UNKNOWN_DERIVED_FN:${fn}`;
}

/**
 * Factory to create a PayloadGenerator instance.
 */
export function createPayloadGenerator(
  payloadDefinition: PayloadDefinition,
  logger: PayloadEngineLog = createLogger(payloadDefinition.id),
): PayloadGenerator {
  const isBufferedLogger = Array.isArray(logger);
  const currentLog: PayloadEngineLog = [];

  const resolvedSources = planAllSources(payloadDefinition, {} as InputContext);
  const resolvedPlan = planAllFields(payloadDefinition);

  return {
    get definition(): PayloadDefinition {
      return payloadDefinition;
    },
    getLog() {
      return isBufferedLogger ? logger : [...currentLog];
    },
    resetLog() {
      if (isBufferedLogger) {
        Object.assign(logger, { length: 0, pop: () => void 0 }); // minimal clear; runtime will overwrite
      } else {
        currentLog.length = 0;
      }
    },
    generate(context) {
      const current = isBufferedLogger ? logger : currentLog;
      const separator = payloadDefinition.schemaVersion === 'compact' ? '.' : '.';
      const contextId = `gen:${payloadDefinition.id}`;

      // Resolve all sources
      const resolvedSourcesPath = planAllSources(payloadDefinition, context);
      const sourceres = resolveSources(payloadDefinition, context, separator, resolvedSourcesPath, current);
      const planFields = planAllFields(payloadDefinition);
      const v = prepareFieldValues(payloadDefinition, sourceres, planFields, current);

      const errors: ValidationError[] = [];
      if (payloadDefinition.schema) {
        const valid = validateAgainstSchema(payloadDefinition.schema, v, payloadDefinition.schemaVersion, errors, current, contextId);
        if (!valid) {
          return { success: false, errors };
        }
      }

      const payload = assemblePayload(payloadDefinition, v);
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
 * Apply transformation rules (derived, enum, type, expression) to prepared values.
 * This helper is intentionally simplified for iterative inclusion; higher-level uses can call per-field logic.
 */
function applyTransforms(
  values: Record<string, unknown>,
  def: PayloadDefinition,
  log: PayloadEngineLog,
  contextId: string,
): Record<string, unknown> {
  const transformed: Record<string, unknown> = { ...values };

  for (const f of def.fields) {
    const fieldName = f.alias ?? f.name;
    const srcVal = values[f.source.path];
    if (srcVal === undefined) continue;
    transformed[fieldName] = srcVal;

    // derivedFunction
    if (f.transform?.derivedFunction) {
      const fnName = f.transform.derivedFunction;
      const arrSrc = Array.isArray(srcVal) ? srcVal : undefined;
      const transformedVal = invokeDerivedOrCustom(fnName, arrSrc);
      transformed[fieldName] = transformedVal;
    }

    // enum map
    if (f.transform?.enumMap) {
      if (typeof srcVal === 'string') {
        transformed[fieldName] = f.transform.enumMap[srcVal] ?? srcVal;
      } else {
        transformed[fieldName] = srcVal;
      }
    }

    // type coercion
    const t = f.transform?.type;
    let coerced: unknown = srcVal;
    if (t) {
      coerced = coerceType(srcVal, t, fieldName, log, contextId);
    }
    transformed[fieldName] = coerced;
  }

  return transformed;
}

/**
 * Type coercion helper.
 */
function coerceType(value: unknown, to: string, field: string, log: PayloadEngineLog, contextId: string): unknown {
  if (value === null || value === undefined) return value;

  switch (to) {
    case 'string':
      return String(value);
    case 'number':
      return typeof value === 'number' ? value : parseFloat(String(value));
    case 'integer':
      return Number.isInteger(Number(value)) ? Number(value) : Math.trunc(Number(value));
    case 'boolean':
      return Boolean(value);
    case 'date':
    case 'epoch':
      if (typeof value === 'number') return new Date(value);
      const date = new Date(String(value));
      if (isNaN(date.getTime())) {
        logEntry(log, {
          level: 'error',
          contextId,
          field,
          reason: 'date coercion failed; cannot parse input as date or epoch',
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
  // empty schema: always pass
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
      // basic presence check
      if (key.startsWith('properties/') && !(key in values)) {
        logEntry(log, {
          level: 'error',
          contextId,
          field: key,
          reason: 'schema property missing from payload',
          inputState: values,
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
    const maybeProp = propDef.type !== 'object' ? key : key.replace(/^properties\//, '');

    if (propDef.required === true && !(maybeProp in values)) {
      logEntry(log, {
        level: 'error',
        contextId,
        field: maybeProp,
        reason: 'schema required property missing',
        inputState: values,
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
          reason: 'schema type validation failed',
          inputState: values,
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
          reason: 'schema type validation failed',
          inputState: values,
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
          reason: 'schema type validation failed',
          inputState: values,
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
          reason: 'schema type validation failed',
          inputState: values,
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
          reason: 'schema type validation failed',
          inputState: values,
        });
        errorsOut.push({
          field: maybeProp,
          type: 'type',
          message: `Expected array but got ${typeof val}`,
        });
      }
      // enum validation (if any)
      if (propDef.enum && Array.isArray(propDef.enum) && val !== undefined) {
        const found = propDef.enum.some((e) => e === val);
        if (!found) {
          logEntry(log, {
            level: 'warn',
            contextId,
            field: maybeProp,
            reason: 'schema enum validation failed',
            inputState: values,
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

  const hasErrors = errorsOut.length > 0;
  if (hasErrors) {
    logEntry(log, {
      level: 'error',
      contextId,
      reason: `schema validation completed with ${errorsOut.length} error(s)`,
    });
  }
  return !hasErrors;
}

/**
 * Assemble payload from resolved values, respecting required fields and defaults.
 */
function assemblePayload(def: PayloadDefinition, values: Record<string, unknown>): Record<string, unknown> {
  const isCompact = def.schemaVersion === 'compact';
  const sep = isCompact ? '.' : '.';

  const schemaKeys = def.schema;
  const payload: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(schemaKeys)) {
    const maybeProp = def.type !== 'object' ? key : key.replace(/^properties\//, '');

    // required rule
    if (def.required === true && !(maybeProp in values)) {
      if (def.default !== undefined) {
        payload[maybeProp] = def.default;
      } else {
        throw new Error(`Required field '${maybeProp}' missing and no default configured`);
      }
    }

    if (maybeProp in values) {
      payload[maybeProp] = values[maybeProp];
    } else if (def.default !== undefined) {
      payload[maybeProp] = def.default;
    }
  }

  return payload;
}