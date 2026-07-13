/**
 * Business Ruleset Catalog
 *
 * Functions for loading and resolving business rules definitions from
 * business-rules.json, as required by FR‑3 (Business Rule Application).
 */

import type { RulesetCatalog, BusinessRuleset, BusinessRule, DerivedFunction } from './types.js';

/**
 * In-memory cache of loaded catalogs keyed by file path.
 * This avoids repeated file reads during tests or many calls.
 */
const cachedCatalogs = new Map<string, RulesetCatalog>();

/**
 * Load the business rules catalog from the configured JSON file.
 *
 * @param filePath - Path to business-rules.json (default: src/payload/business-rules.json).
 * @returns The fully parsed and validated catalog.
 * @throws Any error from JSON parsing or schema validation is propagated.
 */
export function getBusinessRulesets(
  filePath = 'agent-runtime/src/payload/business-rules.json'
): RulesetCatalog {
  // Return cached catalog if available.
  if (cachedCatalogs.has(filePath)) {
    return cachedCatalogs.get(filePath)!;
  }

  // Load and parse the JSON file.
  const content = import.meta.glob(filePath, { as: 'raw', eager: true });
  if (!(filePath in content)) {
    throw new Error(`business-rules catalog not found at ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content[filePath] as string);
  } catch (err) {
    throw new Error(`Failed to parse business-rules.json at ${filePath}: ${err}`);
  }

  // Basic sanity schema checks (top-level keys and basic object shape).
  const suspectKeys = ['nullable', 'coerce', 'transformations', 'schema'];
  const str = (content[filePath] as string);
  for (const reserved of suspectKeys) {
    if (str.toLowerCase().includes(reserved)) {
      throw new Error(`Root JSON contains stray reserved key '${reserved}'; validate schema`);
    }
  }

  // Ensure required top-level properties exist.
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.title !== 'string') {
    throw new Error(`business-rules JSON missing or invalid 'title' (top-level string)`);
  }
  if (typeof doc.version !== 'string') {
    throw new Error(`business-rules JSON missing or invalid 'version' (top-level string)`);
  }
  if (doc.rulesets === undefined) {
    throw new Error(`business-rules JSON missing or invalid 'rulesets' (top-level array)`);
  }

  // Validate that each ruleset definition matches expected shape.
  if (!Array.isArray(doc.rulesets)) {
    throw new Error(`business-rules JSON 'rulesets' is not an array`);
  }

  for (const rs of doc.rulesets) {
    const rsItem = rs as Record<string, unknown>;
    if (typeof rsItem.name !== 'string') {
      throw new Error(`ruleset missing or invalid 'name' (string)`);
    }
    if (typeof rsItem.version !== 'string') {
      throw new Error(`ruleset missing or invalid 'version' (string)`);
    }
    if (rsItem.rules === undefined) {
      throw new Error(`ruleset missing or invalid 'rules' (array)`);
    }
    if (!Array.isArray(rsItem.rules)) {
      throw new Error(`ruleset 'rules' is not an array`);
    }

    // Validate each rule.
    for (const rule of rsItem.rules) {
      const r = rule as Record<string, unknown>;
      if (typeof r.name !== 'string') {
        throw new Error(`rule missing or invalid 'name' (string)`);
      }
      const typeOrDerived = r.typeOrDerived as string | undefined;
      if (typeOrDerived === undefined) {
        throw new Error(`rule missing or invalid 'typeOrDerived' (string: string|number|integer|boolean|date|epoch|derivedFunction)`);
      }
    }
  }

  // Cache the catalog and return.
  cachedCatalogs.set(filePath, parsed as RulesetCatalog);
  return parsed as RulesetCatalog;
}

/**
 * Resolve the business ruleset for a given payload type name, if known.
 *
 * @param rulesetName - Name of the ruleset to retrieve (e.g., "user", "order").
 * @param catalogPath - Path to the catalog (default: src/payload/business-rules.json).
 * @returns The ruleset matching rulesetName, or undefined if not found or catalog not loaded.
 */
export function resolveBusinessRuleset(
  rulesetName: string,
  catalogPath = 'agent-runtime/src/payload/business-rules.json'
): BusinessRuleset | undefined {
  try {
    const catalog = getBusinessRulesets(catalogPath);
    return catalog.rulesets.find((rs) => rs.name.toLowerCase() === rulesetName?.toLowerCase());
  } catch {
    // On errors (missing catalog, parse errors), treat as not found.
    return undefined;
  }
}

/**
 * Build a map of derived function names to implementation callbacks for a given ruleset.
 *
 * @param rulesetName - Name of the ruleset.
 * @param provisionedFunctions - Optional map of function names to DerivedFunction callbacks.
 * @param catalogPath - Path to the catalog (default: src/payload/business-rules.json).
 * @returns Object mapping derived function keys to closures that compute the derived value.
 */
export function buildDerivedFunctionMap(
  rulesetName: string,
  provisionedFunctions?: Record<string, DerivedFunction>,
  catalogPath = 'agent-runtime/src/payload/business-rules.json'
): Record<string, DerivedFunction> {
  const ruleset = resolveBusinessRuleset(rulesetName, catalogPath);
  const map: Record<string, DerivedFunction> = { ...provisionedFunctions };

  if (!ruleset) {
    return map;
  }

  for (const rule of ruleset.rules) {
    if (rule.typeOrDerived === 'derivedFunction' && rule.fn) {
      if (!map[rule.fn]) {
        // Warn if a derivedFunction is referenced in ruleset but not provisioned.
        console.warn(
          `[ruleset] derivedFunction '${rule.fn}' is referenced but not provisioned in ruleset '${rulesetName}'`
        );
      }
    }
  }

  return map;
}

/**
 * Unified derive() function for business ruleset derived fields.
 * Handles fn:fnName placeholders from engine and callable functions from ruleset references.
 *
 * @param derivedKey - Key of the derived field (e.g., 'fullName', 'uppercase').
 * @param args - Arguments from the engine's derive() call (context, resolved, sourcePath).
 * @param plan - Derived function plan string (e.g., 'fn:upper', 'fn:fullName').
 * @param provisionedFunctions - Optional map of function names to callables.
 * @returns Resolved derived value (or undefined if not provided/provisioned).
 */
export function derive(
  derivedKey: string,
  args: {
    context: import('./types.js').InputContext;
    resolved: Record<string, import('./types.js').FieldResolution>;
    sourcePath: string;
  },
  plan: string,
  provisionedFunctions?: Record<string, import('./types.js').DerivedFunction>
): unknown {
  // Determine actual function name to look up—derivedKey itself or 'fn:name' plan.
  let fnName: string;
  const s = plan.trim();
  if (s.startsWith('fn:')) {
    fnName = s.slice(3);
  } else {
    fnName = derivedKey;
  }

  fnName = fnName.trim();

  // Look up function in provisioned functions map.
  const f = provisionedFunctions?.[fnName];
  if (typeof f !== 'function') {
    // Not provisioned; return undefined (no transform).
    return undefined;
  }

  try {
    return f(args);
  } catch (err) {
    console.warn(`[ruleset/derive] strategy '${plan}' failed for field '${derivedKey}': ${err}`);
    return undefined;
  }
}

/**
 * Register a business ruleset with a fallback map of provisioned functions.
 * This is used by the engine to extend ruleset runtime behavior for derived functions.
 *
 * @param rulesetName - Name of the ruleset.
 * @param provisionedFunctions - Mapping from derived function name to implementation.
 * @param catalogPath - Path to the catalog (default: src/payload/business-rules.json).
 * @returns Updated function map (merged).
 */
export function registerBusinessRuleset(
  rulesetName: string,
  provisionedFunctions: Record<string, DerivedFunction>,
  catalogPath = 'agent-runtime/src/payload/business-rules.json'
): Record<string, DerivedFunction> {
  const existing = provisionedFunctions;
  const merged = { ...existing };
  const currentMap = buildDerivedFunctionMap(rulesetName, merged, catalogPath);
  // Merge provisioned ruleset functions into the shared map.
  for (const [k, v] of Object.entries(currentMap)) {
    merged[k] = v;
  }
  return merged;
}