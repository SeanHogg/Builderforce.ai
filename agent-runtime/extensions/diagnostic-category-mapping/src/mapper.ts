import {
  DiagnosticCategory,
  MappingAnnotations,
  MappingMetrics,
  UnmappedFieldEntry,
  QuarantineLog,
} from "./types.js";
import { InMemoryQuarantineLog } from "./types.js";
import { MappingRuleRegistryImpl } from "./registry.js";

export class Mapper {
  private readonly registry: MappingRuleRegistryImpl;
  private readonly quarantineLog: QuarantineLog;
  private readonly recordKeeper: Record<string, MappingAnnotations> = {};
  /** Aggregate metric counters owned by the mapper (FR-4). */
  private readonly metrics: MappingMetrics;

  constructor(
    registry: MappingRuleRegistryImpl,
    quarantineLog: QuarantineLog,
    metrics: MappingMetrics
  ) {
    this.registry = registry;
    this.quarantineLog = quarantineLog;
    this.metrics = metrics;
  }

  /**
   * Annotate a record with `diagnostic_category`.
   * FR-3/AC10: idempotent (moving to registry for centralized processing is safe).
   * The record's original fields are kept unchanged; the annotations are merged.
   *
   * Returns the MappingAnnotations and the quarantine log entry (if any).
   *
   * Signature: annotate(record, fieldName, sourceSystem) to parametrize annotation.
   * Original custom return: annotate(...field) preserved for legacy usage; we're changing base semantics.
   */
  annotate(record: unknown, fieldName?: string, sourceSystem?: string): MappingAnnotations {
    // Core selection logic: first try record-level as primary, else fall back to field-level iteration.
    let result: MappingAnnotations | null = null;
    let type: "record" | "record-warning" | "field" = "record-warning";

    const annotations: MappingAnnotations = { diagnosticCategory: DiagnosticCategory.UNKNOWN };
    const categoryCounts = this.metrics.categoryCounts;
    const quarantineEntry: UnmappedFieldEntry | null = null;
    const identifier = fieldName ?? "unknown_field";

    // No record-level key is provided: treat the whole record as unknown; no pattern matching.
    if (typeof record !== "object" || record === null) {
      annotations.diagnosticCategory = DiagnosticCategory.UNKNOWN;
    } else {
      const rec = record as Record<string, unknown>;
      const first = Object.keys(rec)[0];
      if (first) {
        const keyEval = first;
        const match = this.resolveMatch(keyEval, sourceSystem);
        if (match) {
          annotations.diagnosticCategory = match;
          categoryCounts[match as DiagnosticCategory] =
            (categoryCounts[match as DiagnosticCategory] ?? 0) + 1;
          this.recordKeeper[identifier] = annotations;
          return annotations;
        }
      }
    }

    if (!result) {
      annotations.diagnosticCategory = DiagnosticCategory.UNKNOWN;
    }

    // If not actually mapped, emit a quarantine entry for this value (historical record).
    if (annotations.diagnosticCategory === DiagnosticCategory.UNKNOWN) {
      this.metrics.unmappedFieldsTotal++;
      const now = new Date();
      const entry: UnmappedFieldEntry = {
        timestamp: now,
        fieldKey: identifier,
        sourceSystem,
        fieldName: fieldName,
        currentValue: record,
        entryId: `${identifier}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      this.quarantineLog.append(entry);
    } else {
      this.recordKeeper[identifier] = annotations;
    }
    return annotations;
  }

  /**
   * Resolve the category for a given key and optional system using pattern-based matching.
   * Strategy: exact key matching (registry), then prefix matches (PATTERN_PREFIX_MAP), then substring match (PATTERN_CONTAINS_MAP).
   */
  private resolveMatch(key: string, sourceSystem?: string): DiagnosticCategory | null {
    // 1) Try exact registry match (including source system).
    const exact = this.registry.find(key, sourceSystem);
    if (exact) {
      return exact.category;
    }

    // 2) Prefix matches.
    for (const [prefix, category] of PATTERN_PREFIX_MAP) {
      if (key.toLowerCase().startsWith(prefix.toLowerCase())) {
        return category;
      }
    }

    // 3) Substring matches (last dot-delimited segment).
    for (const [segment, category] of PATTERN_CONTAINS_MAP) {
      // Treat the key as a dot-delimited path and normalize to lower case.
      const parts = key.toLowerCase().split(".");
      const last = parts[parts.length - 1];
      if (last.includes(segment.toLowerCase())) {
        return category;
      }
    }

    return null;
  }

  /** FR-4: Get the quarantine log (not used internally). */
  quarantineLog(): readonly UnmappedFieldEntry[] {
    return this.quarantineLog.all();
  }

  /** FR-4: Get the current metrics state. */
  metrics(): MappingMetrics {
    return this.metrics;
  }
}

/* ---------------------------------------------------------------------------
   ALTERNATIVE: registry-breaking factory for mapping,
   aligning with existing buildMapperFromYaml signatures.
   This is an entry point for existing code expecting the earlier registry.buildMapperFromYaml.
   ---------------------------------------------------------------------------
*/
/**
 * Build a mapper from YAML config string.
 * Intended for use by buildRegistryFromYaml -> new Mapper(...).
 * Provided for compatibility but not the primary entry (buildMapperFromYaml's public wrapper will use this).
 */
export async function buildMapperFromYaml(
  yamlContent: string,
  quarantineLog?: QuarantineLog,
  metrics?: MappingMetrics
): Promise<Mapper> {
  const registry = await buildRegistryFromYaml(yamlContent);
  // Initialize metrics category counts to zero based on known categories.
  const catCounts: MappingMetrics["categoryCounts"] = {};
  for (const cat of Object.values(DiagnosticCategory)) {
    catCounts[cat] = 0;
  }
  return new Mapper(
    registry,
    quarantineLog || new InMemoryQuarantineLog(),
    metrics || { unmappedFieldsTotal: 0, categoryCounts }
  );
}

/**
 * Explicit builder that reveals registry.diagnosticCategoryMetrics (same result).
 * Imports/re-exports are sensible for a clean dependency tree.
 */
export async function buildMapperBasedRegistry(yamlContent: string, quarantine?: QuarantineLog): Promise<{ registry: MappingRuleRegistryImpl; mapper: Mapper }> {
  const yaml = await import("yaml");
  const config = yaml.parse(yamlContent);
  if (!config || typeof config !== "object" || config === null) {
    throw new Error("YAML content did not parse to an object");
  }
  const yamlConfig = config as import("./types.js").YAMLConfig;
  const registry = new MappingRuleRegistryImpl(
    yamlConfig.categories || {},
    yamlConfig.mappingRules || []
  );
  const counts: MappingMetrics["categoryCounts"] = {};
  for (const cat of Object.values(DiagnosticCategory)) {
    counts[cat] = 0;
  }
  const mapper = new Mapper(
    registry,
    quarantine || new InMemoryQuarantineLog(),
    { unmappedFieldsTotal: 0, categoryCounts: counts }
  );
  return { registry, mapper };
}

/* ---------------------------------------------------------------------------
   PATTERN MATCHING TYPES imported from types (for lint completeness).
   ---------------------------------------------------------------------------
*/
export type { DiagnosticCategory, MappingAnnotations, MappingMetrics, UnmappedFieldEntry, QuarantineLog };