import { StartOfDay, DaysBetween } from '../../../infra/date-utils';

/** Default warning buffer logic */
export function getDefaultWarningBuffer(startDate: Date, endDate: Date): number {
  const durationDays = DaysBetween(startDate, endDate);
  // Either 10% of total duration or 5 business days, whichever is greater
  const bufferDays = durationDays * 0.1;
  const daysBuffer = Math.max(bufferDays, 5);
  return Math.ceil(daysBuffer);
}

/** Compute health status in a pure, testable way; no external services. */
export function computeHealthStatus(
  deadline: {
    targetDate: Date;
    // todo: add forecast starter once we start ingesting forecasts
    forecast?: Date | null;
    /** Uses warning buffer unless there is a manually overridden status */
    healthOverride: ('on_track' | 'at_risk' | 'off_track' | 'missed') | null;
  },
  options?: {
    /** Override buffer window in days; if not provided, use default (10% duration or 5d). */
    warningBuffer?: number;
  },
): DeadlineStatus {
  const now = StartOfDay(new Date());
  const targetEnd = StartOfDay(deadline.targetDate);
  const forecastEnd = deadline.forecast ? StartOfDay(deadline.forecast) : null;

  // Manual override must be respected.
  if (deadline.healthOverride) {
    return deadline.healthOverride;
  }

  // Missed: target date already passed without a forecast that lands on or before the target.
  if (now.getTime() > targetEnd.getTime()) {
    // Only consider it missed if there is no valid forecast on/after target (or forecast not yet known)
    if (!forecastEnd || forecastEnd.getTime() > targetEnd.getTime()) {
      return 'missed';
    }
  }

  // Off track: forecast landing after target (and on/after now).
  if (forecastEnd && forecastEnd.getTime() > targetEnd.getTime() && now.getTime() <= targetEnd.getTime()) {
    return 'off_track';
  }

  // At risk: forecast within warning buffer of target (default 10% duration or 5 business days, whichever is larger).
  const bufferDays = Math.max(deadline.healthOverride ? 0 : (options?.warningBuffer ?? getDefaultWarningBuffer(targetEnd, now < targetEnd ? deadline.targetDate : now)), 0);
  const bufferStart = targetEnd.getTime() - bufferDays * 86_400_000;
  const bufferEnd = targetEnd.getTime();

  if (
    forecastEnd &&
    forecastEnd.getTime() >= bufferStart &&
    forecastEnd.getTime() <= bufferEnd &&
    now.getTime() <= targetEnd.getTime()
  ) {
    return 'at_risk';
  }

  // Default: on track if we haven't determined off_track or missed yet.
  return 'on_track';
}