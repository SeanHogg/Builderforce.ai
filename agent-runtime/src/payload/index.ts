/**
 * Payload Generation Module
 *
 * This module provides a centralized, declarative way to construct,
 * transform, and validate outgoing payloads for integration or event
 * publishing.
 *
 * Overview
 * --------
 * - Declarative configuration (PayloadDefinition) defines which source
 *   fields map to which output fields and how data should be transformed.
 * - A Generator (createPayloadGenerator) knows the mapping, validation
 *   schema, and any registered custom functions.
 * - Generation is performed via `.generate(context)` and returns a
 *   `Result<T>` that expresses success or a list of structured errors.
 *
 * Business Rulesets (FR‑3 / AC‑5 / AC‑8)
 * --------------------------------------
 * - Business rules are defined in business-rules.json and loaded via
 *   getBusinessRulesets().
 * - Rulesets can be resolved by name via resolveBusinessRuleset().
 * - Derived functions from rulesets can be built via buildDerivedFunctionMap().
 * - The derive() function is the unified entry point for derived field resolution.
 * - New payload types can register rulesets without modifying the core engine.
 *
 * Basic Usage
 * -----------
 * import { createPayloadGenerator } from "./engine.js";
 * import type { Result } from "./engine.js";
 *
 * const def = {
 *   id: "example-payload-v1",
 *   schema: {
 *     required: ["id", "fullName"],
 *     properties: {
 *       id: { type: "string" },
 *       fullName: { type: "string", required: true },
 *     },
 *   },
 *   fields: [
 *     {
 *       name: "fullName",
 *       source: { path: "user.profile.name", required: true },
 *     },
 *   ],
 * };
 *
 * const generator = createPayloadGenerator(def);
 * const result: Result<Record<string, unknown>> = generator.generate({
 *   user: { profile: { name: "Alice" } },
 * });
 *
 * if (!result.success) {
 *   console.error("Payload generation failed:", result.errors);
 * } else {
 *   console.log("Payload:", JSON.stringify(result.data, null, 2));
 * }
 *
 * Key Features
 * ------------
 * - Field Mapping
 *   - Direct: "user.id" → "id" (default).
 *   - Aliasing: alias: "userId" for a field named "id".
 *   - Paths: use dot notation and index brackets (e.g., "items[0].name").
 *
 * - Transformations
 *   - Type coercion: transform: { type: { type: "number" } } via transform.type
 *   - Derived functions: transform: { derivedFunction: "upper" }
 *   - Array transforms: transform: { arrayTransform: { field: "tags", transform: "fn:upperAt" } }
 *
 * - Default Values
 *   - source.defaultValue is applied when the source is missing and the field
 *     is not required.
 *   - Schema-level defaults (schema.properties[key].default) are applied
 *     after all field resolutions.
 *
 * - Validation
 *   - Required fields must appear in the schema (schema.required or
 *     properties with required: true). Missing required fields result in a
 *     Result.success=false with a validation error.
 *   - Values are validated against their declared schema type and enum.
 *
 * - Error Handling & Observability
 *   - Result.success indicates successful generation; Result.errors is a
 *     structured list of ValidationError objects.
 *   - Every error and validation failure is emitted as a LogEntry.
 *     You can provide an optional `logSink` callback to receive logs in
 *     real time (FR‑6). The log entries contain contextId, field name, level, and reason.
 *
 * - Extensibility
 *   - New payload types are added by registering a new PayloadDefinition.
 *   - Custom transformation functions can be registered by passing a
 *     `functions` object to createPayloadGenerator. Functions must be
 *     compatible with the CustomFunction signature:
 *         type CustomFunction = (args: {
 *           context: InputContext;
 *           resolved: Record<string, FieldResolution>;
 *           sourcePath: string;
 *         }) => unknown;
 *   - Alternating output formats (XML, Protobuf) can be implemented by
 *     returning an object that the caller serializes, leaving concrete
 *     transport concerns to the calling code.
 *
 * - Business Ruleset Integration
 *   - Use applyRulesetEnumMappings() to apply ruleset-defined enum mappings to fields.
 *   - Use applyRulesetEnumMappingsToDefinition() to apply all mappings from a ruleset to a payload definition.
 *   - Use registerBusinessRuleset() to add derived functions to a ruleset's function map.
 *
 * Asynchronous Resolution (Future)
 * ---------------------------------
 * The SourceDefinition supports an async flag, but actual async pipeline
 * resolution is not implemented in this iteration. Lookups are performed
 * synchronously. When ready, a generator methodchain can sequence async
 * fetches and replace resolved results in the context before calling
 * generate().
 *
 * Logging Strategy
 * ----------------
 * Since the generator remembers state between calls, you can accumulating
 * logs and optionally reset them with .resetLog(). To avoid state
 * accumulation across generations, create a new generator per call.
 * Alternatively, provide logSink to receive entries immediately without
 * retaining them in memory.
 */

/* Core exports from engine */
export { createPayloadGenerator } from "./engine.js";
export type { CustomFunction } from "./engine.js";

/* Type exports from engine */
export type {
  InputContext,
  FieldResolution,
  OutputField,
  PayloadDefinition,
  PayloadGenerator,
  Result,
  TypeCoercion,
  ValidationError,
  LogEntry,
} from "./types.js";

/**
 * Business Ruleset Catalog helpers (FR‑3 / AC‑5 / AC‑8 extensibility).
 * Allows callers to look up business rulesets and configure derived functions
 * without modifying the engine core.
 */

/* Import the catalog functions */
import {
  getBusinessRulesets,
  resolveBusinessRuleset,
  buildDerivedFunctionMap,
  derive,
  registerBusinessRuleset,
} from "./ruleset.js";

/* Export from ruleset module */
export {
  getBusinessRulesets,
  resolveBusinessRuleset,
  buildDerivedFunctionMap,
  derive,
  registerBusinessRuleset,
} from "./ruleset.js";

/**
 * Apply ruleset enum mappings to a single field.
 * If the field doesn't have an enumMap but the ruleset contains one for this field,
 * applies the mapping to the field's transform configuration.
 *
 * @param field - The output field to update.
 * @param ruleset - The business ruleset to source mappings from.
 * @returns The updated field with applied enum mappings.
 */
export function applyRulesetEnumMappings(
  field: ImportOmit<import("./types.js").OutputField, "transform"> & { transform?: import("./types.js").OutputField["transform"] },
  ruleset?: import("./types.js").BusinessRuleset,
): import("./types.js").OutputField {
  // If the field already has an enumMap, use it
  if (field.transform?.enumMap) {
    return field;
  }

  // If no ruleset provided, return unchanged
  if (!ruleset) {
    return field;
  }

  // Look for a rule in the ruleset that matches this field
  const rule = ruleset.rules.find(
    (r) => r.appliesTo?.includes(field.name) || r.name === field.name
  );

  // If the rule provides enumMappings and the field is a string, apply them
  if (rule && rule.typeOrDerived === 'string' && rule.enumMappings) {
    return {
      ...field,
      transform: {
        ...field.transform,
        enumMap: rule.enumMappings,
      },
    };
  }

  return field;
}

/**
 * Get enum mappings for a specific field from a business ruleset.
 *
 * @param fieldName - The field name to look up mappings for.
 * @param ruleset - The business ruleset to search.
 * @returns The enum mappings if found, undefined otherwise.
 */
export function getRulesetEnumMappings(
  fieldName: string,
  ruleset?: import("./types.js").BusinessRuleset,
): Record<string, string> | undefined {
  if (!ruleset) {
    return undefined;
  }

  const rule = ruleset.rules.find(
    (r) => r.appliesTo?.includes(fieldName) || r.name === fieldName
  );

  if (rule && rule.enumMappings && rule.typeOrDerived === 'string') {
    return rule.enumMappings;
  }

  return undefined;
}

/**
 * Apply all enum mappings from a ruleset to a payload definition.
 * This creates a new definition with enum mappings applied to matching fields.
 *
 * @param definition - The payload definition to update.
 * @param rulesetName - Optional name of the ruleset; if omitted, will resolve from the catalog.
 * @returns The updated payload definition with applied enum mappings.
 */
export function applyRulesetEnumMappingsToDefinition(
  definition: import("./types.js").PayloadDefinition,
  rulesetName?: string,
): import("./types.js").PayloadDefinition {
  const ruleset =
    rulesetName ? resolveBusinessRuleset(rulesetName) : undefined;

  return {
    ...definition,
    fields: definition.fields.map((field) =>
      applyRulesetEnumMappings(field, ruleset)
    ),
  };
}

/* Type exports from types */
export type {
  BusinessRuleset,
  BusinessRule,
  RulesetCatalog,
  DerivedFunction,
} from "./types.js";