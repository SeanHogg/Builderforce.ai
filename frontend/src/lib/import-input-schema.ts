/**
 * Schema and validation for record import inputs (guided + bulk).
 *
 * Defines data kinds and business rules enforced across both modes.
 */

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const DEFAULT_BEGINNER_STEP: GuidedStep = 'step-info';

/**
 * Canonical field directives for record import: identifier + checker API.
 */
export interface FieldDirective {
  /** Canonical field key used in templates and exports (must match backend). */
  key: string;
  /** Required for valid records. */
  required: boolean;
  /** Executive pattern hint (not enforced, surfaced only for UX). */
  examplePattern?: string | null;
}

/**
 * A field's LABEL and TOOLTIP live in the message catalogs, not here.
 *
 * They used to be English strings on the directive, which a form rendered
 * directly — so the guided wizard's review step and the bulk mapping dropdown
 * said "Reference ID" in French while every other string on the page was
 * translated. These derive the `import.*` key instead, and the two components
 * render them through their own translator.
 */
export const fieldLabelKey = (key: string): string => `field${key.charAt(0).toUpperCase()}${key.slice(1)}`;

/**
 * Base fields shared across all record types.
 * Extend this per use case and export override availableFields.
 */
export const BASE_FIELDS: Record<string, FieldDirective> = {
  name: { key: 'name', required: true, examplePattern: 'example-name' },
  description: { key: 'description', required: false, examplePattern: null },
  referenceId: { key: 'referenceId', required: false, examplePattern: 'GHI-2024-001' },
  enabled: { key: 'enabled', required: false, examplePattern: null },
  priority: { key: 'priority', required: false, examplePattern: 'High' },
  notes: { key: 'notes', required: false, examplePattern: 'Enter additional details' },
};

/** Supported record kinds and their available fields. */
export interface RecordKindInfo {
  kind: string;
  /** All fields for this kind (includes base fields + kind-specific). */
  availableFields: Record<string, FieldDirective>;
  /** Default sort field (null = server default). */
  defaultSortField?: string | null;
}

/** Global list of supported record kinds. */
export const RECORD_KINDS: Record<string, RecordKindInfo> = {
  manual: {
    kind: 'manual',
    availableFields: { ...BASE_FIELDS },
    defaultSortField: 'createdAt',
  },
  /* Add custom kinds here; extend to drive guided wizards step-by-step. */
};

/**
 * Record object with canonical keys; additional kind-specific props omitted for generic use.
 */
export interface BaseRecord {
  name: string;
  description?: string | null;
  referenceId?: string | null;
  enabled?: boolean | null;
  priority?: string | null;
  notes?: string | null;
  createdAt?: string | null; // server-assigned ISO
  updatedAt?: string | null; // server-assigned ISO
}

/**
 * Blended, validated record from guided or bulk mode.
 */
export type ValidatedRecord = BaseRecord & {
  rowNumber?: number; // for bulk debugging
};

/**
 * Input state for guided mode: step-driven form with per-step field sets.
 */
export type GuidedStep = 'step-info' | 'step-fields' | 'step-review' | 'step-success';

/**
 * Row-level validation result in bulk dry-run.
 */
export interface RowError {
  rowNumber: number;
  column: string;
  reason: string;
}

/**
 * Dry-run result (field-level pass/fail counts + row-level errors list).
 */
export type DryRunResult = {
  totalRows: number;
  validRowsCount: number;
  erroredRowsCount: number;
  errors: RowError[];
  summaryLines: string[];
};

/**
 * Convert field directive to React `id` attribute per accessibility guidelines.
 */
function fieldId(key: string): string {
  return `input-${key}`;
}

/**
 * Determine if a field must be shown in Guided Mode steps.
 * This implements FR-2.2 (only relevant fields visible per step).
 * Customize per use case by overriding this function.
 */
function fieldIsStepVisible(key: string, kind: string, step: GuidedStep): boolean {
  // Step 0: overview.
  if (step === 'step-info') return false;

  // Step 1: all base + optional fields shown incrementally (per FR-2.2).
  // Override this threshold for custom record types.
  const baseKeys = new Set(Object.keys(BASE_FIELDS));
  if (baseKeys.has(key)) return true;

  // Extend per kind below.
  const kindFields = RECORD_KINDS?.[kind]?.availableFields;
  if (!kindFields) return false;
  return true; // all kind-specific fields visible in step-fields (customizable).
}

/**
 * With the current schema, the guided flow does not expose a separate fields page yet.
 * Export an override point for frameworks requiring named steps.
 */
export function defineGuidedSteps(recordKind: string): GuidedStep[] {
  return ['step-info', 'step-fields', 'step-review', 'step-success'];
}
