/**
 * BindingResolver — map a template's {{token}} manifest onto values from the
 * assembled {@link DeckData}. Pure (no I/O) so it is unit-testable. A binding that
 * resolves to null/undefined falls back to '—' (or its declared fallback) AND adds
 * a warning, so the deck always renders and the user sees what data was missing.
 */

import type { DeckData, TokenManifest, ResolvedBindings, ResolvedValue, BindingFormat } from './types';

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
 * Resolve every binding in the manifest against the data bundle. Returns a token→
 * value map plus a list of human-readable warnings for missing data.
 */
export function resolveBindings(manifest: TokenManifest, data: DeckData): ResolvedBindings {
  const byToken = new Map<string, ResolvedValue>();
  const warnings: string[] = [];

  for (const b of manifest.bindings ?? []) {
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
