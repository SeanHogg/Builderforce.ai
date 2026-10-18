/**
 * Shared tabular export — THE CSV and HTML serialisers for the api.
 *
 *   - {@link csvMatrix}  header + value matrix. The primitive: every CSV this
 *                        codebase emits is escaped by this one function.
 *   - {@link htmlMatrix} its positional twin: a self-contained HTML table that
 *                        Excel and any browser's print-to-PDF open cleanly (inline
 *                        styles, no external CSS).
 *
 * These are the SERIALISERS. Which rows go in a download, and how the download is
 * answered (format choice, filename, headers), is `exportSource.ts` — every
 * domain registers a source there and `serializeExport` calls these, so no report
 * module builds a CSV string or a response of its own.
 *
 * ── WHY THE ESCAPING LIVES IN EXACTLY ONE FUNCTION ──────────────────────────
 * It had been written four times — here, in `metrics/metricsCsv` (now
 * `memberMetricsExport`), in `finops/auditReport` and in
 * `insights/complianceInsights` — as the same one-line `esc` closure, each
 * claiming "RFC-4180-ish" in its own comment, and twice more by hand in route
 * files (the operator audit log, the CapEx/OpEx spine). Copies of a quoting rule
 * are chances for one of them to stop quoting a newline, and the symptom is a
 * corrupt file in somebody's accountant's spreadsheet rather than an error
 * anybody here would see. Each report module now returns only its COLUMNS and
 * rows, which is the part that is genuinely its own.
 *
 * The record-shaped `toCsv` / `toHtmlTable` conveniences went with the last
 * caller that held record rows (the EMP-20 dataset export, now a positional
 * export source).
 */
import { escapeHtml } from '@builderforce/creation-canvas-contract';

/** Render a cell value to a flat string (null/undefined → empty; dates → ISO;
 *  other objects → JSON). A Date must not reach `JSON.stringify`, which would
 *  wrap it in literal quotes. */
function cell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
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

/** Escape a cell value for safe HTML text content. */
const htmlEscape = (v: unknown): string => escapeHtml(cell(v));

/**
 * Serialise a header and a value matrix to a complete, self-contained HTML
 * document with one styled table. THE HTML writer: Excel opens it as a
 * spreadsheet and browsers print-to-PDF it cleanly. All styles are inline/
 * `<style>` (no external assets), so it is safe to email or download.
 */
export function htmlMatrix(header: readonly unknown[], rows: ReadonlyArray<readonly unknown[]>, title = 'Export'): string {
  const safeTitle = htmlEscape(title);
  const thead = `<tr>${header.map((c) => `<th>${htmlEscape(c)}</th>`).join('')}</tr>`;
  const tbody = rows
    .map((r) => `<tr>${header.map((_c, i) => `<td>${htmlEscape(r[i])}</td>`).join('')}</tr>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #d0d0d0; padding: 6px 10px; text-align: left; }
  thead th { background: #f2f2f2; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafafa; }
</style></head>
<body>
  <h1>${safeTitle}</h1>
  <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
</body></html>`;
}
