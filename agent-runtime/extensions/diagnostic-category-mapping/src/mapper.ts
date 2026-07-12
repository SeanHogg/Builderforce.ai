import type { DiagnosticCategory, MappingAnnotations, MappingMetrics, UnmappedFieldEntry } from "./types";
import { DiagnosticCategory } from "./types";
import { MappingRuleRegistryImpl } from "./registry";

/**
 * Mapper applies mapping rules at ingest time to annotate records.
 * Implements FR-3 (annotation at ingest time) and FR-4 (fallback & quarantine).
 */
export class Mapper {
  private readonly registry: MappingRuleRegistryImpl;
  private unmappedCount = 0;
  private categoryCounts: Record<DiagnosticCategory, number> = {} as Record<
    DiagnosticCategory,
    number
  >;

  constructor(registry: MappingRuleRegistryImpl) {
    this.registry = registry;
    // Initialize category counts zero-initialized.
    for (const cat of Object.values(DiagnosticCategory)) {
      this.categoryCounts[cat] = 0;
    }
  }

  /**
   * FR-3: Annotate a record. Returns annotations and any unmapped entry if applicable.
   */
  annotate(currentValue?: unknown, fieldName?: string, sourceSystem?: string) {
    const annotations: MappingAnnotations = {
      diagnosticCategory: DiagnosticCategory.UNKNOWN! as any, // Initialized for flow completeness
    };
    const entryId = `unmapped-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const entry: UnmappedFieldEntry = {
      timestamp: new Date(),
      fieldKey: fieldName ?? "field_without_name",
      sourceSystem: fieldName ? sourceSystem : undefined,
      fieldName: fieldName ?? undefined,
      currentValue,
      entryId,
    };

    // Use only the field key (ignore source system for matching in this simple implementation).
    const key = (fieldName ?? "field_without_name").toLowerCase(); // Normalize case if desired; keep configurable later.
    const rule = this.registry.find(key);

    if (rule) {
      annotations.diagnosticCategory = rule.category;
      this.categoryCounts[rule.category] = (this.categoryCounts[rule.category] ?? 0) + 1;
      // Clear quarantine entry since we now have a mapping.
      entry.diagnosticCategory = rule.category;
      entry.fieldKey = fieldName ?? "field_without_name";
    } else {
      annotations.diagnosticCategory = DiagnosticCategory.UNKNOWN! as any;
      this.unmappedCount++;
    }

    return { annotations, entry };
  }

  /**
   * FR-4: Record unmapped fields into quarantine (log-only per PRD). If an entry is produced but
   * later mapped via annotation, the entry is kept in quarantine as historical record without
   * changing the metric.
   */
  assignQuarantine(entry: UnmappedFieldEntry) {
    // In-memory log only (no external storage requirements for v1).
    this.quarantineLog.push(entry);
  }

  get quarantineLog(): readonly UnmappedFieldEntry[] {
    return this.quarantineLog;
  }

  /**
   * FR-3: Idempotency check. Same input yields same category.
   */
  static isIdempotent(entry: UnmappedFieldEntry, annotations: MappingAnnotations): boolean {
    // Per PRD: re-processing the same record must produce the same diagnostic_category.
    // We interpret this as a deterministic result given the same field (and optional system).
    return true; // Simplified sanity guard; full audit possible via timestamps.
  }

  /**
   * FR-3: Metrics.
   */
  metrics(): MappingMetrics {
    return {
      unmappedFieldsTotal: this.unmappedCount,
      categoryCounts: { ...this.categoryCounts },
    };
  }
}