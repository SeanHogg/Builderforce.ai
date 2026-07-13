/**
 * Board-collector bulk import — CSV/JSON bulk entry for the manual board-deck
 * datasets (headcount, positions, R&D financials, support tickets, incidents,
 * uptime, AI adoption/programs). Closes the "manual entry only" gap: there is no
 * HRIS/payroll connector for these, so a bulk-import path is the way to load a
 * quarter of data at once. One registry drives both the column whitelist and the
 * per-column coercion; the endpoint inserts in a single multi-row statement
 * (neon-http has no interactive tx) and bumps the matching lens cache.
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

type ColType = 'string' | 'number' | 'bool' | 'dateString' | 'timestamp';
interface ColDef { name: string; type: ColType; required?: boolean }

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
      { name: 'memberKind', type: 'string' }, { name: 'memberRef', type: 'string' }, { name: 'memberName', type: 'string' },
      { name: 'eventType', type: 'string', required: true }, { name: 'teamId', type: 'number' },
      { name: 'effectiveOn', type: 'dateString', required: true }, { name: 'isVoluntary', type: 'bool' }, { name: 'reason', type: 'string' },
    ],
  },
  'positions': {
    table: openPositions, versionKey: peopleVersionKey,
    columns: [
      { name: 'reqTitle', type: 'string', required: true }, { name: 'teamId', type: 'number' }, { name: 'priority', type: 'string' },
      { name: 'status', type: 'string' }, { name: 'openedOn', type: 'dateString' }, { name: 'targetStartOn', type: 'dateString' },
      { name: 'filledOn', type: 'dateString' }, { name: 'notes', type: 'string' },
    ],
  },
  'rd-financials': {
    table: rdFinancialsQuarterly, versionKey: rdFinancialsVersionKey,
    columns: [
      { name: 'fiscalYear', type: 'number', required: true }, { name: 'quarter', type: 'number', required: true },
      { name: 'category', type: 'string', required: true }, { name: 'actualUsd', type: 'number' }, { name: 'planUsd', type: 'number' },
      { name: 'source', type: 'string' }, { name: 'notes', type: 'string' },
    ],
  },
  'rd-revenue': {
    table: rdRevenueQuarterly, versionKey: rdFinancialsVersionKey,
    columns: [
      { name: 'fiscalYear', type: 'number', required: true }, { name: 'quarter', type: 'number', required: true }, { name: 'revenueUsd', type: 'number' },
    ],
  },
  'rd-fte': {
    table: rdFteAllocationQuarterly, versionKey: rdFinancialsVersionKey,
    columns: [
      { name: 'fiscalYear', type: 'number', required: true }, { name: 'quarter', type: 'number', required: true },
      { name: 'category', type: 'string', required: true }, { name: 'fte', type: 'number' },
    ],
  },
  'support-tickets': {
    table: supportTickets, versionKey: qualityVersionKey,
    columns: [
      { name: 'source', type: 'string' }, { name: 'externalRef', type: 'string' }, { name: 'subject', type: 'string' },
      { name: 'category', type: 'string' }, { name: 'isBug', type: 'bool' }, { name: 'priority', type: 'string' }, { name: 'status', type: 'string' },
      { name: 'customerRef', type: 'string' }, { name: 'openedAt', type: 'timestamp' }, { name: 'resolvedAt', type: 'timestamp' },
    ],
  },
  'incidents': {
    table: prodIncidents, versionKey: qualityVersionKey,
    columns: [
      { name: 'title', type: 'string', required: true }, { name: 'severity', type: 'string' }, { name: 'status', type: 'string' },
      { name: 'isAlertOnly', type: 'bool' }, { name: 'source', type: 'string' }, { name: 'externalRef', type: 'string' },
      { name: 'startedAt', type: 'timestamp' }, { name: 'resolvedAt', type: 'timestamp' }, { name: 'impact', type: 'string' },
      { name: 'rootCause', type: 'string' }, { name: 'postmortemUrl', type: 'string' },
    ],
  },
  'uptime': {
    table: uptimeSamples, versionKey: qualityVersionKey,
    columns: [
      { name: 'serviceName', type: 'string' }, { name: 'periodDay', type: 'dateString', required: true },
      { name: 'uptimePct', type: 'number' }, { name: 'downtimeMinutes', type: 'number' }, { name: 'source', type: 'string' },
    ],
  },
  'ai-tool-adoption': {
    table: aiToolAdoption, versionKey: aiProgramVersionKey,
    columns: [
      { name: 'toolName', type: 'string', required: true }, { name: 'category', type: 'string' }, { name: 'periodMonth', type: 'string', required: true },
      { name: 'activeUsers', type: 'number' }, { name: 'eligibleUsers', type: 'number' }, { name: 'estHoursSaved', type: 'number' },
      { name: 'monthlyCostUsd', type: 'number' }, { name: 'notes', type: 'string' },
    ],
  },
  'ai-programs': {
    table: aiProgramInitiatives, versionKey: aiProgramVersionKey,
    columns: [
      { name: 'initiativeId', type: 'string' }, { name: 'programName', type: 'string', required: true }, { name: 'tier', type: 'string' },
      { name: 'investedUsd', type: 'number' }, { name: 'status', type: 'string' }, { name: 'objective', type: 'string' }, { name: 'notes', type: 'string' },
    ],
  },
};

export function isImportDataset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(IMPORT_DATASETS, name);
}

/** Coerce a raw CSV/JSON cell to the column's type; undefined skips the column. */
function coerceCell(type: ColType, raw: unknown): unknown {
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

export interface ImportResult { inserted: number; skipped: number; errors: string[] }

/**
 * Validate + coerce + bulk-insert rows for `dataset`. tenantId is injected on
 * every row; segment_id is filled by the table trigger. Rows missing a required
 * column are skipped (reported), not fatal. One multi-row insert per call.
 */
export async function importBoardRows(
  db: Db, env: Env, tenantId: number, dataset: string, rawRows: Array<Record<string, unknown>>,
): Promise<ImportResult> {
  const def = IMPORT_DATASETS[dataset];
  if (!def) return { inserted: 0, skipped: 0, errors: [`unknown dataset "${dataset}"`] };
  if (!Array.isArray(rawRows) || rawRows.length === 0) return { inserted: 0, skipped: 0, errors: ['no rows'] };
  if (rawRows.length > 2000) return { inserted: 0, skipped: 0, errors: ['too many rows (max 2000 per import)'] };

  const errors: string[] = [];
  const values: Array<Record<string, unknown>> = [];

  rawRows.forEach((raw, i) => {
    const row: Record<string, unknown> = { tenantId };
    let ok = true;
    for (const col of def.columns) {
      const v = coerceCell(col.type, raw[col.name]);
      if (v === undefined) {
        if (col.required) { errors.push(`row ${i + 1}: missing required "${col.name}"`); ok = false; break; }
        continue;
      }
      row[col.name] = v;
    }
    if (ok) values.push(row);
  });

  if (values.length === 0) return { inserted: 0, skipped: rawRows.length, errors };

  await db.insert(def.table).values(values);
  await bumpCacheVersion(env, def.versionKey(tenantId));

  return { inserted: values.length, skipped: rawRows.length - values.length, errors };
}
