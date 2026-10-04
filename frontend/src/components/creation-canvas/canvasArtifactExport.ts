import type { CreationNodeData } from './types';
import { tabularFromObject } from '@/lib/canvasTabularData';
import { maskTabular, normalizeClassifications } from '@/lib/canvasDataGovernance';
import { unmaskedSensitiveColumns } from '@/lib/canvasTestData';

/** Serialize one trace arg/result for the diagnostics report. A trace payload can
 *  hold a cyclic React value or a very large tool result, and the report that
 *  explains a failure must never be the thing that throws while producing it. */
export function safeTraceJson(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text === undefined ? '(unserializable)' : text.slice(0, 400);
  } catch {
    return '(unserializable)';
  }
}

export function safeDownloadName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'creation';
}

/**
 * The rows an object holds, in the positional shape BOTH the CSV writer and the
 * .xlsx writer index by.
 *
 * One derivation — `tabularFromObject`, the same one the sheet card renders from
 * — so an exported file can never disagree with what is on screen. This used to
 * re-read `data.rows`/`data.columns` by hand, which is why a dataset carrying
 * `sampleRows` rendered on the card and then exported as "no rows".
 */
export function artifactSheet(data: CreationNodeData): { columns: string[]; rows: Array<Array<string | number | null>>; unmasked: string[] } | null {
  const raw = tabularFromObject(data as Record<string, unknown>);
  if (!raw.columns.length) return null;
  // Masked through the SAME rule the card renders through, so a file can never show
  // a value the board starred. The columns the classifier found and nobody masked
  // come back too — an export is refused rather than silently leaking them.
  const classifications = normalizeClassifications(data.classifications);
  const source = maskTabular(raw, classifications);
  const rows = source.rows.map((row) => source.columns.map((column) => {
    const value = row[column];
    if (value == null) return null;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
  }));
  return { columns: source.columns, rows, unmasked: unmaskedSensitiveColumns(classifications) };
}

/**
 * The sheet an export may write, or the error that says why it may not: no rows at
 * all, or a personal column the classifier found that nobody masked. The second is
 * the privacy guard the classify tool promises ("masked on render and export") and
 * the reason `unmaskedSensitiveColumns` exists.
 */
export function exportableSheet(
  data: CreationNodeData,
  refuse: { noRows: () => Error; unmasked: (columns: string[]) => Error },
): NonNullable<ReturnType<typeof artifactSheet>> {
  const sheet = artifactSheet(data);
  if (!sheet) throw refuse.noRows();
  if (sheet.unmasked.length) throw refuse.unmasked(sheet.unmasked);
  return sheet;
}
