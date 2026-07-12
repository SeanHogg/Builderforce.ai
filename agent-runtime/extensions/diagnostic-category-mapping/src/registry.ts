import fs from "node:fs/promises";
import type { MappingRule, MappingRuleRegistry, ValidationError } from "./types";
import { DiagnosticCategory, type YAMLConfig } from "./types";
import { InMemoryQuarantineLog, MappingMetrics } from "./types";
import { Mapper } from "./mapper";

/**
 * MappingRuleRegistryImpl implements FR-1: single source of truth registry that defines all valid
 * category IDs and their human-readable names, versioned so changes are auditable.
 * Supports load-from-YAML and simple key-level validation (FR-2/FR-5).
 */
export class MappingRuleRegistryImpl implements MappingRuleRegistry {
  private readonly categories: ReadonlyMap<
    DiagnosticCategory,
    { name: string; diagnosticQuestion: string }
  >;
  private readonly rules: readonly MappingRule[];
  // Unique key => first rule that defined it.
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
      throw new Error("Registry load failed"); // TODO: distinguish errors.go from partial load?
    }
  }

  private makeKey(fieldKey: string, system?: string): string {
    return system ? `${system}:${fieldKey}` : fieldKey;
  }

  /** FR-1: All rules in the registry. */
  rules(): readonly MappingRule[] {
    return this.rules;
  }

  /** FR-2: Find rule by key and optional source system. */
  find(key: string, system?: string): MappingRule | undefined {
    const searchKey = this.makeKey(key, system);
    return this.keyToRule.get(searchKey);
  }

  /** FR-2: Check for conflicts for a specific key. */
  hasConflict(key: string, system?: string): boolean {
    const searchKey = this.makeKey(key, system);
    return this.keyToRule.has(searchKey);
  }

  static async readYamlFile(yamlPath: string): Promise<YAMLConfig> {
    const content = await fs.readFile(yamlPath, "utf-8");
    return YAMLConfigSchema.parse(JSON.parse(content));
  }

  /** FR-5: Validate using internal schema. */
  static validateRegistry(config: YAMLConfig): ReadonlyArray<ValidationError> {
    const errors: ValidationError[] = [];
    const categorySet = new Set(DiagnosticCategory);
    const { categories, mappingRules } = config;

    // Validate categories.
    for (const [id, meta] of Object.entries(categories)) {
      if (!categorySet.has(id as any)) {
        errors.push({
          type: "unknown_category",
          message: `Category "${id}" is not in the canonical DiagnosticCategory enum`,
          details: { categoryId: id, meta },
        });
      }
    }

    // Validate rules: each rule must reference an existing category and must not duplicate key+sourceSystem.
    const keyToRule = new Map<string, MappingRule>();
    for (const rule of mappingRules) {
      if (!categorySet.has(rule.category)) {
        errors.push({
          type: "unknown_category",
          message: `Category "${rule.category}" does not exist in categories`,
          details: { rule },
        });
        continue;
      }

      const key = `${rule.sourceSystem}:${rule.sourceFieldKey}`;
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

    // Circular/discarding remains out-of-scope for v1 (FR-5 requires duplicate/unknown checks).
    return errors;
  }
}

function YAMLConfigSchema(data: unknown): YAMLConfig {
  if (typeof data !== "object" || !data) throw new TypeError("Config must be an object");
  const c = data as Record<string, unknown>;

  const version = typeof c.version === "string" ? c.version : "1.0.0";
  const categories = typeof c.categories === "object" ? c.categories : {};
  const mappingRules = Array.isArray(c.mappingRules) ? c.mappingRules : [];
  const id = typeof c.id === "string" ? c.id : undefined;
  const tags = Array.isArray(c.tags) ? c.tags : undefined;

  return {
    version,
    categories,
    mappingRules,
    id,
    tags,
  };
}

/** Public factory: build registry from YAML string content (FR-5). */
export async function buildRegistryFromYaml(yamlContent: string): Promise<MappingRuleRegistryImpl> {
  const config =
    typeof yamlContent === "string"
      ? YAMLConfigSchema.parse(JSON.parse(yamlContent))
      : (YAMLConfigSchema(yamlContent) as YAMLConfig);
  const errors = MappingRuleRegistryImpl.validateRegistry(config);
  if (errors.length > 0) {
    console.error("Registry validation errors:", errors);
    throw new Error(`Registry validation failed: ${errors.length} errors`);
  }
  return new MappingRuleRegistryImpl(config.categories, config.mappingRules);
}

/** Public factory: build mapper from YAML with quarantine log support (FR-3, FR-4). */
export async function buildMapperFromYaml(
  yamlContent: string,
  quarantineLog?: QuarantineLog,
  metrics?: MappingMetrics
): Promise<Mapper> {
  const registry = await buildRegistryFromYaml(yamlContent);
  return new Mapper(registry, quarantineLog ?? new InMemoryQuarantineLog(), metrics ?? {});
}

import type { QuarantineLog, MappingMetrics } from "./types";
import { Mapper } from "./mapper";

/** (Inlined import reordering; Mapper class ref is present in mapper.ts per previous writes.) */