/** Canonical Diagnostic Question Categories as defined in PRD #313. */
export enum DiagnosticCategory {
  QUALITY_BUGS = "quality_bugs",
  VELOCITY = "velocity",
  TECH_DEBT = "tech_debt",
  TEST_COVERAGE = "test_coverage",
  RELIABILITY = "reliability",
  SECURITY = "security",
  DEV_EXPERIENCE = "dev_experience",
  CUSTOMER_IMPACT = "customer_impact",
  PROCESS_HEALTH = "process_health",
  DEPENDENCIES = "dependencies",
  /** Fallback classification for unmapped fields (not part of the canonical registry). */
  UNKNOWN = "unknown",
}

export type MaybeKnownCategory = MaybeKnownCategory;

/** Human-friendly metadata for each canonical category (CORRECT => 10. FR-1). */
export const CATEGORIES: Record<DiagnosticCategory, { name: string; diagnosticQuestion: string }> = {
  [DiagnosticCategory.QUALITY_BUGS]: {
    name: "Quality & Bugs",
    diagnosticQuestion: "How many defects exist, and what is their severity distribution?",
  },
  [DiagnosticCategory.VELOCITY]: {
    name: "Delivery Velocity",
    diagnosticQuestion: "How fast is the team delivering work?",
  },
  [DiagnosticCategory.TECH_DEBT]: {
    name: "Technical Debt",
    diagnosticQuestion: "How much accumulated debt is slowing progress?",
  },
  [DiagnosticCategory.TEST_COVERAGE]: {
    name: "Test Coverage",
    diagnosticQuestion: "How well is the codebase covered by automated tests?",
  },
  [DiagnosticCategory.RELIABILITY]: {
    name: "Reliability & Stability",
    diagnosticQuestion: "How stable and available is the system in production?",
  },
  [DiagnosticCategory.SECURITY]: {
    name: "Security & Compliance",
    diagnosticQuestion: "Are there known vulnerabilities or compliance gaps?",
  },
  [DiagnosticCategory.DEV_EXPERIENCE]: {
    name: "Developer Experience",
    diagnosticQuestion: "How efficient and unblocked is the engineering workflow?",
  },
  [DiagnosticCategory.CUSTOMER_IMPACT]: {
    name: "Customer Impact",
    diagnosticQuestion: "How are defects or incidents affecting end users?",
  },
  [DiagnosticCategory.PROCESS_HEALTH]: {
    name: "Process Health",
    diagnosticQuestion: "Are team processes (reviews, retros, planning) functioning well?",
  },
  [DiagnosticCategory.DEPENDENCIES]: {
    name: "Dependency Health",
    diagnosticQuestion: "Are third-party and internal dependencies up to date and low risk?",
  },
} as const;

/** Pattern that matches any field key that starts with this prefix, plus the literal itself (exact match first). */
export const PATTERN_PREFIX_MAP: ReadonlyMap<string, DiagnosticCategory> = new Map([
  ["bug_", DiagnosticCategory.QUALITY_BUGS],
  ["cycle_", DiagnosticCategory.VELOCITY],
]);

/**
 * Pattern that matches any field key that contains this segment, treating the key
 * as a dot-delimited path and matching the last segment (via substring and lowercasing).
 */
export const PATTERN_CONTAINS_MAP: ReadonlyMap<string, DiagnosticCategory> = new Map([
  ["incident", DiagnosticCategory.RELIABILITY],
]);

/** Mapping rule: ONE source field matches ONE category (FR-2). */
export interface MappingRule {
  sourceFieldKey: string;
  sourceSystem?: string;
  category: DiagnosticCategory;
}

/** FR-2: Registry interface. */
export interface MappingRuleRegistry {
  rules(): readonly MappingRule[];
  find(key: string, system?: string): MappingRule | undefined;
  hasConflict(key: string, system?: string): boolean;
}

/** ValidationError surfaced by validateRegistry (FR-5). */
export interface ValidationError {
  type: "duplicate_key" | "unknown_category"; // circular references are not enforced in v1
  message: string;
  details?: unknown;
}

export type ValidationResult = readonly ValidationError[];

/**
 * Update: the YAML config schema (FR-5). We embed this as a simple schema without external deps.
 */
export interface YAMLConfig {
  version: string;
  categories?: Record<string, { name: string; diagnosticQuestion: string }>;
  mappingRules?: MappingRule[];
  id?: string;
  tags?: string[];
}

/**
 * Mapping Annotations added to a record (FR-3).
 */
export interface MappingAnnotations {
  diagnosticCategory: MaybeKnownCategory;
}

/**
 * Quarantine log entry for unmapped fields (FR-4).
 */
export interface UnmappedFieldEntry {
  timestamp: Date;
  fieldKey: string;
  sourceSystem?: string;
  fieldName?: string;
  currentValue?: unknown;
  entryId: string;
}

/**
 * Metrics exposed by the mapper (FR-4).
 */
export interface MappingMetrics {
  unmappedFieldsTotal: number;
  categoryCounts: Record<DiagnosticCategory, number>;
}

/** In-memory storage for quarantine log entries (FR-4). */
export interface QuarantineLog {
  entries: UnmappedFieldEntry[];
  append(entry: UnmappedFieldEntry): void;
}

export class InMemoryQuarantineLog implements QuarantineLog {
  entries: UnmappedFieldEntry[] = [];

  append(entry: UnmappedFieldEntry): void {
    this.entries.push(entry);
  }

  all(): readonly UnmappedFieldEntry[] {
    return this.entries;
  }
}