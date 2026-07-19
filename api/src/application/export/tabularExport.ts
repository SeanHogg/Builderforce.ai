/**
 * Shared tabular export (EMP-20) — dependency-free CSV + HTML serialisers used by
 * the insights Export menu and by scheduled report deliveries.
 *
 *   - {@link toCsv}      RFC-4180-ish CSV (values quoted + escaped). Mirrors the
 *                        compliance evidence-pack CSV so there is one CSV style.
 *   - {@link toHtmlTable} a self-contained HTML table that Excel and any browser's
 *                        print-to-PDF open cleanly (inline styles, no external CSS).
 *
 * Both accept a uniform row shape (an array of string-keyed records). Columns are
 * the explicit `columns` list when given, else the union of keys across rows (first
 * appearance order) so a caller can pass heterogeneous rows without pre-aligning.
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

/** Serialise rows to CSV. Every value is quoted and internal quotes are doubled. */
export function toCsv(rows: ExportRow[], columns?: string[]): string {
  const cols = resolveColumns(rows, columns);
  const esc = (v: unknown) => `"${cell(v).replace(/"/g, '""')}"`;
  const header = cols.map(esc).join(',');
  const lines = rows.map((r) => cols.map((c) => esc(r[c])).join(','));
  return [header, ...lines].join('\n');
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
