/**
 * Schema and validation for record import inputs (guided + bulk).
 *
 * Defines data kinds and business rules enforced across both modes.
 */

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const DEFAULT_BEGINNER_STEP = 'step-info';

/**
 * Canonical field directives for record import: identifier + checker API.
 */
export interface FieldDirective {
  /** Canonical field key used in templates and exports (must match backend). */
  key: string;
  /** Human-readable label in UI forms. */
  label: string;
  /** Required for valid records. */
  required: boolean;
  /** Help text or tooltip message (null = no tooltip). */
  tooltip?: string | null;
  /** Executive pattern hint (not enforced, surfaced only for UX). */
  examplePattern?: string | null;
}

/**
 * Base fields shared across all record types.
 * Extend this per use case and export override availableFields.
 */
export const BASE_FIELDS: Record<string, FieldDirective> = {
  name: {
    key: 'name',
    label: 'Name',
    required: true,
    tooltip: 'Unique, human-readable name (no special characters).',
    examplePattern: 'example-name',
  },
  description: {
    key: 'description',
    label: 'Description',
    required: false,
    tooltip:
      'Brief free-form description of the record (optional). Use plain text.',
    examplePattern: null,
  },
  referenceId: {
    key: 'referenceId',
    label: 'Reference ID',
    required: false,
    tooltip: 'External system reference (optional). Must be unique.',
    examplePattern: 'GHI-2024-001',
  },
  enabled: {
    key: 'enabled',
    label: 'Enabled',
    required: false,
    tooltip: 'Toggle to enable/disable this record.',
    examplePattern: null,
  },
  priority: {
    key: 'priority',
    label: 'Priority',
    required: false,
    tooltip: 'Low, Medium, or High priority (null = unused).',
    examplePattern: 'High',
  },
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
    availableFields: {
      ...BASE_FIELDS,
      notes: {
        key: 'notes',
        label: 'Notes',
        required: false,
        tooltip: 'Free-form notes (optional).',
        examplePattern: 'Enter additional details',
      },
    },
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
 * Guided mode form state: current step, filled values, and a runtime-error per-field ID.
 */
export interface GuidedFormState {
  step: GuidedStep;
  record: Partial<ValidatedRecord>;
  error: Record<string, string | null>; // ID → error message
  touched: Set<string>; // IDs that were focused
  summary?: string | null; // validation summary from the API (on dry-run in bulk)
}

/**
 * Bulk mode state: uploaded file, detected columns, mapped names, run condition.
 */
export interface BulkState {
  fileType: 'csv' | 'xlsx' | 'json' | null;
  file: File | null;
  rowsCount: number;
  columns: string[]; // detected headers
  mappings: Record<string, string | null>; // header → canonical key
  dryRunResult: DryRunResult | null;
  uploading: boolean;
  importStatus: 'idle' | 'uploading' | 'mapping' | 'dryrun' | 'importing' | 'done';
  totalRows: number;
  validRowsCount: number;
  erroredRowsCount: number;
  importSummary?: string | null; // API summary (success/fail counts)
  errorMessage?: string | null;
}

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
 * Determine if a record is fully valid (all required fields present and non-empty if required).
 */
export function isRecordValid(record: Partial<BaseRecord>, overrideRequireds?: Record<string, boolean>): boolean {
  for (const kind in RECORD_KINDS) {
    const fields = RECORD_KINDS[kind].availableFields;
    for (const key in fields) {
      const field = fields[key];
      const required = overrideRequireds?.[key] ?? field.required;
      if (required || record[key]) {
        const value = record[key];
        if (!value || String(value).trim() === '') {
          return false;
        }
      }
    }
  }
  return true;
}

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