import fs from "node:fs/promises";
import type {
  MappingRule,
  MappingRuleRegistry,
  ValidationError,
  YAMLConfig,
} from "./types.js";
import { DiagnosticCategory } from "./types.js";
import { InMemoryQuarantineLog, MappingMetrics } from "./types.js";
import { Mapper } from "./mapper.js";

/**
 * MappingRuleRegistryImpl implements FR-1: single source of truth registry that defines all valid
 * category IDs and their human-readable names, versioned so changes are auditable.
 * Supports load-from-YAML and flat key-level validation (FR-5). Keys include sourceSystem only if present.
 */
export class MappingRuleRegistryImpl implements MappingRuleRegistry {
  private readonly categories: ReadonlyMap<
    DiagnosticCategory,
    { name: string; diagnosticQuestion: string }
  >;
  private readonly rules: readonly MappingRule[];
  private readonly keyToRule: ReadonlyMap<string, MappingRule>;

  constructor(
    categories: Record<string, { name: string; diagnosticQuestion: string }>,
    rules: readonly MappingRule[]
  ) {
    this.categories = new Map(
      Object.entries(categories).map(([id, meta]) => [
        DiagnosticCategory[id.toUpperCase() as keyof typeof DiagnosticCategory],
        {
          name: meta.name,
          diagnosticQuestion: meta.diagnosticQuestion,
        },
      ])
    );
    this.rules = rules;
    this.keyToRule = new Map();

    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const category = DiagnosticCategory[rule.category.toUpperCase()];
      if (!category) {
        errors.push({
          type: "unknown_category",
          message: `Category "${rule.category}" is not a member of DiagnosticCategory`,
          details: { rule },
        });
        continue;
      }

      const key = this.makeKey(rule.sourceFieldKey, rule.sourceSystem);
      const existing = this.keyToRule.get(key);
      if (existing) {
        errors.push({
          type: "duplicate_key",
          message: `Duplicate mapping key: ${key}`,
          details: { existingRule: existing, newRule: rule },
        });
        continue;
      }

      this.keyToRule.set(key, rule);
    }

    if (errors.length > 0) {
      console.error("[MappingRuleRegistry] Registry load detected errors:", errors);
      throw new Error("Registry load failed");
    }
  }

  private makeKey(fieldKey: string, system?: string): string {
    return system ? `${system}:${fieldKey}` : fieldKey;
  }

  /** FR-1: All rules in the registry. */
  rules(): readonly MappingRule[] {
    return this.rules;
  }

  /** FR-2: Find rule by key (including system when present) and optional source system. */
  find(key: string, system?: string): MappingRule | undefined {
    // Normalize key: use key provided by caller as-is; don't recompose.
    return this.keyToRule.get(this.makeKey(key, system));
  }

  /** FR-2: Check for conflicts for a specific key. */
  hasConflict(key: string, system?: string): boolean {
    return this.keyToRule.has(this.makeKey(key, system));
  }

  /** Read config from YAML file using 'yaml' library (FR-5). */
  static async readYamlFile(yamlPath: string): Promise<YAMLConfig> {
    const content = await fs.readFile(yamlPath, "utf-8");
    const { parse } = await import("yaml");
    const parsed = parse(content);

    if (!parsed || typeof parsed !== "object" || parsed === null) {
      throw new Error(`Failed to parse YAML from ${yamlPath}: no object value`);
    }
    return parsed as YAMLConfig;
  }

  /** FR-5: Validate using YAMLConfig schema. */
  static validateRegistry(config: YAMLConfig): ValidationResult {
    const errors: ValidationError[] = [];
    const categorySet = new Set(DiagnosticCategory);
    const { categories, mappingRules } = config;

    // Validate categories (optional in YAML — must not specify invalid ones).
    if (categories) {
      for (const [id, meta] of Object.entries(categories)) {
        if (!categorySet.has(id as any)) {
          errors.push({
            type: "unknown_category",
            message: `Category "${id}" is not in the canonical DiagnosticCategory enum`,
            details: { categoryId: id, meta },
          });
        }
      }
    }

    // Validate rules: each rule must reference an existing category and must not duplicate key+sourceSystem.
    const keyToRule = new Map<string, MappingRule>();
    if (mappingRules) {
      for (const rule of mappingRules) {
        if (!categorySet.has(rule.category)) {
          errors.push({
            type: "unknown_category",
            message: `Category "${rule.category}" does not exist in categories`,
            details: { rule },
          });
          continue;
        }

        const key = this.makeKeyFromYaml(
          rule.sourceSystem,
          rule.sourceFieldKey
        );
        const existing = keyToRule.get(key);
        if (existing) {
          errors.push({
            type: "duplicate_key",
            message: `Duplicate rule key: ${key}`,
            details: { existingRule: existing, newRule: rule },
          });
          continue;
        }

        keyToRule.set(key, rule);
      }
    }
    return errors;
  }

  // We need a helper for YAML + TypeScript reproduce of makeKey from fields.
  private static makeKeyFromYaml(
    system: string | undefined,
    fieldKey: string
  ): string {
    return this.makeKey(fieldKey, system);
  }
}

/**
 * Public factory: build registry from YAML string content (FR-5). Throws on validation failures.
 */
export async function buildRegistryFromYaml(yamlContent: string): Promise<MappingRuleRegistryImpl> {
  const yaml = await import("yaml");
  const config = yaml.parse(yamlContent);

  if (!config || typeof config !== "object" || config === null) {
    throw new Error("YAML content did not parse to an object");
  }
  const yamlConfig = config as YAMLConfig;

  const errors = MappingRuleRegistryImpl.validateRegistry(yamlConfig);
  if (errors.length > 0) {
    console.error("Registry validation errors:", errors);
    throw new Error(`Registry validation failed: ${errors.length} errors`);
  }
  return new MappingRuleRegistryImpl(
    yamlConfig.categories || {},
    yamlConfig.mappingRules || []
  );
}

// NOTE: We do NOT expose registry.metrics(). The mapper now owns metrics; we call its metrics().
// Exported purely so other parts of the module are complete and correct across this rewrite.
export type { MappingMetrics, InMemoryQuarantineLog, QuarantineLog, UnmappedFieldEntry, MappingAnnotations };