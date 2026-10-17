import type { Formatter } from '@/i18n/format';

/**
 * Clock time for a message sent today, calendar date for anything older.
 *
 * Takes the formatter rather than reaching for one: this is module scope, where a
 * hook cannot run, and the alternative — `toLocaleTimeString()` with no locale —
 * is the browser's language rather than the reader's.
 */
export function formatTime(fmt: Formatter, ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmt.time(d);
  return fmt.dateWith(d, { month: 'short', day: 'numeric' });
}
