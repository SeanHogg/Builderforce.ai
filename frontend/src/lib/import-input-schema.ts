/**
 * Schema and validation for record import inputs (guided + bulk).
 *
 * The kinds and their fields are NOT declared here. They are DERIVED from the
 * server registry (`GET /api/import/kinds`, `importApi.ts`) through
 * {@link recordKindsFrom} — the wizard, the bulk mapper, the CSV template and
 * the server all read one list of columns, so a column added to the api's
 * `IMPORT_DATASETS` reaches the page with no second registration. What lives
 * here is the client-side business rule layer: the shape a kind takes once it
 * is on the page, and the per-cell checks both modes run before a row is sent.
 */

import type { ImportColumnType, ImportKind } from './importApi';

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Input state for guided mode: step-driven form with per-step field sets.
 */
export type GuidedStep = 'step-info' | 'step-fields' | 'step-review' | 'step-success';

export const DEFAULT_BEGINNER_STEP: GuidedStep = 'step-info';

/**
 * Canonical field directives for record import: identifier + checker API.
 */
export interface FieldDirective {
  /** Canonical column name — the key the server accepts (must match backend). */
  key: string;
  type: ImportColumnType;
  /** Required for valid records. */
  required: boolean;
  /** A realistic value from the registry; surfaced as placeholder + template row. */
  example: string | null;
}

/** Supported record kinds and their available fields. */
export interface RecordKindInfo {
  kind: string;
  /** Registry order — the order the wizard renders and the template writes. */
  fields: FieldDirective[];
  /** The same fields by key, for the mapper's lookups. */
  availableFields: Record<string, FieldDirective>;
}

/**
 * A field's LABEL lives in the message catalogs, not here.
 *
 * Labels used to be English strings on the directive, which a form rendered
 * directly — so the guided wizard's review step and the bulk mapping dropdown
 * said "Reference ID" in French while every other string on the page was
 * translated. These derive the `import.*` key instead, and the components
 * render them through their own translator. The api's `importRoutes.test.ts`
 * asserts every registry column and kind resolves in all five catalogs.
 */
const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const fieldLabelKey = (key: string): string => `field${upperFirst(key)}`;

/** `headcount-events` → `kindHeadcountEvents`. */
export const kindLabelKey = (kind: string): string => `kind${kind.split('-').map(upperFirst).join('')}`;

/** Project the server registry into the page's shape. */
export function recordKindsFrom(kinds: readonly ImportKind[]): Record<string, RecordKindInfo> {
  const out: Record<string, RecordKindInfo> = {};
  for (const kind of kinds) {
    const fields = kind.columns.map<FieldDirective>((c) => ({
      key: c.name,
      type: c.type,
      required: c.required,
      example: c.example ?? null,
    }));
    out[kind.key] = {
      kind: kind.key,
      fields,
      availableFields: Object.fromEntries(fields.map((f) => [f.key, f])),
    };
  }
  return out;
}

export function requiredFields(kind: RecordKindInfo): FieldDirective[] {
  return kind.fields.filter((f) => f.required);
}

/**
 * Why a cell failed, as a CODE rather than a sentence.
 *
 * This module runs outside React and has no translator, so a reason composed
 * here could only ever be English — and it is rendered into the wizard's inline
 * errors, the dry-run table and the downloadable error report. The code plus
 * the field it concerns is everything the presentation layer needs to say it in
 * the reader's language.
 */
export type CellErrorCode = 'requiredEmpty' | 'notBoolean' | 'notNumber' | 'notDate';

const BOOLEAN_WORDS = new Set(['true', 'false', '1', '0', 'yes', 'no', 'y', 'n']);

/**
 * THE per-cell check, mirroring the server's coercion (`boardImport.coerceCell`):
 * an empty cell is fine unless the field is required; a non-empty cell must be
 * readable as the column's type. Both modes run it so the wizard's blur error
 * and the bulk dry run can never disagree about a value.
 */
export function validateCell(field: FieldDirective, value: unknown): CellErrorCode | null {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (text === '') return field.required ? 'requiredEmpty' : null;
  switch (field.type) {
    case 'bool':
      return typeof value === 'boolean' || BOOLEAN_WORDS.has(text.toLowerCase()) ? null : 'notBoolean';
    case 'number':
      return Number.isFinite(Number(text)) ? null : 'notNumber';
    case 'dateString':
    case 'timestamp':
      return Number.isNaN(new Date(text).getTime()) ? 'notDate' : null;
    default:
      return null;
  }
}

/** The guided flow's steps. The same for every kind: what varies per kind is
 *  the field set inside `step-fields`, not the sequence. */
export function defineGuidedSteps(): GuidedStep[] {
  return ['step-info', 'step-fields', 'step-review', 'step-success'];
}
