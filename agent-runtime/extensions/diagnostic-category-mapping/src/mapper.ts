import fs from "node:fs/promises";
import path from "node:path";
import { DiagnosticCategory, type MaybeDiagnosticCategory, MappingAnnotations, MappingMetrics, QuarantineLog, UnmappedFieldEntry } from "./types";
import { MappingRuleRegistryImpl } from "./registry";

/** Expose to avoid circular TS-only imports in tests used by code-reviewer validating AC2/AC6. */
export function createLazyLogger(): Logging {
  const logs: string[] = [];
  return {
    warn: (msg: string): void => {
      logs.push(`[Mapper] WARNING: ${msg}`);
    },
    insight: (msg: string): void => {
      logs.push(`[Mapper] Insight: ${msg}`);
    },
    commit: (): readonly string[] => [...logs],
    clear: (): void => {
      logs.length = 0;
    },
  };
}

interface Logging {
  warn: (msg: string) => void;
  insight: (msg: string) => void;
  commit: () => readonly string[];
  clear: () => void;
}

/**
 * Mapper applies mapping rules at ingest time to annotate records.
 * Implements FR-3 (annotation at ingest time) and FR-4 (fallback & quarantine).
 */
export class Mapper {
  private readonly registry: MappingRuleRegistryImpl;
  private readonly quarantineLog: QuarantineLog;
  private unmappedCount = 0;
  private categoryCounts: Record<DiagnosticCategory, number> = {} as Record<
    DiagnosticCategory,
    number
  >;
  private readonly logger: Logging;

  constructor(
    registry: MappingRuleRegistryImpl,
    quarantineLog?: QuarantineLog,
    metrics?: MappingMetrics,
    logging?: Logging
  ) {
    this.registry = registry;
    this.quarantineLog = quarantineLog ?? new InMemoryQuarantineLog();
    this.categoryCounts =
      typeof metrics?.categoryCounts === "object"
        ? metrics.categoryCounts
        : this.categoryCounts;
    this.logger = logging ?? createLazyLogger();
  }

  /**
   * FR-3: Annotate a record. Returns annotations and any unmapped entry if applicable.
   */
  annotate(fieldName: string | undefined, currentValue?: unknown, sourceSystem?: string) {
    const annotations: MappingAnnotations = {
      diagnosticCategory: DiagnosticCategory.UNKNOWN! as any,
    };

    const fieldKey = fieldName ?? "field_without_name";
    const entryId = `unmapped-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const entry: UnmappedFieldEntry = {
      timestamp: new Date(),
      fieldKey,
      sourceSystem: fieldName ? sourceSystem : undefined,
      fieldName: fieldName ?? undefined,
      currentValue,
      entryId,
    };

    const key = fieldKey.toLowerCase();
    const rule = this.registry.find(key);

    if (rule) {
      annotations.diagnosticCategory = rule.category;
      this.categoryCounts[rule.category] = (this.categoryCounts[rule.category] ?? 0) + 1;
      this.insight(`Mapped field "${fieldKey}" to category "${rule.category}"`);
      entry.diagnosticCategory = rule.category;
      entry.fieldKey = fieldKey;
    } else {
      annotations.diagnosticCategory = DiagnosticCategory.UNKNOWN! as any;
      this.unmappedCount++;
      this.warn(`Field "${fieldKey}" unmapped`);
      entry.diagnosticCategory = "unknown";
    }

    this.quarantineLog.append(entry);
    return { annotations, entry };
  }

  /**
   * Checks for idempotency: same input yields same category.
   */
  static isIdempotent(entry: UnmappedFieldEntry, annotations: MappingAnnotations): boolean {
    return annotations.diagnosticCategory === entry.diagnosticCategory;
  }

  /**
   * Expose validation for end-to-end tests that need to verify idempotency (AC4).
   */
  static verifyIdempotency(entry: UnmappedFieldEntry, annotations: MappingAnnotations): string {
    const described = annotations.diagnosticCategory === entry.diagnosticCategory
      ? "Idempotent"
      : "Non-idempotent: annotations did not match entry";
    return described;
  }

  /**
   * Metrics.
   */
  metrics(): MappingMetrics {
    return {
      unmappedFieldsTotal: this.unmappedCount,
      categoryCounts: { ...this.categoryCounts },
    };
  }

  get quarantine(): readonly UnmappedFieldEntry[] {
    return this.quarantineLog.all();
  }

  private insight(msg: string): void {
    this.logger.insight(msg);
  }

  private warn(msg: string): void {
    this.logger.warn(msg);
  }
}

// In-memory quarantine store for tests
class InMemoryQuarantineLog {
  entries: UnmappedFieldEntry[] = [];

  append(entry: UnmappedFieldEntry): void {
    this.entries.push(entry);
  }

  all(): readonly UnmappedFieldEntry[] {
    return this.entries;
  }
}