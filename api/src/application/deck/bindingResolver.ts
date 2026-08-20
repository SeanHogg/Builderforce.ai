/**
 * BindingResolver — map a template's {{token}} manifest onto values from the
 * assembled {@link DeckData}. Pure (no I/O) so it is unit-testable. A binding that
 * resolves to null/undefined falls back to '—' (or its declared fallback) AND adds
 * a warning, so the deck always renders and the user sees what data was missing.
 */

import type { DeckData, TokenManifest, ResolvedBindings, ResolvedValue, BindingFormat, TokenBinding, ChartSeries } from './types';

/** Walk a dot-path (`quality.uptimePct`) into a nested object; undefined if absent. */
function dig(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

/** Format a scalar for text injection. */
export function formatValue(raw: unknown, format: BindingFormat | undefined): string {
  if (raw == null || raw === '') return '';
  if (format === 'currency') {
    const n = Number(raw);
    return Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : String(raw);
  }
  if (format === 'percent') {
    const n = Number(raw);
    return Number.isFinite(n) ? `${n}%` : String(raw);
  }
  if (format === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : String(raw);
  }
  if (format === 'date') {
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? String(raw) : d.toISOString().slice(0, 10);
  }
  return String(raw);
}

/**
 * Parse a cell that a table renders as text but a chart has to plot. The deck's
 * assembled matrices are already display-formatted (`"$12,400"`, `"87%"`,
 * `"(1,200)"`), so a chart binding has to undo that rather than demand a second,
 * parallel numeric shape of the same data.
 *
 * An unparseable cell becomes `null` — a gap in the plot — never 0. A quarter
 * with no figure and a quarter that spent nothing are different statements, and
 * a board deck that draws them identically is the reason this returns null.
 */
export function parseNumericCell(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()]/g, '').replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/**
 * Turn a bound `string[][]` matrix into plottable series. Column 0 is the category
 * axis; the declared `chartSeries` columns (or every remaining column) become the
 * plotted series.
 */
export function matrixToChart(rows: string[][], binding: TokenBinding): ChartSeries {
  const categories = rows.map((r) => String(r?.[0] ?? ''));
  const width = rows.reduce((max, r) => Math.max(max, r?.length ?? 0), 0);
  const columns = binding.chartSeries?.length
    ? binding.chartSeries
    : Array.from({ length: Math.max(0, width - 1) }, (_, i) => ({ column: i + 1, name: `Series ${i + 1}` }));

  return {
    categories,
    series: columns.map((col) => ({
      name: col.name,
      values: rows.map((r) => parseNumericCell(r?.[col.column])),
    })),
  };
}

/**
 * Resolve every binding in the manifest against the data bundle. Returns a token→
 * value map plus a list of human-readable warnings for missing data.
 */
export function resolveBindings(manifest: TokenManifest, data: DeckData): ResolvedBindings {
  const byToken = new Map<string, ResolvedValue>();
  const warnings: string[] = [];

  for (const b of manifest.bindings ?? []) {
    if (b.kind === 'chart') {
      const raw = dig(data, b.bindingKey);
      const rows = Array.isArray(raw)
        ? (raw as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? '')))
        : [];
      const chart = matrixToChart(rows, b);
      const hasPoint = chart.series.some((s) => s.values.some((v) => v != null));
      if (!hasPoint) warnings.push(`No plottable numbers for chart "${b.token}" (${b.bindingKey}) — it keeps its uploaded figures.`);
      byToken.set(b.token, { kind: 'chart', label: b.fallback ?? b.token, ...chart });
      continue;
    }
    if (b.kind === 'table') {
      const raw = dig(data, b.bindingKey);
      const rows = Array.isArray(raw) ? (raw as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r ?? '')])) : [];
      if (rows.length === 0) warnings.push(`No data for "${b.token}" (${b.bindingKey}).`);
      byToken.set(b.token, { kind: 'table', rows });
      continue;
    }
    if (b.kind === 'image') {
      const raw = dig(data, b.bindingKey);
      if (typeof raw === 'string' && raw) byToken.set(b.token, { kind: 'image', r2Key: raw });
      else { byToken.set(b.token, { kind: 'text', value: b.fallback ?? '—' }); warnings.push(`No image for "${b.token}".`); }
      continue;
    }
    // text
    const raw = dig(data, b.bindingKey);
    if (raw == null || raw === '') {
      byToken.set(b.token, { kind: 'text', value: b.fallback ?? '—' });
      warnings.push(`Missing "${b.token}" (${b.bindingKey}) — using ${b.fallback ?? '—'}.`);
    } else {
      byToken.set(b.token, { kind: 'text', value: formatValue(raw, b.format) });
    }
  }

  return { byToken, warnings };
}
