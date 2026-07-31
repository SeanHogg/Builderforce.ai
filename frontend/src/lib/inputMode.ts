/**
 * Shared input-mode infrastructure: types, validation, paste/upload parsing,
 * mode persistence, and analytics (FR-1–FR-6).
 *
 * Both Guided and Express modes share the same validation schema and submit the
 * same payload shape to the same API endpoint (FR-4.1 / FR-4.2).
 */
import { trackActivity } from './activity/tracker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputMode = 'guided' | 'express';

/** One field definition in a form schema. */
export interface FieldDefinition {
  /** Stable key used as the field id and payload key. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Optional description / help text shown as a tooltip or inline hint. */
  help?: string;
  /** Field type, drives the rendered input. */
  type: 'text' | 'number' | 'email' | 'url' | 'textarea' | 'select' | 'date' | 'checkbox';
  /** Whether a value is required to submit. */
  required?: boolean;
  /** Minimum length (text/textarea) or min value (number). */
  min?: number;
  /** Maximum length (text/textarea) or max value (number). */
  max?: number;
  /** Regex pattern the value must match. */
  pattern?: string;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** For 'select' type: available choices. */
  options?: { value: string; label: string }[];
  /** Default value. */
  defaultValue?: string | number | boolean;
}

/** A logical group of fields that becomes one step in Guided mode. */
export interface FieldGroup {
  /** Stable key for this group. */
  key: string;
  /** Display name (shown in step indicator and as Express section heading). */
  title: string;
  /** Optional description shown at top of step / section. */
  description?: string;
  /** Fields in this group, rendered in listed order. */
  fields: FieldDefinition[];
}

/** The complete form schema, shared by both modes. */
export interface FormSchema {
  /** Logical groupings — each becomes a Guided step and an Express section. */
  groups: FieldGroup[];
  /** API endpoint to submit to (relative URL). */
  endpoint: string;
  /** Route to navigate to on success, or a callback label. */
  successRoute?: string;
}

/** A single validation error. */
export interface ValidationError {
  field: string;
  message: string;
}

/** Mode-switch event payload (no PII). */
export interface InputModeEvent {
  event: 'mode_select' | 'step_transition' | 'submit' | 'mode_switch' | 'paste_fill' | 'file_upload';
  mode: InputMode;
  /** Optional: step key for step_transition events. */
  step?: string;
  /** Optional: number of fields filled for submit events. */
  fieldCount?: number;
  /** Optional: ms elapsed since form was first rendered. */
  elapsedMs?: number;
}

// ---------------------------------------------------------------------------
// Mode persistence (FR-1)
// ---------------------------------------------------------------------------

const MODE_STORAGE_KEY = 'bf_input_mode';

export function getStoredInputMode(): InputMode | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(MODE_STORAGE_KEY);
  if (stored === 'guided' || stored === 'express') return stored;
  return null;
}

export function setStoredInputMode(mode: InputMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MODE_STORAGE_KEY, mode);
}

// ---------------------------------------------------------------------------
// Validation (FR-4.1)
// ---------------------------------------------------------------------------

/** Validate a single field value against its definition. */
export function validateField(def: FieldDefinition, value: unknown): ValidationError | null {
  const stringVal = value != null ? String(value).trim() : '';

  if (def.required && stringVal === '') {
    return { field: def.key, message: `${def.label} is required.` };
  }

  if (stringVal === '' && !def.required) return null;

  switch (def.type) {
    case 'email': {
      // Basic email shape check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringVal)) {
        return { field: def.key, message: `Enter a valid email for ${def.label}.` };
      }
      break;
    }
    case 'url': {
      try {
        new URL(stringVal);
      } catch {
        return { field: def.key, message: `Enter a valid URL for ${def.label}.` };
      }
      break;
    }
    case 'number': {
      if (isNaN(Number(stringVal))) {
        return { field: def.key, message: `${def.label} must be a number.` };
      }
      const n = Number(stringVal);
      if (def.min != null && n < def.min) {
        return { field: def.key, message: `${def.label} must be at least ${def.min}.` };
      }
      if (def.max != null && n > def.max) {
        return { field: def.key, message: `${def.label} must be at most ${def.max}.` };
      }
      break;
    }
    case 'text':
    case 'textarea': {
      if (def.min != null && stringVal.length < def.min) {
        return { field: def.key, message: `${def.label} must be at least ${def.min} characters.` };
      }
      if (def.max != null && stringVal.length > def.max) {
        return { field: def.key, message: `${def.label} must be at most ${def.max} characters.` };
      }
      break;
    }
    case 'date': {
      if (isNaN(Date.parse(stringVal))) {
        return { field: def.key, message: `Enter a valid date for ${def.label}.` };
      }
      break;
    }
  }

  if (def.pattern && stringVal !== '') {
    try {
      if (!new RegExp(def.pattern).test(stringVal)) {
        return { field: def.key, message: `${def.label} has an invalid format.` };
      }
    } catch {
      // Invalid regex — skip
    }
  }

  return null;
}

/** Validate all fields in a group. Returns errors for invalid fields. */
export function validateGroup(group: FieldGroup, values: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of group.fields) {
    const err = validateField(field, values[field.key]);
    if (err) errors.push(err);
  }
  return errors;
}

/** Validate all fields across all groups. */
export function validateAll(schema: FormSchema, values: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const group of schema.groups) {
    errors.push(...validateGroup(group, values));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Paste-to-fill: delimited text → field values (FR-3.2)
// ---------------------------------------------------------------------------

export interface PasteResult {
  values: Record<string, string>;
  unmatched: string[];
  warnings: string[];
}

/**
 * Parse a delimited paste string into field→value pairs.
 *
 * Supported formats:
 *   key: value           (one per line, colon-separated)
 *   key=value            (one per line, equals-separated)
 *   "key","value"        (CSV header+row — first line keys, second values)
 *   key<TAB>value        (one per line, tab-separated)
 */
export function parseDelimitedPaste(
  text: string,
  fieldKeys: Set<string>,
): PasteResult {
  const values: Record<string, string> = {};
  const unmatched: string[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (lines.length === 0) {
    warnings.push('No data found in pasted text.');
    return { values, unmatched, warnings };
  }

  // Detect CSV: first line starts with a quote and has commas
  const isCsv = lines[0].includes(',') && (lines[0].startsWith('"') || lines.length === 1 || (lines.length >= 2 && lines[1].includes(',')));

  if (isCsv && lines.length >= 2) {
    const parseCsvRow = (row: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
          if (inQuotes && row[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    };
    const keys = parseCsvRow(lines[0]);
    const vals = parseCsvRow(lines[1]);
    for (let i = 0; i < Math.max(keys.length, vals.length); i++) {
      const k = (keys[i] ?? '').replace(/^"|"$/g, '').trim();
      const v = (vals[i] ?? '').replace(/^"|"$/g, '').trim();
      if (!k) continue;
      if (fieldKeys.has(k)) {
        values[k] = v;
      } else {
        unmatched.push(k);
      }
    }
    return { values, unmatched, warnings };
  }

  // Key: value / key=value / key<TAB>value per line
  for (const line of lines) {
    const colon = line.indexOf(':');
    const eq = line.indexOf('=');
    const tab = line.indexOf('\t');
    const sepIdx = [colon, eq, tab].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (sepIdx == null || sepIdx < 0) {
      unmatched.push(line.trim());
      continue;
    }
    const key = line.slice(0, sepIdx).trim();
    const val = line.slice(sepIdx + 1).trim();
    if (!key) continue;
    if (fieldKeys.has(key)) {
      values[key] = val;
    } else {
      unmatched.push(key);
    }
  }

  if (Object.keys(values).length === 0 && unmatched.length > 0) {
    warnings.push('None of the pasted keys matched form fields.');
  }

  return { values, unmatched, warnings };
}

// ---------------------------------------------------------------------------
// CSV / JSON file upload → field values (FR-3.3)
// ---------------------------------------------------------------------------

export interface UploadResult {
  values: Record<string, string>;
  unmappedColumns: string[];
  warnings: string[];
}

/** Parse a CSV file string into field→value pairs (first data row). */
export function parseCsvUpload(text: string, fieldKeys: Set<string>): UploadResult {
  const result = parseDelimitedPaste(text, fieldKeys);
  return {
    values: result.values,
    unmappedColumns: result.unmatched,
    warnings: result.warnings,
  };
}

/** Parse a JSON file string into field→value pairs. Keys must be flat top-level strings. */
export function parseJsonUpload(text: string, fieldKeys: Set<string>): UploadResult {
  const values: Record<string, string> = {};
  const unmappedColumns: string[] = [];
  const warnings: string[] = [];

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      warnings.push('JSON must be a flat object with field keys.');
      return { values, unmappedColumns, warnings };
    }
    for (const [key, val] of Object.entries(parsed)) {
      if (fieldKeys.has(key)) {
        values[key] = val != null ? String(val) : '';
      } else {
        unmappedColumns.push(key);
      }
    }
  } catch {
    warnings.push('Invalid JSON file.');
  }

  return { values, unmappedColumns, warnings };
}

// ---------------------------------------------------------------------------
// Analytics (FR-6)
// ---------------------------------------------------------------------------

let formStartTime: number | null = null;

/** Call when a form first renders to anchor elapsedMs on subsequent events. */
export function markFormStart(): void {
  formStartTime = Date.now();
}

/** Emit a mode-related analytics event (no PII). */
export function trackInputModeEvent(event: InputModeEvent): void {
  trackActivity('input_mode', {
    metadata: JSON.stringify({
      ...event,
      elapsedMs: formStartTime ? Date.now() - formStartTime : undefined,
    }),
  });
}

// ---------------------------------------------------------------------------
// Build initial values from schema defaults
// ---------------------------------------------------------------------------

export function buildInitialValues(schema: FormSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const group of schema.groups) {
    for (const field of group.fields) {
      values[field.key] = field.defaultValue ?? (field.type === 'checkbox' ? false : '');
    }
  }
  return values;
}
