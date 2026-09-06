/**
 * Reporting periods from untrusted input — the ONE reading of `?period=` and
 * `?fy=`, and the one spelling of "this month" as `YYYY-MM`.
 *
 * `currentPeriodMonth` was written five times (two route files, three insight
 * modules) and the two query readers twice each. Pure and dependency-free, so
 * both presentation and application code read a period from here without one
 * importing the other — the same reason `boundedInt.ts` sits in this folder.
 */

/** `YYYY-MM` for the UTC month `now` falls in. */
export function currentPeriodMonth(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `?period=YYYY-MM`, or the current month when absent or malformed. */
export function periodParam(raw: unknown, now: number): string {
  return typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw) ? raw : currentPeriodMonth(now);
}

/** `?fy=` as a 4-digit year in 2000..2100, or the current UTC year. */
export function fiscalYearParam(raw: unknown, now: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : new Date(now).getUTCFullYear();
}
