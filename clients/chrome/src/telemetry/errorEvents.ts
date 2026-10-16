/**
 * Shared telemetry: Rovr's caught errors, filed into the platform's ONE error store
 * through the door every signed-in client reports through —
 * `POST /api/quality-ingest/client-report` with `source: 'chrome-extension'` (the VS Code
 * extension's `errorReporter.ts` is the same shape).
 *
 * OPT-IN, as in the editor: nothing leaves the device unless the person turned on
 * "Send error reports" in Settings. The event never carries page content or a prompt —
 * only the message, the stack, the seam it happened at and the release.
 */

/** One event as the door takes it. */
export interface ClientErrorEvent {
  type: string;
  message: string;
  stack: string | null;
  level: 'fatal' | 'error' | 'warning';
  operation: string;
  release?: string;
  timestamp: string;
  context: Record<string, unknown>;
}

/** The door takes at most 20 events a request (`MAX_CLIENT_REPORT_EVENTS`). */
export const MAX_REPORT_EVENTS = 20;
/** The settings key that allows reports to leave the device. */
export const REPORT_ERRORS_SETTING = 'settings.reportErrors';

export function errorEvent(
  error: unknown,
  details: { operation: string; level?: ClientErrorEvent['level']; context?: Record<string, unknown>; release?: string },
  now: Date = new Date(),
): ClientErrorEvent {
  return {
    type: error instanceof Error ? error.name : 'RovrError',
    message: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
    stack: error instanceof Error ? (error.stack ?? null) : null,
    level: details.level ?? 'error',
    operation: details.operation,
    ...(details.release ? { release: details.release } : {}),
    timestamp: now.toISOString(),
    context: details.context ?? {},
  };
}
