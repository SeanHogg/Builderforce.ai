/**
 * Shared Quality vocabulary + colours — one source of truth for the error
 * level/status enums and their swatch colours, so the dashboard table, the
 * charts panel and the detail drawer never re-inline a divergent map.
 */

export const LEVELS = ['fatal', 'error', 'warning', 'info'] as const;
export const STATUSES = ['unresolved', 'fixing', 'resolved', 'ignored'] as const;

/**
 * Severity is an ordinal ramp, so `fatal` gets the rung above `--error` rather
 * than a second red nobody can tell from the first. Every swatch is a token:
 * these were literals picked against dark stock, so on paper the whole legend
 * came out at one weight and severity stopped being readable at a glance.
 */
export const LEVEL_COLOR: Record<string, string> = {
  fatal: 'var(--error-strong)', error: 'var(--error)', warning: 'var(--warning)', info: 'var(--info)',
};

export const STATUS_COLOR: Record<string, string> = {
  unresolved: 'var(--error)', fixing: 'var(--violet-bright)', resolved: 'var(--success)', ignored: 'var(--text-muted)',
};

/** Ingest sources (must mirror api qualitySourceCatalog ids) → swatch colours. */
export const SOURCE_COLOR: Record<string, string> = {
  native: 'var(--coral-bright)', otlp: 'var(--cyan-bright)', sentry: 'var(--violet-bright)',
  posthog: 'var(--amber-bright)', logrocket: 'var(--pink-bright)',
};

/** The unknown value reads as metadata, which is exactly what `--text-muted` is. */
const UNKNOWN = 'var(--text-muted)';

export const levelColor = (level: string): string => LEVEL_COLOR[level] ?? UNKNOWN;
export const statusColor = (status: string): string => STATUS_COLOR[status] ?? UNKNOWN;
export const sourceColor = (source: string): string => SOURCE_COLOR[source] ?? UNKNOWN;
