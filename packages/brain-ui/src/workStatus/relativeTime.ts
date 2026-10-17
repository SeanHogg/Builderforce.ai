/**
 * "in 14 days" / "in 3 hours" for a future ISO time, in the reader's locale — `Intl`
 * does the wording, so no host has to translate a unit suffix by hand.
 */
export function relativeFuture(iso: string | undefined, locale?: string, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return null;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
