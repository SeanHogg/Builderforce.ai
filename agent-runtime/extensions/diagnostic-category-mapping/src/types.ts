/**
 * Canonical Diagnostic Question Categories as defined in PRD #313.
 */
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
  UNKNOWN = "unknown",
}

export const DIAGNOSTIC_CATEGORIES: Record<
  DiagnosticCategory,
  { name: string; diagnosticQuestion: string }
> = {
  [DiagnosticCategory.UNKNOWN]: {
    name: "Unknown",
    diagnosticQuestion: "Field does not match any category rule.",
  },
  // Keep the following to preserve human-friendly keys for FR-1.
  [DiagnosticCategory.QUALITY_BUGS]: {
    name: "Quality & Bugs",
    diagnosticQuestion:
      "How many defects exist, and what is their severity distribution?",
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
    diagnosticQuestion:
      "Are team processes (reviews, retros, planning) functioning well?",
  },
  [DiagnosticCategory.DEPENDENCIES]: {
    name: "Dependency Health",
    diagnosticQuestion: "Are third-party and internal dependencies up to date and low risk?",
  },
} as const;

export type MaybeDiagnosticCategory = DiagnosticCategory | "unknown";

export const DIAGNOSTIC_CATEGORIES_MAP: Record<
  MaybeDiagnosticCategory,
  { name: string; diagnosticQuestion: string }
> = {
  [DiagnosticCategory.QUALITY_BUGS]: {
    name: "Quality & Bugs",
    diagnosticQuestion:
      "How many defects exist, and what is their severity distribution?",
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
    diagnosticQuestion:
      "Are team processes (reviews, retros, planning) functioning well?",
  },
  [DiagnosticCategory.DEPENDENCIES]: {
    name: "Dependency Health",
    diagnosticQuestion: "Are third-party and internal dependencies up to date and low risk?",
  },
};

/**
 * Mapping rule: one source field matches exactly one category.
 */
export interface MappingRule {
  sourceFieldKey: string;
  sourceSystem?: string;
  category: DiagnosticCategory;
}

/**
 * MappingRuleRegistry loads, validates, and provides access to the rule set.
 */
export interface MappingRuleRegistry {
  /**
   * All rules in the registry.
   */
  rules(): MappingRule[];

  /**
   * Find a mapping rule for a given field key and optional source system.
   * Returns undefined if no exact match found.
   */
  find(key: string, system?: string): MappingRule | undefined;

  /**
   * Check if a rule conflicts with any existing rule for the same field.
   */
  hasConflict(key: string, system?: string): boolean;
}

/**
 * Quarantine log entry for unmapped fields.
 */
export interface UnmappedFieldEntry {
  timestamp: Date;
  fieldKey: string;
  sourceSystem?: string;
  fieldName?: string; // Optional human-readable name if available
  currentValue?: unknown;
  entryId: string;
}

/**
 * Mapping annotations added to an ingested record.
 */
export interface MappingAnnotations {
  diagnosticCategory: DiagnosticCategory | "unknown";
}

/**
 * Metrics exposed by the mapping layer.
 */
export interface MappingMetrics {
  /**
   * Total number of unmapped fields detected across all processed records.
   */
  unmappedFieldsTotal: number;

  /**
   * Count of fields mapped to each category (only for known categories).
   */
  categoryCounts: Record<
    DiagnosticCategory,
    number
  >;
}

/**
 * ValidationError raised when the registry is invalid.
 */
export interface ValidationError {
  type: "duplicate_key" | "unknown_category" | "circular_reference";
  message: string;
  details?: unknown;
}