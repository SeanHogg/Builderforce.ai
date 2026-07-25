'use client';

/**
 * diagnosticsCapture — the ONE way a surface stamps a diagnostics report.
 *
 * Split from the pure {@link ./diagnosticsReport} builders on purpose: this is the impure
 * half (the clock, `window.location`, the cached `/health` lookup), and it exists so two
 * "Copy diagnostics" buttons cannot end up stamping their captures differently — which is
 * exactly what happened before: the ticket-lifecycle button reported `apiVersion: (none)`
 * on every capture because it only ever passed the UI build, making a report unable to
 * say which API served the data it is complaining about.
 *
 * Never throws and never blocks a capture: an unreachable `/health` resolves to null and
 * the report says `apiVersion: (none)` honestly.
 */
import { APP_VERSION, fetchApiVersion } from '@/lib/appVersions';
import type { DiagnosticsContext } from '@/lib/diagnosticsReport';

export async function captureDiagnosticsContext(): Promise<DiagnosticsContext> {
  return {
    uiVersion: APP_VERSION,
    apiVersion: await fetchApiVersion().catch(() => null),
    capturedAt: new Date().toISOString(),
    sourceUrl: typeof window === 'undefined' ? null : window.location.href,
  };
}
