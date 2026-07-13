/**
 * Derive an honest daily trend series from a set of entity timestamps — the
 * shared bridge between "a list of rows I already fetched" and the sparkline a
 * dashboard metric card wants. No fabricated data: every point is a real count
 * of rows whose timestamp falls on (cumulative: on-or-before) that calendar day.
 *
 * Kept pure and hook-free so both the builder dashboard and the freelancer
 * dashboard reuse the exact same trend math (DRY) — never re-bucketed inline.
 */

/** Parse an ISO / epoch-ms timestamp to a finite epoch-ms, or null if unusable. */
function toMs(at: string | number | null | undefined): number | null {
  if (at == null) return null;
  const ms = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/** Start-of-day epoch for a given ms, in the runtime's local timezone. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Per-day NEW counts over the trailing `days` window (index 0 = oldest day,
 * last = today). Each value is how many timestamps landed on that calendar day.
 */
export function dailyCounts(
  timestamps: Array<string | number | null | undefined>,
  days = 14,
  now: number = Date.now(),
): number[] {
  const today = startOfDay(now);
  const buckets = new Array(days).fill(0);
  const dayMs = 86_400_000;
  for (const ts of timestamps) {
    const ms = toMs(ts);
    if (ms == null) continue;
    const idx = days - 1 - Math.floor((today - startOfDay(ms)) / dayMs);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

/**
 * Cumulative running SUM of a numeric value keyed by a timestamp over the
 * trailing `days` window — an earnings / hours-logged growth curve where each
 * row contributes its own magnitude (not just a count of 1). Values dated before
 * the window seed the starting level so the curve reflects the true total.
 */
export function cumulativeDailyTotals(
  entries: Array<{ ts: string | number | null | undefined; value: number }>,
  days = 14,
  now: number = Date.now(),
): number[] {
  const today = startOfDay(now);
  const dayMs = 86_400_000;
  const windowStart = today - (days - 1) * dayMs;
  let base = 0;
  const perDay = new Array(days).fill(0);
  for (const { ts, value } of entries) {
    if (!Number.isFinite(value)) continue;
    const ms = toMs(ts);
    if (ms == null) continue;
    const d = startOfDay(ms);
    if (d < windowStart) {
      base += value;
    } else {
      const idx = days - 1 - Math.floor((today - d) / dayMs);
      if (idx >= 0 && idx < days) perDay[idx] += value;
      else if (idx >= days) base += value;
    }
  }
  const out: number[] = [];
  let running = base;
  for (let i = 0; i < days; i++) {
    running += perDay[i];
    out.push(running);
  }
  return out;
}

/**
 * Cumulative running total over the trailing `days` window (index 0 = oldest,
 * last = today) — a rows-created growth curve. Rows created before the window
 * seed the starting level so the line reflects the true total, not just the
 * window's new arrivals.
 */
export function cumulativeDailySeries(
  timestamps: Array<string | number | null | undefined>,
  days = 14,
  now: number = Date.now(),
): number[] {
  const today = startOfDay(now);
  const dayMs = 86_400_000;
  const windowStart = today - (days - 1) * dayMs;
  let base = 0;
  const perDay = new Array(days).fill(0);
  for (const ts of timestamps) {
    const ms = toMs(ts);
    if (ms == null) continue;
    const d = startOfDay(ms);
    if (d < windowStart) {
      base += 1;
    } else {
      const idx = days - 1 - Math.floor((today - d) / dayMs);
      if (idx >= 0 && idx < days) perDay[idx] += 1;
      else if (idx >= days) base += 1; // future-dated → treat as already counted
    }
  }
  const out: number[] = [];
  let running = base;
  for (let i = 0; i < days; i++) {
    running += perDay[i];
    out.push(running);
  }
  return out;
}
