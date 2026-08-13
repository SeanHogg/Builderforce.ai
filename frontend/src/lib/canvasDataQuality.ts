/**
 * Data quality checks for the Creation Canvas.
 *
 * The canvas could already grade AI output (`evaluation`) and code
 * (`diagnostics`); nothing asserted that the DATA was fit to use. A dashboard
 * built on a table that lost half its rows overnight looks exactly like one that
 * did not, and that is the failure this closes.
 *
 * DRY WITH THE CONTRACT. A declared contract IS a set of checks —
 * {@link checksFromContract} derives them rather than asking anyone to restate
 * "customer_id must be unique" in two places. A check suite may add rules the
 * contract cannot express (referential integrity across two objects, a freshness
 * SLA), which is why the two are separate concepts and not one.
 */

import { toNumber, type TabularCell, type TabularSource } from './canvasTabularData';
import type { DataContract } from './canvasDataGovernance';

export const DATA_QUALITY_CHECK_KINDS = [
  'notNull', 'unique', 'rowCount', 'range', 'allowedValues', 'regex',
  'freshness', 'referentialIntegrity', 'distinctCount',
] as const;
export type DataQualityCheckKind = typeof DATA_QUALITY_CHECK_KINDS[number];

export interface DataQualityCheck {
  id: string;
  kind: DataQualityCheckKind;
  column?: string;
  min?: number;
  max?: number;
  values?: string[];
  pattern?: string;
  /** Freshness SLA in hours. */
  hours?: number;
  /** Referential integrity: the canvas object id holding the parent rows. */
  referenceObjectId?: string;
  referenceColumn?: string;
  /** Share of rows allowed to fail before the check does. 0 means none. */
  tolerance?: number;
  /** `warning` downgrades a failure so a soft rule does not fail the suite. */
  severity?: 'error' | 'warning';
}

export type DataQualityStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface DataQualityResult {
  id: string;
  kind: DataQualityCheckKind;
  status: DataQualityStatus;
  column?: string;
  /** Values the UI interpolates into a localized sentence. */
  detail: Record<string, string | number>;
  /** Up to five offending values, so a failure is actionable rather than a count. */
  samples?: string[];
}

export interface DataQualityContext {
  /** When the data under test was read. Required by the `freshness` check. */
  fetchedAt?: string | null;
  now?: number;
  /** Parent row sets, keyed by canvas object id, for referential integrity. */
  references?: Readonly<Record<string, TabularSource>>;
}

const SAMPLE_LIMIT = 5;

function cellText(value: TabularCell | undefined): string {
  return typeof value === 'number' ? String(value) : (value ?? '').toString();
}

/** Stable id for a generated check, so re-deriving a suite does not churn ids. */
function checkId(kind: DataQualityCheckKind, column?: string): string {
  return column ? `${kind}:${column}` : kind;
}

/**
 * Turn a declared contract into the checks that enforce it.
 *
 * This is the only place the mapping exists. A contract rule that gains a check
 * here is enforced everywhere the suite runs; nothing re-describes the rules.
 */
export function checksFromContract(contract: DataContract): DataQualityCheck[] {
  const checks: DataQualityCheck[] = [];
  for (const column of contract.columns) {
    if (column.required) checks.push({ id: checkId('notNull', column.name), kind: 'notNull', column: column.name });
    if (column.unique) checks.push({ id: checkId('unique', column.name), kind: 'unique', column: column.name });
    if (column.min != null || column.max != null) {
      checks.push({
        id: checkId('range', column.name), kind: 'range', column: column.name,
        ...(column.min != null ? { min: column.min } : {}),
        ...(column.max != null ? { max: column.max } : {}),
      });
    }
    if (column.allowedValues?.length) {
      checks.push({ id: checkId('allowedValues', column.name), kind: 'allowedValues', column: column.name, values: column.allowedValues });
    }
  }
  if (contract.primaryKey?.length === 1 && contract.primaryKey[0]) {
    const key = contract.primaryKey[0];
    if (!checks.some((check) => check.kind === 'unique' && check.column === key)) {
      checks.push({ id: checkId('unique', key), kind: 'unique', column: key });
    }
  }
  if (contract.rowCountMin != null || contract.rowCountMax != null) {
    checks.push({
      id: checkId('rowCount'), kind: 'rowCount',
      ...(contract.rowCountMin != null ? { min: contract.rowCountMin } : {}),
      ...(contract.rowCountMax != null ? { max: contract.rowCountMax } : {}),
    });
  }
  if (contract.freshnessHours != null) {
    checks.push({ id: checkId('freshness'), kind: 'freshness', hours: contract.freshnessHours, severity: 'warning' });
  }
  return checks;
}

export function normalizeDataQualityChecks(value: unknown): DataQualityCheck[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw): DataQualityCheck[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    if (!(DATA_QUALITY_CHECK_KINDS as readonly string[]).includes(String(item.kind))) return [];
    const kind = item.kind as DataQualityCheckKind;
    const column = typeof item.column === 'string' ? item.column.trim() : undefined;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 80) : checkId(kind, column);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id, kind,
      ...(column ? { column } : {}),
      ...(Number.isFinite(Number(item.min)) && item.min != null ? { min: Number(item.min) } : {}),
      ...(Number.isFinite(Number(item.max)) && item.max != null ? { max: Number(item.max) } : {}),
      ...(Array.isArray(item.values) ? { values: item.values.map((entry) => String(entry)).slice(0, 60) } : {}),
      ...(typeof item.pattern === 'string' && item.pattern.trim() ? { pattern: item.pattern.trim().slice(0, 200) } : {}),
      ...(Number.isFinite(Number(item.hours)) && item.hours != null ? { hours: Math.max(0, Number(item.hours)) } : {}),
      ...(typeof item.referenceObjectId === 'string' ? { referenceObjectId: item.referenceObjectId } : {}),
      ...(typeof item.referenceColumn === 'string' ? { referenceColumn: item.referenceColumn.trim() } : {}),
      ...(Number.isFinite(Number(item.tolerance)) && item.tolerance != null ? { tolerance: Math.max(0, Math.min(1, Number(item.tolerance))) } : {}),
      ...(item.severity === 'warning' ? { severity: 'warning' as const } : {}),
    }];
  }).slice(0, 60);
}

/** Rows scanned per check. Exact for anything under this; above it the result
 *  reports what it scanned rather than claiming to have read every row. */
const SCAN_LIMIT = 200_000;

/**
 * Run a suite against a source.
 *
 * Every result is data. The `detail` map is what a localized sentence
 * interpolates and what a Brain tool result carries, so the same run reads
 * correctly on the card, in the inspector, and in a model's context.
 */
export function runDataQualityChecks(
  source: TabularSource,
  checks: readonly DataQualityCheck[],
  context: DataQualityContext = {},
): DataQualityResult[] {
  const rows = source.rows.length > SCAN_LIMIT ? source.rows.slice(0, SCAN_LIMIT) : source.rows;
  const scanned = rows.length;
  const present = new Set(source.columns);

  return checks.map((check): DataQualityResult => {
    const tolerance = check.tolerance ?? 0;
    const failed = (failures: number, detail: Record<string, string | number>, samples: string[]): DataQualityResult => {
      const share = scanned ? failures / scanned : 0;
      const within = failures === 0 || share <= tolerance;
      return {
        id: check.id, kind: check.kind,
        ...(check.column ? { column: check.column } : {}),
        status: within ? 'pass' : check.severity === 'warning' ? 'warn' : 'fail',
        detail: { ...detail, failures, scanned },
        ...(samples.length ? { samples: samples.slice(0, SAMPLE_LIMIT) } : {}),
      };
    };
    const skipped = (reason: string, detail: Record<string, string | number> = {}): DataQualityResult => ({
      id: check.id, kind: check.kind,
      ...(check.column ? { column: check.column } : {}),
      status: 'skipped', detail: { reason, ...detail },
    });

    if (check.kind === 'rowCount') {
      const count = source.rows.length;
      const low = check.min != null && count < check.min;
      const high = check.max != null && count > check.max;
      return {
        id: check.id, kind: check.kind,
        status: low || high ? (check.severity === 'warning' ? 'warn' : 'fail') : 'pass',
        detail: { rows: count, ...(check.min != null ? { min: check.min } : {}), ...(check.max != null ? { max: check.max } : {}) },
      };
    }

    if (check.kind === 'freshness') {
      if (!context.fetchedAt) return skipped('no-timestamp');
      const stamped = Date.parse(context.fetchedAt);
      if (Number.isNaN(stamped)) return skipped('no-timestamp');
      const ageHours = ((context.now ?? Date.now()) - stamped) / 3_600_000;
      const sla = check.hours ?? 24;
      return {
        id: check.id, kind: check.kind,
        status: ageHours > sla ? (check.severity === 'error' ? 'fail' : 'warn') : 'pass',
        detail: { ageHours: Math.round(ageHours * 10) / 10, slaHours: sla },
      };
    }

    if (check.kind === 'referentialIntegrity') {
      const parent = check.referenceObjectId ? context.references?.[check.referenceObjectId] : undefined;
      if (!check.column || !present.has(check.column)) return skipped('missing-column', { column: check.column ?? '' });
      if (!parent || !check.referenceColumn) return skipped('missing-reference');
      if (!parent.columns.includes(check.referenceColumn)) return skipped('missing-reference-column', { column: check.referenceColumn });
      const known = new Set(parent.rows.map((row) => cellText(row[check.referenceColumn!]).trim().toLowerCase()).filter(Boolean));
      const orphans: string[] = [];
      let failures = 0;
      for (const row of rows) {
        const value = cellText(row[check.column]).trim();
        if (!value) continue;
        if (!known.has(value.toLowerCase())) {
          failures += 1;
          if (orphans.length < SAMPLE_LIMIT) orphans.push(value);
        }
      }
      return failed(failures, { parentRows: parent.rows.length, referenceColumn: check.referenceColumn }, orphans);
    }

    if (!check.column || !present.has(check.column)) return skipped('missing-column', { column: check.column ?? '' });
    const column = check.column;

    switch (check.kind) {
      case 'notNull': {
        let failures = 0;
        for (const row of rows) if (!cellText(row[column]).trim()) failures += 1;
        return failed(failures, {}, []);
      }
      case 'unique': {
        const seen = new Set<string>();
        const dupes: string[] = [];
        let failures = 0;
        for (const row of rows) {
          const value = cellText(row[column]).trim();
          if (!value) continue;
          const key = value.toLowerCase();
          if (seen.has(key)) { failures += 1; if (dupes.length < SAMPLE_LIMIT) dupes.push(value); }
          else seen.add(key);
        }
        return failed(failures, { distinct: seen.size }, dupes);
      }
      case 'distinctCount': {
        const seen = new Set<string>();
        for (const row of rows) {
          const value = cellText(row[column]).trim();
          if (value) seen.add(value.toLowerCase());
        }
        const low = check.min != null && seen.size < check.min;
        const high = check.max != null && seen.size > check.max;
        return {
          id: check.id, kind: check.kind, column,
          status: low || high ? (check.severity === 'warning' ? 'warn' : 'fail') : 'pass',
          detail: { distinct: seen.size, ...(check.min != null ? { min: check.min } : {}), ...(check.max != null ? { max: check.max } : {}) },
        };
      }
      case 'range': {
        const offenders: string[] = [];
        let failures = 0;
        for (const row of rows) {
          const raw = row[column];
          if (!cellText(raw).trim()) continue;
          const value = toNumber(raw);
          if (value == null || (check.min != null && value < check.min) || (check.max != null && value > check.max)) {
            failures += 1;
            if (offenders.length < SAMPLE_LIMIT) offenders.push(cellText(raw));
          }
        }
        return failed(failures, { ...(check.min != null ? { min: check.min } : {}), ...(check.max != null ? { max: check.max } : {}) }, offenders);
      }
      case 'allowedValues': {
        const allowed = new Set((check.values ?? []).map((value) => value.toLowerCase()));
        if (!allowed.size) return skipped('no-values');
        const offenders: string[] = [];
        let failures = 0;
        for (const row of rows) {
          const value = cellText(row[column]).trim();
          if (!value) continue;
          if (!allowed.has(value.toLowerCase())) {
            failures += 1;
            if (offenders.length < SAMPLE_LIMIT) offenders.push(value);
          }
        }
        return failed(failures, { allowed: (check.values ?? []).slice(0, 8).join(', ') }, offenders);
      }
      case 'regex': {
        let expression: RegExp;
        try { expression = new RegExp(check.pattern ?? '', 'u'); } catch { return skipped('bad-pattern', { pattern: check.pattern ?? '' }); }
        const offenders: string[] = [];
        let failures = 0;
        for (const row of rows) {
          const value = cellText(row[column]).trim();
          if (!value) continue;
          if (!expression.test(value)) {
            failures += 1;
            if (offenders.length < SAMPLE_LIMIT) offenders.push(value);
          }
        }
        return failed(failures, { pattern: check.pattern ?? '' }, offenders);
      }
      default:
        return skipped('unsupported');
    }
  });
}

export interface DataQualityVerdict {
  status: DataQualityStatus;
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
  total: number;
  /** 0–100 over the checks that actually ran. Skipped checks do not flatter it. */
  score: number;
}

export function dataQualityVerdict(results: readonly DataQualityResult[]): DataQualityVerdict {
  const passed = results.filter((result) => result.status === 'pass').length;
  const warned = results.filter((result) => result.status === 'warn').length;
  const failed = results.filter((result) => result.status === 'fail').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const ran = results.length - skipped;
  return {
    status: failed ? 'fail' : warned ? 'warn' : ran ? 'pass' : 'skipped',
    passed, warned, failed, skipped,
    total: results.length,
    score: ran ? Math.round((passed + warned * 0.5) / ran * 100) : 0,
  };
}

/**
 * A starter suite for a source with no contract yet.
 *
 * Deliberately conservative: it asserts what the data currently looks like at
 * its most obvious (an id-shaped column is unique, a fully populated column
 * stays populated) so the first run is green and every later failure is real
 * drift rather than a rule nobody chose.
 */
export function suggestDataQualityChecks(source: TabularSource): DataQualityCheck[] {
  const checks: DataQualityCheck[] = [];
  const rowCount = source.rows.length;
  if (!rowCount) return checks;
  checks.push({ id: checkId('rowCount'), kind: 'rowCount', min: Math.max(1, Math.floor(rowCount * 0.5)) });
  for (const column of source.columns.slice(0, 40)) {
    let filled = 0;
    const seen = new Set<string>();
    for (const row of source.rows) {
      const value = cellText(row[column]).trim();
      if (!value) continue;
      filled += 1;
      seen.add(value.toLowerCase());
    }
    if (filled === rowCount) checks.push({ id: checkId('notNull', column), kind: 'notNull', column });
    if (filled === rowCount && seen.size === rowCount && /(^|_)(id|key|code|uuid|email)$/i.test(column)) {
      checks.push({ id: checkId('unique', column), kind: 'unique', column });
    }
  }
  return checks.slice(0, 40);
}

/**
 * Index the tabular objects on a board by id, for referential-integrity checks.
 *
 * `read` is injected rather than imported so this module stays free of any
 * canvas-object shape — the checks operate on sources, not on nodes.
 */
export function referenceSources(
  objects: ReadonlyArray<{ id: string; data: Record<string, unknown> }>,
  read: (data: Record<string, unknown>) => TabularSource,
): Record<string, TabularSource> {
  return Object.fromEntries(objects.map((object) => [object.id, read(object.data)] as const));
}
