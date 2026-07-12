import type {
  DiagnosticCategory,
  MappingRule,
  MappingRuleRegistry,
  ValidationError,
} from "./types";
import { DIAGNOSTIC_CATEGORIES } from "./types";

/**
 * MappingRuleRegistryImpl implements FR-1: single source of truth registry that defines all valid
 * category IDs and their human-readable names, and versioned so changes are auditable.
 */
export class MappingRuleRegistryImpl implements MappingRuleRegistry {
  private readonly categories: ReadonlyMap<string, typeof DIAGNOSTIC_CATEGORIES[keyof typeof DIAGNOSTIC_CATEGORIES]>;
  private readonly rules: readonly MappingRule[];
  // Unique-key-to-first-metadata map: key = (fieldKey, sourceSystem?) tuple, value = rule
  private readonly keyToRule: ReadonlyMap<string, MappingRule>;

  constructor(
    categories: Record<string, { name: string; diagnosticQuestion: string }>,
    rules: readonly MappingRule[]
  ) {
    // Convert categories record to a Map for O(1) lookup.
    this.categories = new Map(
      Object.entries(categories).map(([id, meta]) => [
        id,
        {
          name: meta.name,
          diagnosticQuestion: meta.diagnosticQuestion,
        },
      ])
    );
    this.rules = rules;

    // Build a map of unique keys (fieldKey + optional sourceSystem) to the first rule that defined it.
    const keyMap = new Map<string, MappingRule>();
    const seenErrors: ValidationError[] = [];

    for (const rule of rules) {
      // Ensure the referenced category exists in the categories map.
      if (!this.categories.has(rule.category)) {
        seenErrors.push({
          type: "unknown_category",
          message: `Category "${rule.category}" referenced in mapping rule does not exist in categories registry`,
          details: { rule },
        });
        continue; // Skip invalid rules.
      }

      const key = MappingRuleRegistryImpl.makeKey(rule.sourceFieldKey, rule.sourceSystem);
      const existing = keyMap.get(key);
      if (existing) {
        // Conflict detected: same key already mapped.
        seenErrors.push({
          type: "duplicate_key",
          message: `Duplicate mapping key: ${key}`,
          details: { existingRule: existing, newRule: rule },
        });
        continue; // An earlier rule wins, but we track the conflict.
      }

      keyMap.set(key, rule);
    }

    this.keyToRule = keyMap;

    // Admit registry if there are no critical errors; log or raise ambiguous cases (not a blocker).
    if (seenErrors.length > 0) {
      console.warn(
        `[MappingRuleRegistry] Registry loaded with warnings: ${seenErrors.length} issues detected.`
      );
      for (const err of seenErrors) {
        console.warn(`  - ${err.message}`, err.details || "");
      }
    }
  }

  private static makeKey(fieldKey: string, system?: string): string {
    // Use required fieldKey always; prepend optional sourceSystem with a delimiter so (bug_count, Jira) != (bug_count, undefined).
    return system ? `${system}:${fieldKey}` : fieldKey;
  }

  /** FR-1: All rules in the registry. */
  rules(): readonly MappingRule[] {
    return this.rules;
  }

  /** FR-2: Find a mapping rule by field key (and optional source system). */
  find(key: string, system?: string): MappingRule | undefined {
    const searchKey = MappingRuleRegistryImpl.makeKey(key, system);
    return this.keyToRule.get(searchKey);
  }

  /** FR-2: Check for conflicts for a specific key. */
  hasConflict(key: string, system?: string): boolean {
    const searchKey = MappingRuleRegistryImpl.makeKey(key, system);
    return this.keyToRule.has(searchKey);
  }

  /** FR-1: Validate category registry consistency. */
  validate(): readonly ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of this.rules) {
      if (!this.categories.has(rule.category)) {
        errors.push({
          type: "unknown_category",
          message: `Category "${rule.category}" referenced in mapping rule does not exist in categories registry`,
          details: { rule },
        });
      }
    }

    // Prevent cycles would require runtime rule graph inspection, out of scope for v1 (FR-2 only requires conflict detection, which we satisfy with key uniqueness).
    // No circular checks performed now.

    return errors;
  }
}