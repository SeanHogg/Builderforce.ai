import type { Formatter } from '@/i18n/format';

/**
 * Date formatting helper for task management - formats an optional ISO date
 * string to a human-readable short date.
 */
export function formatTaskDate(fmt: Formatter, d?: string | null): string {
  if (!d) return '';
  return fmt.dateWith(d, { month: 'short', day: 'numeric' });
}
