/**
 * Shared Quality vocabulary + colours — one source of truth for the error
 * level/status enums and their swatch colours, so the dashboard table, the
 * charts panel and the detail drawer never re-inline a divergent map.
 */

export const LEVELS = ['fatal', 'error', 'warning', 'info'] as const;
export const STATUSES = ['unresolved', 'fixing', 'resolved', 'ignored'] as const;

export const LEVEL_COLOR: Record<string, string> = {
  fatal: '#b91c1c', error: '#dc2626', warning: '#d97706', info: '#2563eb',
};

export const STATUS_COLOR: Record<string, string> = {
  unresolved: '#ef4444', fixing: '#7c3aed', resolved: '#16a34a', ignored: '#6b7280',
};

export const levelColor = (level: string): string => LEVEL_COLOR[level] ?? '#6b7280';
export const statusColor = (status: string): string => STATUS_COLOR[status] ?? '#6b7280';
