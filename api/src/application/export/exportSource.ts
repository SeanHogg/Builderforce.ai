/**
 * Export sources — THE contract every tabular download in the api is built on.
 *
 * A domain that wants a "Download CSV" button registers an {@link ExportSource}:
 * who may pull it, which formats it offers, and a `load` that returns ROWS +
 * COLUMNS + a filename. It does not serialise and it does not build a response.
 * {@link renderExport} does both, once, for every source:
 *
 *   csv   → `csvMatrix`   (the api's one CSV escaper)
 *   html  → `htmlMatrix`  (print-to-PDF / Excel-openable table)
 *   xlsx  → `sheetsToXlsx` (one sheet per table; a source may supply several)
 *   json  → the source's own snapshot, or `{ generatedAt, columns, rows }`
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Before this there were fourteen one-off export routes, each re-deciding the
 * same five things: parse `?format=`, pick a content type, stamp a filename, set
 * `content-disposition`, and escape the cells. Two of them hand-rolled the CSV
 * escaping (and one quoted only some columns, so a comma in an audit metadata
 * blob shifted every cell after it). Now the per-domain code is only the part
 * that is genuinely the domain's — which rows, which columns — and every format
 * a source declares works the same way everywhere.
 *
 * Sources are served two ways, and both go through the SAME `renderExport`:
 *   - `GET /api/exports/sources/:id?format=…` — the generic door (exportRoutes);
 *   - each domain's historical path (e.g. `/api/insights/compliance/export`),
 *     now a thin adapter that names its source and keeps its URL alive.
 *
 * Access is DATA on the source (`scope` + `minRole` + `planFeature`), enforced by
 * the one presentation adapter (`exportSourceRoute.ts`), so the generic door can
 * never be a way round a gate the historical path applied.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { TenantRole } from '../../domain/shared/types';
import { csvMatrix, htmlMatrix } from './tabularExport';
import { sheetsToXlsx, type XlsxCell } from '../office/xlsxWriter';
import { downloadResponse } from './exportDownload';

/** The canonical door every source is served from; a domain's historical path is
 *  a deprecated alias that names this as its successor. */
export const EXPORT_SOURCES_PATH = '/api/exports/sources';

export function exportSourcePath(id: string): string {
  return `${EXPORT_SOURCES_PATH}/${id}`;
}

/** The formats a tabular source can be rendered in. */
export const EXPORT_FORMATS = ['csv', 'json', 'html', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** One table: a header and positional rows. */
export interface ExportTable {
  columns: readonly string[];
  rows: ReadonlyArray<readonly unknown[]>;
  /** Sheet name in a workbook / heading in the HTML render. */
  title?: string;
}

/** What a source's `load` hands back. Rows and a name — never bytes. */
export interface ExportResult {
  /** Filename WITHOUT extension; the format supplies it. */
  filename: string;
  /** Human title for the HTML heading / default sheet name. */
  title?: string;
  /** THE table — csv, html and (absent `sheets`) xlsx are serialised from it. */
  table: ExportTable;
  /** A multi-sheet workbook, when one grid flattens what a spreadsheet should
   *  keep apart (the capitalization report's months vs. its epic evidence). */
  sheets?: readonly ExportTable[];
  /** The JSON snapshot, when the source's script-facing shape is richer than the
   *  table (kept verbatim so existing JSON consumers see no change). */
  json?: unknown;
}

/** What every source may read: the request's identity and its parameters. */
interface ExportContextBase {
  db: Db;
  env: Env;
  userId: string | null;
  /** A query-string (or route) parameter, already trimmed of nothing — raw. */
  param(name: string): string | undefined;
  /** Request time, so a filename stamp and a window agree. */
  now: number;
}

/** A workspace-scoped export. */
export interface TenantExportContext extends ExportContextBase {
  tenantId: number;
  segmentId: string;
}

/** A platform-operator export (superadmin, cross-tenant by design). */
export type PlatformExportContext = ExportContextBase;

interface ExportSourceBase {
  /** Stable id: `<domain>.<name>`, the `:id` in `/api/exports/sources/:id`. */
  id: string;
  label: string;
  /** Offered formats, first is the default. */
  formats: readonly [ExportFormat, ...ExportFormat[]];
}

export interface TenantExportSource extends ExportSourceBase {
  scope: 'tenant';
  minRole: TenantRole;
  /** Paid-plan entitlement, when the on-screen report is plan-gated too. */
  planFeature?: string;
  load(ctx: TenantExportContext, format: ExportFormat): Promise<ExportResult>;
}

export interface PlatformExportSource extends ExportSourceBase {
  scope: 'platform';
  load(ctx: PlatformExportContext, format: ExportFormat): Promise<ExportResult>;
}

export type ExportSource = TenantExportSource | PlatformExportSource;

/** `?format=` → one of the source's formats, falling back to its default. */
export function resolveExportFormat(source: ExportSource, requested: string | undefined): ExportFormat {
  return (source.formats as readonly string[]).includes(requested ?? '')
    ? requested as ExportFormat
    : source.formats[0];
}

/** Date stamp for filenames (UTC day), so a folder of downloads sorts by day. */
export function exportStamp(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** A cell the workbook writer can represent; anything structured becomes JSON
 *  text rather than `[object Object]`. */
export function toXlsxCell(value: unknown): XlsxCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function tableToSheet(table: ExportTable, fallbackTitle: string) {
  return {
    title: table.title ?? fallbackTitle,
    columns: table.columns,
    rows: table.rows.map((row) => row.map(toXlsxCell)),
  };
}

/** Serialise a result in `format` — the ONE place export bytes are produced. */
export function serializeExport(result: ExportResult, format: ExportFormat, now: number): string | Uint8Array {
  const title = result.title ?? result.filename;
  switch (format) {
    case 'csv':
      return csvMatrix(result.table.columns, result.table.rows);
    case 'html':
      return htmlMatrix(result.table.columns, result.table.rows, title);
    case 'xlsx':
      return sheetsToXlsx((result.sheets ?? [result.table]).map((t) => tableToSheet(t, title)));
    case 'json':
      return JSON.stringify(result.json ?? {
        generatedAt: new Date(now).toISOString(),
        columns: result.table.columns,
        rows: result.table.rows,
      });
  }
}

/**
 * Render a loaded result as the download response.
 *
 * JSON is answered `inline`: the historical JSON exports were `c.json(...)`
 * bodies a script reads, not files, so they stay readable in a browser tab (the
 * filename still rides along for a "Save as").
 */
export function renderExport(result: ExportResult, format: ExportFormat, now: number): Response {
  const body = serializeExport(result, format, now);
  return downloadResponse(body, {
    filename: `${result.filename}.${format}`,
    contentType: format,
    ...(format === 'json' ? { disposition: 'inline' as const } : {}),
  });
}
