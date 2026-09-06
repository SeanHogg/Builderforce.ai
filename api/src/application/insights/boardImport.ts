/**
 * Board-collector bulk import — CSV/JSON bulk entry for the manual board-deck
 * datasets (headcount, positions, R&D financials, support tickets, incidents,
 * uptime, AI adoption/programs). Closes the "manual entry only" gap: there is no
 * HRIS/payroll connector for these, so a bulk-import path is the way to load a
 * quarter of data at once. One registry drives the column whitelist, the
 * per-column coercion, the CSV template the /import page hands out AND the
 * placeholders its guided wizard shows (`example`). The endpoint inserts in a
 * single multi-row statement (neon-http has no interactive tx) and bumps the
 * matching lens cache.
 *
 * Served at `/api/import` (see presentation/routes/importRoutes.ts) — the ONE
 * import surface. It used to hang off `/api/insights/import/*` as well; that
 * block is gone so there is exactly one contract to keep the page against.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import {
  prodIncidents, supportTickets, uptimeSamples, headcountEvents, openPositions,
  aiToolAdoption, aiProgramInitiatives, rdFinancialsQuarterly, rdRevenueQuarterly, rdFteAllocationQuarterly,
} from '../../infrastructure/database/schema';
import {
  qualityVersionKey, peopleVersionKey, aiProgramVersionKey, rdFinancialsVersionKey,
} from './versionKeys';

export type ImportColumnType = 'string' | 'number' | 'bool' | 'dateString' | 'timestamp';

interface ColDef {
  name: string;
  type: ImportColumnType;
  required?: boolean;
  /** A realistic value for this column — the CSV template's example row and the
   *  guided wizard's placeholder both read it, so neither invents its own. */
  example?: string;
}

interface DatasetDef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  columns: ColDef[];
  versionKey: (tenantId: number) => string;
}

/** The single source of truth for every importable dataset (name → spec). */
export const IMPORT_DATASETS: Record<string, DatasetDef> = {
  'headcount-events': {
    table: headcountEvents, versionKey: peopleVersionKey,
    columns: [
      { name: 'memberKind', type: 'string', example: 'employee' },
      { name: 'memberRef', type: 'string', example: 'E-1042' },
      { name: 'memberName', type: 'string', example: 'Ada Lovelace' },
      { name: 'eventType', type: 'string', required: true, example: 'hire' },
      { name: 'teamId', type: 'number', example: '12' },
      { name: 'effectiveOn', type: 'dateString', required: true, example: '2026-07-01' },
      { name: 'isVoluntary', type: 'bool', example: 'false' },
      { name: 'reason', type: 'string', example: 'Backfill' },
    ],
  },
  'positions': {
    table: openPositions, versionKey: peopleVersionKey,
    columns: [
      { name: 'reqTitle', type: 'string', required: true, example: 'Senior Backend Engineer' },
      { name: 'teamId', type: 'number', example: '12' },
      { name: 'priority', type: 'string', example: 'high' },
      { name: 'status', type: 'string', example: 'open' },
      { name: 'openedOn', type: 'dateString', example: '2026-06-15' },
      { name: 'targetStartOn', type: 'dateString', example: '2026-09-01' },
      { name: 'filledOn', type: 'dateString' },
      { name: 'notes', type: 'string', example: 'Replaces R-201' },
    ],
  },
  'rd-financials': {
    table: rdFinancialsQuarterly, versionKey: rdFinancialsVersionKey,
    columns: [
      { name: 'fiscalYear', type: 'number', required: true, example: '2026' },
      { name: 'quarter', type: 'number', required: true, example: '3' },
      { name: 'category', type: 'string', required: true, example: 'engineering' },
      { name: 'actualUsd', type: 'number', example: '1250000' },
      { name: 'planUsd', type: 'number', example: '1300000' },
      { name: 'source', type: 'string', example: 'ledger' },
      { name: 'notes', type: 'string' },
    ],
  },
  'rd-revenue': {
    table: rdRevenueQuarterly, versionKey: rdFinancialsVersionKey,
    columns: [
      { name: 'fiscalYear', type: 'number', required: true, example: '2026' },
      { name: 'quarter', type: 'number', required: true, example: '3' },
      { name: 'revenueUsd', type: 'number', example: '4800000' },
    ],
  },
  'rd-fte': {
    table: rdFteAllocationQuarterly, versionKey: rdFinancialsVersionKey,
    columns: [
      { name: 'fiscalYear', type: 'number', required: true, example: '2026' },
      { name: 'quarter', type: 'number', required: true, example: '3' },
      { name: 'category', type: 'string', required: true, example: 'engineering' },
      { name: 'fte', type: 'number', example: '42.5' },
    ],
  },
  'support-tickets': {
    table: supportTickets, versionKey: qualityVersionKey,
    columns: [
      { name: 'source', type: 'string', example: 'zendesk' },
      { name: 'externalRef', type: 'string', example: 'ZD-88123' },
      { name: 'subject', type: 'string', example: 'Login loop on mobile' },
      { name: 'category', type: 'string', example: 'auth' },
      { name: 'isBug', type: 'bool', example: 'true' },
      { name: 'priority', type: 'string', example: 'high' },
      { name: 'status', type: 'string', example: 'resolved' },
      { name: 'customerRef', type: 'string', example: 'ACME' },
      { name: 'openedAt', type: 'timestamp', example: '2026-08-01T09:15:00Z' },
      { name: 'resolvedAt', type: 'timestamp', example: '2026-08-02T14:00:00Z' },
    ],
  },
  'incidents': {
    table: prodIncidents, versionKey: qualityVersionKey,
    columns: [
      { name: 'title', type: 'string', required: true, example: 'API latency spike' },
      { name: 'severity', type: 'string', example: 'sev2' },
      { name: 'status', type: 'string', example: 'resolved' },
      { name: 'isAlertOnly', type: 'bool', example: 'false' },
      { name: 'source', type: 'string', example: 'pagerduty' },
      { name: 'externalRef', type: 'string', example: 'PD-4471' },
      { name: 'startedAt', type: 'timestamp', example: '2026-08-03T21:40:00Z' },
      { name: 'resolvedAt', type: 'timestamp', example: '2026-08-03T22:05:00Z' },
      { name: 'impact', type: 'string', example: 'Checkout slowed for 25 minutes' },
      { name: 'rootCause', type: 'string', example: 'Connection pool exhaustion' },
      { name: 'postmortemUrl', type: 'string', example: 'https://example.com/postmortems/4471' },
    ],
  },
  'uptime': {
    table: uptimeSamples, versionKey: qualityVersionKey,
    columns: [
      { name: 'serviceName', type: 'string', example: 'api' },
      { name: 'periodDay', type: 'dateString', required: true, example: '2026-08-01' },
      { name: 'uptimePct', type: 'number', example: '99.98' },
      { name: 'downtimeMinutes', type: 'number', example: '3' },
      { name: 'source', type: 'string', example: 'statuspage' },
    ],
  },
  'ai-tool-adoption': {
    table: aiToolAdoption, versionKey: aiProgramVersionKey,
    columns: [
      { name: 'toolName', type: 'string', required: true, example: 'Claude Code' },
      { name: 'category', type: 'string', example: 'coding' },
      { name: 'periodMonth', type: 'string', required: true, example: '2026-08' },
      { name: 'activeUsers', type: 'number', example: '38' },
      { name: 'eligibleUsers', type: 'number', example: '45' },
      { name: 'estHoursSaved', type: 'number', example: '410' },
      { name: 'monthlyCostUsd', type: 'number', example: '3200' },
      { name: 'notes', type: 'string' },
    ],
  },
  'ai-programs': {
    table: aiProgramInitiatives, versionKey: aiProgramVersionKey,
    columns: [
      { name: 'initiativeId', type: 'string', example: 'AI-07' },
      { name: 'programName', type: 'string', required: true, example: 'Support triage agent' },
      { name: 'tier', type: 'string', example: 'core' },
      { name: 'investedUsd', type: 'number', example: '85000' },
      { name: 'status', type: 'string', example: 'active' },
      { name: 'objective', type: 'string', example: 'Halve first-response time' },
      { name: 'notes', type: 'string' },
    ],
  },
};

export function isImportDataset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(IMPORT_DATASETS, name);
}

/** One column as the wire advertises it — `required` always present, `example`
 *  only when the registry declares one. */
export interface ImportKindColumn {
  name: string;
  type: ImportColumnType;
  required: boolean;
  example?: string;
}

export interface ImportKind {
  key: string;
  columns: ImportKindColumn[];
}

/** The registry projected onto the wire: `GET /api/import/kinds`. */
export function listImportKinds(): ImportKind[] {
  return Object.entries(IMPORT_DATASETS).map(([key, def]) => ({
    key,
    columns: def.columns.map((col) => ({
      name: col.name,
      type: col.type,
      required: !!col.required,
      ...(col.example !== undefined ? { example: col.example } : {}),
    })),
  }));
}

/** FNV-1a over the wire projection. The registry is static per deploy, so a
 *  cached `/kinds` read keyed on this is exactly as fresh as the code. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Changes whenever a column, its type, requiredness or example changes. */
export const IMPORT_REGISTRY_FINGERPRINT: string = fingerprint(JSON.stringify(listImportKinds()));

/** Coerce a raw CSV/JSON cell to the column's type; undefined skips the column. */
function coerceCell(type: ImportColumnType, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined;
  switch (type) {
    case 'number': { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
    case 'bool': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'y';
    }
    case 'dateString': {
      // 'YYYY-MM-DD' for drizzle date() columns; accept ISO and trim to the date.
      const s = String(raw).trim();
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
    }
    case 'timestamp': { const d = new Date(String(raw)); return Number.isNaN(d.getTime()) ? undefined : d; }
    default: return String(raw);
  }
}

export interface ImportResult {
  /** Rows written — or, when `dryRun`, rows that WOULD be written. */
  inserted: number;
  skipped: number;
  /** `row N: …`, where N counts from `rowOffset + 1` so a batched caller reads
   *  positions in its own file rather than in the batch. */
  errors: string[];
  dryRun: boolean;
}

export interface ImportOptions {
  /** Validate and coerce every row, insert nothing. Same result shape. */
  dryRun?: boolean;
  /** Number of rows the caller has already sent ahead of this batch. */
  rowOffset?: number;
}

/** Per-import row cap: one multi-row INSERT, bounded so a single request cannot
 *  hold a Worker for its whole CPU budget. Callers batch above it. */
export const IMPORT_MAX_ROWS = 2000;

/** Validate + coerce against the registry. Rows missing a required column are
 *  reported and dropped; everything else is a `values` row ready to insert. */
function validateBoardRows(
  def: DatasetDef, tenantId: number, rawRows: Array<Record<string, unknown>>, rowOffset: number,
): { values: Array<Record<string, unknown>>; errors: string[] } {
  const errors: string[] = [];
  const values: Array<Record<string, unknown>> = [];

  rawRows.forEach((raw, i) => {
    const row: Record<string, unknown> = { tenantId };
    let ok = true;
    for (const col of def.columns) {
      const v = coerceCell(col.type, raw[col.name]);
      if (v === undefined) {
        if (col.required) { errors.push(`row ${rowOffset + i + 1}: missing required "${col.name}"`); ok = false; break; }
        continue;
      }
      row[col.name] = v;
    }
    if (ok) values.push(row);
  });

  return { values, errors };
}

/**
 * Validate + coerce + bulk-insert rows for `dataset`. tenantId is injected on
 * every row; segment_id is filled by the table trigger. Rows missing a required
 * column are skipped (reported), not fatal. One multi-row insert per call —
 * none at all when `dryRun`.
 */
export async function importBoardRows(
  db: Db, env: Env, tenantId: number, dataset: string, rawRows: Array<Record<string, unknown>>,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const dryRun = opts.dryRun === true;
  const rowOffset = Math.max(0, Math.floor(opts.rowOffset ?? 0));
  const def = IMPORT_DATASETS[dataset];
  if (!def) return { inserted: 0, skipped: 0, errors: [`unknown dataset "${dataset}"`], dryRun };
  if (!Array.isArray(rawRows) || rawRows.length === 0) return { inserted: 0, skipped: 0, errors: ['no rows'], dryRun };
  if (rawRows.length > IMPORT_MAX_ROWS) {
    return { inserted: 0, skipped: 0, errors: [`too many rows (max ${IMPORT_MAX_ROWS} per import)`], dryRun };
  }

  const { values, errors } = validateBoardRows(def, tenantId, rawRows, rowOffset);
  const skipped = rawRows.length - values.length;

  if (values.length === 0 || dryRun) return { inserted: values.length, skipped, errors, dryRun };

  await db.insert(def.table).values(values);
  await bumpCacheVersion(env, def.versionKey(tenantId));

  return { inserted: values.length, skipped, errors, dryRun };
}
