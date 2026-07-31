/**
 * escalationSlaClock — visual + functional SLA clock for governance escalations.
 *
 * PRD deliverable: "Escalation SLA Clock" (backend side). Frontend draws the clock
 * from frontend/src/components/escalation/EscalationSlaClock which consumes the DTO
 * produced here.
 *
 * Responsibility: business-day date math (weekends do not count — FR.2 says
 * "business days"), plus remaining-time token computation and clock SVG payload.
 */

export type SlaClockState = 'on_track' | 'warning_24h' | 'urgent_4h' | 'breached' | 'resolved';
export type BusinessDate = Date;

export const BUSINESS_HOURS_WEEKDAYS = new Set<number>([1, 2, 3, 4, 5]); // Mon..Fri

export function isBusinessDay(d: Date): boolean {
  return BUSINESS_HOURS_WEEKDAYS.has(d.getUTCDay());
}

/**
 * Add N business days to a start date, skipping Sat/Sun. The start day itself
 * is NOT counted — day 1 is the next business day after start (same semantics
 * as "3 business days from now" in governance).
 */
export function addBusinessDays(start: Date, businessDays: number): Date {
  if (businessDays <= 0) return new Date(start.getTime());
  let d = new Date(start.getTime());
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(d)) added += 1;
  }
  // preserve the time-of-day from start (the SLA deadline is same wall time on the Nth business day)
  return d;
}

/**
 * FR.2: SLA = 3 business days per escalation level (configurable per level).
 * Compute deadline from a trigger timestamp + slaDays (business days) using the rule above.
 */
export function computeSlaDeadline(triggeredAt: Date, slaDays: number, useBusinessDays: boolean): Date {
  if (useBusinessDays !== false) {
    return addBusinessDays(triggeredAt, slaDays);
  }
  const oneDayMs = 24 * 60 * 60 * 1000;
  return new Date(triggeredAt.getTime() + slaDays * oneDayMs);
}

export type SlaClockDto = {
  slaDeadline: string; // ISO
  now: string; // server ISO so the frontend can correct skew
  remainingMs: number; // <0 when breached
  remainingMinutes: number;
  remainingLabel: string; // e.g. "2d 5h", "3h 12m", "breached by 1d 2h"
  /** 0..1 fraction remaining of the original SLA window (0=expired, 1=not started). Null when original not known. */
  fractionRemaining: number | null;
  state: SlaClockState;
  /** For a progress-ring rendering: degrees remaining (0..360). */
  ringDegrees: number;
};

function humanRemaining(ms: number): string {
  const sign = ms < 0 ? -1 : 1;
  const abs = Math.abs(ms);
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const minMs = 60 * 1000;
  const d = Math.floor(abs / dayMs);
  const h = Math.floor((abs - d * dayMs) / hourMs);
  const m = Math.floor((abs - d * dayMs - h * hourMs) / minMs);
  const pieces: string[] = [];
  if (d > 0) pieces.push(`${d}d`);
  if (h > 0 || d > 0) pieces.push(`${h}h`);
  // always show minutes when <1d remaining, or when 0d0h
  if (m > 0 || pieces.length === 0) pieces.push(`${m}m`);
  const s = pieces.slice(0, 2).join(' ');
  return sign < 0 ? `breached by ${s}` : s;
}

export function buildSlaClockDto(args: {
  slaDeadline: Date;
  now?: Date;
  originalWindowMs?: number | null; // ms from level start → deadline; optional
  resolved?: boolean;
}): SlaClockDto {
  const now = args.now ?? new Date();
  const deadline = args.slaDeadline;
  const remainingMs = deadline.getTime() - now.getTime();
  const remainingMinutes = Math.floor(remainingMs / 60_000);
  let state: SlaClockState;
  if (args.resolved) state = 'resolved';
  else if (remainingMs < 0) state = 'breached';
  else if (remainingMs <= 4 * 60 * 60 * 1000) state = 'urgent_4h';
  else if (remainingMs <= 24 * 60 * 60 * 1000) state = 'warning_24h';
  else state = 'on_track';

  const windowMs = args.originalWindowMs ?? null;
  let fractionRemaining: number | null = null;
  let ringDegrees = 0;
  if (windowMs && windowMs > 0) {
    fractionRemaining = Math.max(0, Math.min(1, remainingMs / windowMs));
    ringDegrees = 360 * Math.max(0, 1 - fractionRemaining);
  } else {
    // Without a window, fall back to a simple fixed 3-day gauge
    const fallbackMs = 3 * 24 * 60 * 60 * 1000;
    fractionRemaining = remainingMs < 0 ? 0 : Math.max(0, Math.min(1, remainingMs / fallbackMs));
    ringDegrees = 360 * Math.max(0, 1 - (fractionRemaining ?? 0));
  }

  return {
    slaDeadline: deadline.toISOString(),
    now: now.toISOString(),
    remainingMs,
    remainingMinutes,
    remainingLabel: humanRemaining(remainingMs),
    fractionRemaining,
    state,
    ringDegrees,
  };
}
