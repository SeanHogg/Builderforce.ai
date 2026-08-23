/**
 * Shared tabular export — THE CSV and HTML serialisers for the api.
 *
 *   - {@link csvMatrix}  header + value matrix. The primitive: every CSV this
 *                        codebase emits is escaped by this one function.
 *   - {@link toCsv}      the record-shaped convenience over it, for callers holding
 *                        `Record<string, unknown>` rows and wanting columns inferred.
 *   - {@link toHtmlTable} a self-contained HTML table that Excel and any browser's
 *                        print-to-PDF open cleanly (inline styles, no external CSS).
 *
 * ── WHY THE ESCAPING LIVES IN EXACTLY ONE FUNCTION ──────────────────────────
 * It had been written four times — here, in `metrics/metricsCsv`, in
 * `finops/auditReport` and in `insights/complianceInsights` — as the same one-line
 * `esc` closure, each claiming "RFC-4180-ish" in its own comment. Four copies of a
 * quoting rule is four chances for one of them to stop quoting a newline, and the
 * symptom is a corrupt file in somebody's accountant's spreadsheet rather than an
 * error anybody here would see. All four now call {@link csvMatrix}; each report
 * module keeps its own COLUMN choices, which is the part that is genuinely its own.
 *
 * `toCsv` accepts a uniform row shape (an array of string-keyed records). Columns
 * are the explicit `columns` list when given, else the union of keys across rows
 * (first appearance order) so a caller can pass heterogeneous rows without
 * pre-aligning.
 */

export type ExportRow = Record<string, unknown>;

/** Resolve the ordered column list: explicit, or the union of row keys. */
function resolveColumns(rows: ExportRow[], columns?: string[]): string[] {
  if (columns && columns.length) return columns;
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!set.has(k)) { set.add(k); seen.push(k); }
  return seen;
}

/** Render a cell value to a flat string (null/undefined → empty; objects → JSON). */
function cell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Serialise a header and a value matrix to CSV. THE escaping, for the whole api.
 *
 * Every value is quoted and internal quotes are doubled, so an embedded comma,
 * quote or newline is safe and a spreadsheet opens the file directly. Quoting
 * unconditionally rather than only when a value needs it is deliberate: a
 * conditional quoter is a branch that can be wrong, and the file is a few bytes
 * larger for it.
 */
export function csvMatrix(header: readonly unknown[], rows: ReadonlyArray<readonly unknown[]>): string {
  const esc = (v: unknown) => `"${cell(v).replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(esc).join(',')).join('\n');
}

/** Serialise record-shaped rows to CSV, inferring the columns when not given. */
export function toCsv(rows: ExportRow[], columns?: string[]): string {
  const cols = resolveColumns(rows, columns);
  return csvMatrix(cols, rows.map((r) => cols.map((c) => r[c])));
}

/** Escape a value for safe HTML text content. */
function htmlEscape(v: unknown): string {
  return cell(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface HtmlTableOptions {
  title?: string;
  columns?: string[];
  /** Optional human column labels keyed by column id (falls back to the id). */
  columnLabels?: Record<string, string>;
}

/**
 * Serialise rows to a complete, self-contained HTML document with one styled table.
 * Excel opens it as a spreadsheet and browsers print-to-PDF it cleanly. All styles
 * are inline/`<style>` (no external assets), so it is safe to email or download.
 */
export function toHtmlTable(rows: ExportRow[], opts: HtmlTableOptions = {}): string {
  const cols = resolveColumns(rows, opts.columns);
  const label = (c: string) => htmlEscape(opts.columnLabels?.[c] ?? c);
  const title = htmlEscape(opts.title ?? 'Export');

  const thead = `<tr>${cols.map((c) => `<th>${label(c)}</th>`).join('')}</tr>`;
  const tbody = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${htmlEscape(r[c])}</td>`).join('')}</tr>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #d0d0d0; padding: 6px 10px; text-align: left; }
  thead th { background: #f2f2f2; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafafa; }
</style></head>
<body>
  <h1>${title}</h1>
  <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
</body></html>`;
}

/** Content-Type + filename extension for a chosen format (shared by the routes). */
export function exportContentMeta(format: 'csv' | 'html'): { contentType: string; ext: string } {
  return format === 'html'
    ? { contentType: 'text/html; charset=utf-8', ext: 'html' }
    : { contentType: 'text/csv; charset=utf-8', ext: 'csv' };
}
