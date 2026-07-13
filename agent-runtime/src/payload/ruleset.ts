/**
 * Business Ruleset Catalog
 * Loads and exposes the catalog loaded from business-rules.json; provides helpers to
 * resolve, build derived function maps, and apply ruleset transforms.
 *
 * PRD FR-3 — central, versioned business rules source.
 */

import type {
  OutputField,
  InputContext,
  FieldResolution,
  CustomFunction,
  LogEntry,
  ValidationError,
  Result
} from './types';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

/**
 * Derived function signature compatible with engine's custom functions.
 */
export type DerivedFunction = (args: {
  context: InputContext;
  resolved: Record<string, FieldResolution>;
  sourcePath: string;
}) => unknown;

/**
 * Predicate function used in business rule conditions.
 */
export type Predicate = (args: {
  context: InputContext;
  resolved: Record<string, FieldResolution>;
  field: string;
  value: unknown;
}) => boolean;

/**
 * Business rule definition from catalog.
 */
interface BusinessRule {
  name: string;
  description?: string;
  appliesTo?: string[];
  typeOrDerived: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'epoch' | 'derivedFunction';
  nullable?: boolean;
  coerce?: boolean;
  enumMappings?: Record<string, string>;
  condition?: {
    field: string;
    operator:
      | 'equals'
      | 'notEquals'
      | 'contains'
      | 'startsWith'
      | 'endsWith'
      | 'greaterThan'
      | 'lessThan'
      | 'exists';
    value?: unknown;
  };
  fn?: string;
  functionAliases?: string[];
}

/**
 * Business ruleset definition from catalog.
 */
export interface BusinessRuleset {
  name: string;
  version: string;
  description?: string;
  appliesTo?: string[];
  rules: BusinessRule[];
}

/**
 * Ruleset catalog loaded from business-rules.json.
 */
export interface RulesetCatalog {
  title: string;
  version: string;
  schema: Record<string, unknown>;
  rulesets: BusinessRuleset[];
}

// -----------------------------------------------------------------------
// Built-in Derived Functions
// -----------------------------------------------------------------------

/**
 * Built-in derived functions exposed by the module.
 */
const BUILTIN_DERIVED_FUNCTIONS: Record<string, DerivedFunction> = {
  fullName(args: { context: InputContext; resolved: Record<string, FieldResolution>; sourcePath: string }): unknown {
    const nameParts = [
      args.resolved.name?.value,
      args.resolved.firstName?.value,
      args.resolved.lastName?.value
    ].filter((v): v is string => v != null);
    return nameParts.join(' ');
  },
  identity(args: { context: InputContext; resolved: Record<string, FieldResolution>; sourcePath: string }): unknown {
    return args.resolved[args.sourcePath]?.value;
  },
  upper(args: { context: InputContext; resolved: Record<string, FieldResolution>; sourcePath: string }): unknown {
    const value = args.resolved[args.sourcePath]?.value;
    return value != null && typeof value === 'string' ? value.toUpperCase() : value;
  },
  lower(args: { context: InputContext; resolved: Record<string, FieldResolution>; sourcePath: string }): unknown {
    const value = args.resolved[args.sourcePath]?.value;
    return value != null && typeof value === 'string' ? value.toLowerCase() : value;
  }
};

// -----------------------------------------------------------------------
// Catalog Management
// -----------------------------------------------------------------------

let CATALOG: RulesetCatalog | null = null;

/**
 * Initialize the ruleset catalog by loading business-rules.json.
 * Called lazily on first access; throws if file cannot be read or parsed.
 */
function loadCatalog(): RulesetCatalog {
  if (CATALOG) return CATALOG;

  try {
    const module = await import('./business-rules.json');
    if (!module.default) throw new Error('business-rules.json did not export a default object');
    CATALOG = module.default as RulesetCatalog;
    // Basic vetting: ensure catalog shape
    if (!CATALOG.title || !(typeof CATALOG.title === 'string')) throw new Error('Missing or non-string catalog title');
    if (!CATALOG.version || !(typeof CATALOG.version === 'string')) throw new Error('Missing or non-string catalog version');
    if (!Array.isArray(CATALOG.rulesets)) throw new Error('Catalog missing rulesets array');
  } catch (err) {
    // Fail loudly: this is CATASTROPHIC for payload generation
    throw new Error('Failed to load ruleset catalog: ' + (err as Error).message);
  }
  return CATALOG;
}

/**
 * Get the entire ruleset catalog.
 */
export function getBusinessRulesets(): BusinessRuleset[] {
  return loadCatalog().rulesets;
}

/**
 * Resolve a specific ruleset by name.
 */
export function resolveBusinessRuleset(name: string): BusinessRuleset | undefined {
  return loadCatalog().rulesets.find((r) => r.name === name);
}

/**
 * Register a new business ruleset (for AC-8 extensible payload generation).
 * Optionally validates against catalog schema.
 */
export function registerBusinessRuleset(ruleset: BusinessRuleset): void {
  const catalog = loadCatalog();
  if (!catalog.rulesets) throw new Error('Catalog rulesets is not an array');
  // Basic sanity checks
  if (
    !ruleset.name ||
    typeof ruleset.name !== 'string' ||
    !ruleset.version ||
    typeof ruleset.version !== 'string' ||
    !Array.isArray(ruleset.rules)
  ) {
    throw new Error('Invalid ruleset definition (name, version, rules required)');
  }
  // Avoid duplicates; replace if exists
  const idx = catalog.rulesets.findIndex((r) => r.name === ruleset.name);
  if (idx >= 0) catalog.rulesets[idx] = ruleset;
  else catalog.rulesets.push(ruleset);
}

// -----------------------------------------------------------------------
// Derived Function Map
// -----------------------------------------------------------------------

/**
 * Build a map of derived function names to actual function implementations.
 * Merges built-in and user-provided functions; prefers user-defined overrides.
 */
export function buildDerivedFunctionMap(ruleset?: BusinessRuleset): Record<string, DerivedFunction> {
  const map = { ...BUILTIN_DERIVED_FUNCTIONS };
  if (!ruleset) return map;
  for (const rule of ruleset.rules) {
    if (rule.typeOrDerived !== 'derivedFunction' || !rule.fn) continue;
    // If the rule has a function defined (fn), assume a custom function provider will supply it.
    // In real implementations, the caller would register the function before building the map.
    // For now, we just name the entry.
    const functionName = rule.fn;
    if (!map[functionName]) {
      map[functionName] = (args: { context: InputContext; resolved: Record<string, FieldResolution>; sourcePath: string }): unknown => {
        // Place-holder: actual implementation must be registered by caller.
        // Returning undefined preserves the "derived but not provided to generator" semantics.
        // Builtin functions (fullName, identity, upper, lower) are covered above.
        return undefined;
      };
    }
  }
  return map;
}

// -----------------------------------------------------------------------
// Rule Application Helpers
// -----------------------------------------------------------------------

/**
 * Evaluate a business rule condition; returns false if not met.
 */
function evaluateCondition(
  args: { context: InputContext; resolved: Record<string, FieldResolution>; field: string },
  condition: BusinessRule['condition']
): boolean {
  if (!condition) return true;
  const { field: targetField, operator, value } = condition;
  const resolved = args.resolved[targetField];
  const fieldExists = resolved?.exists ?? false;
  const fieldValue = resolved?.value;

  switch (operator) {
    case 'equals':
      return fieldValue === value;
    case 'notEquals':
      return fieldValue !== value;
    case 'contains':
      return Array.isArray(fieldValue) && fieldValue.includes(value);
    case 'startsWith':
      return typeof fieldValue === 'string' && fieldValue.startsWith(value);
    case 'endsWith':
      return typeof fieldValue === 'string' && fieldValue.endsWith(value);
    case 'greaterThan':
      if (typeof fieldValue !== 'number' || typeof value !== 'number') return false;
      return fieldValue > value;
    case 'lessThan':
      if (typeof fieldValue !== 'number' || typeof value !== 'number') return false;
      return fieldValue < value;
    case 'exists':
      return fieldExists;
    default:
      return false;
  }
}

/**
 * Apply a ruleset rule to a field value.
 * - Resolves the value.
 * - Checks condition.
 * - Applies enum mapping if matching.
 * - Coerces to target typeOrDerived.
 */
function applyRulesetTransform(
  rule: BusinessRule,
  sourceValue: unknown,
  args: { context: InputContext; resolved: Record<string, FieldResolution>; loggerFn: (entry: LogEntry) => void }
): unknown {
  const { name, typeOrDerived, enumMappings, nullable, coerce, functionAliases, condition, fn } = rule;
  const { context, resolved, loggerFn } = args;

  // 1. Resolve value: sourceValue if provided, otherwise from resolved path
  let value = sourceValue ?? resolved[name]?.value;
  // 2. Check condition: run condition if defined; if result is false, the field is omitted
  if (condition !== undefined && !evaluateCondition({ context, resolved, field: condition.field }, condition)) {
    loggerFn({
      timestamp: new Date().toISOString(),
      level: 'info',
      contextId: '',
      field: name ?? '',
      ruleId: name ?? '',
      reason: `Condition not met for ${name || '<unknown-rule>'}`
    });
    return undefined;
  }

  // 3. Nullable control if explicit override is given
  const nullableOverride = nullable != null ? nullable : !coerce;
  if (value == null && !nullableOverride) {
    // Missing required value after condition
    loggerFn({
      timestamp: new Date().toISOString(),
      level: 'error',
      contextId: '',
      field: name ?? '',
      ruleId: name ?? '',
      reason: `Missing required value for rule ${name ?? '<unknown-rule>'}`
    });
    return undefined;
  }

  // 4. Enum mapping: only apply if value is string and mapping exists
  if (enumMappings != null && typeof value === 'string') {
    const mapped = enumMappings[value];
    if (mapped != null) {
      value = mapped;
    }
  }

  // 5. Type coercion:
  if (coerce !== false) {
    // Build coercion config
    const typeConfig: { type?: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'epoch'; nullable?: boolean } = {};
    if (typeOrDerived !== 'derivedFunction') typeConfig.type = typeOrDerived;
    if (value != null && value !== false) {
      // Treat a falsey boolean-like as truthy: coerce 'false' to false, else truthy to true
      if (typeConfig.type === 'boolean' && typeof value === 'string') {
        value = value === 'false' ? false : true;
      }
    }
    // Apply coercion
    if (typeOrDerived !== 'derivedFunction') {
      value = coerceValue(value, typeOrDerived, nullableOverride);
    }
  }

  // 6. Derived function
  if (typeOrDerived === 'derivedFunction') {
    if (!fn) {
      loggerFn({
        timestamp: new Date().toISOString(),
        level: 'error',
        contextId: '',
        field: name ?? '',
        ruleId: name ?? '',
        reason: `Missing fn for derivedFunction rule ${name ?? '<unknown-rule>'}`
      });
      return undefined;
    }
    const derivedFn = BUILTIN_DERIVED_FUNCTIONS[fn] || (functionAliases?.[0] != null ? BUILTIN_DERIVED_FUNCTIONS[functionAliases[0]] : undefined);
    if (!derivedFn) {
      loggerFn({
        timestamp: new Date().toISOString(),
        level: 'error',
        contextId: '',
        field: name ?? '',
        ruleId: name ?? '',
        reason: `Missing derivation function for rule ${name ?? '<unknown-rule>'}`
      });
      return undefined;
    }
    try {
      const derivedResult = derivedFn({ context, resolved, sourcePath: name ?? '' });
      if (derivedResult == null && !nullableOverride) {
        loggerFn({
          timestamp: new Date().toISOString(),
          level: 'error',
          contextId: '',
          field: name ?? '',
          ruleId: name ?? '',
          reason: `Derived function returned undefined for rule ${name ?? '<unknown-rule>'}`
        });
        return undefined;
      }
      value = derivedResult;
    } catch (e) {
      loggerFn({
        timestamp: new Date().toISOString(),
        level: 'error',
        contextId: '',
        field: name ?? '',
        ruleId: name ?? '',
        reason: `Derived function error for rule ${name ?? '<unknown-rule>'}`
      });
      return undefined;
    }
  }

  return value;
}

/**
 * Coerce a source value to target type.
 */
function coerceValue(value: unknown, type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'epoch', nullable?: boolean): unknown {
  if (value == null) {
    return nullable === false ? undefined : null;
  }

  switch (type) {
    case 'string':
      return String(value);
    case 'integer':
      const n = Number(value);
      return Number.isInteger(n) ? n : typeof value === 'number' ? Math.trunc(value) : null;
    case 'number':
      return Number(value) || (value === 0 ? 0 : null);
    case 'boolean':
      if (typeof value === 'boolean') return value;
      return value ? true : false;
    case 'date':
      if (!(value instanceof Date)) {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      return value;
    case 'epoch':
      if (!(value instanceof Date)) {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d.getTime();
      }
      return value.getTime();
  }
}

// -----------------------------------------------------------------------
// Annotated Derivation Wrapper
// -----------------------------------------------------------------------

/**
 * @param fieldOutputName - The output field name that this rule applies to.
 * @param sourceValue - The resolved source value before transformation.
 * @returns derivedOutcome - { outcome, appliedRule }.
 */
export function derive(
  fieldOutputName: string,
  sourceValue: unknown,
  args: {
    context: InputContext;
    resolved: Record<string, FieldResolution>;
    activeRuleset?: BusinessRuleset;
    loggerFn: (entry: LogEntry) => void;
  }
): unknown {
  let outcome = sourceValue;
  if (args.activeRuleset == null || sourceValue == null) return outcome;

  // Find applicable rule(s) for this field.
  // If rule.name matches fieldOutputName, we likely apply it. For simplicity, apply first match.
  const applicable = args.activeRuleset.rules.find((r) => r.name === fieldOutputName && !r.appliesTo);
  const rule = applicable ?? args.activeRuleset.rules.find((r) => r.appliesTo?.includes(fieldOutputName));
  if (!rule) return outcome;

  const result = applyRulesetTransform(rule, outcome, args);
  return result;
}