/**
 * Incident-triage run marker — the ONE place the "this run is the Incident Manager
 * triaging an incident" signal is defined, so the dispatcher that stamps it
 * (incidentDispatch) and the runtime that steers on it (cloudAgentEngine) agree
 * without an import cycle.
 *
 * A triage run works an already-open incident's board ticket: classify the affected
 * system, page/escalate on-call, and post war-room updates via the `incidents.*` /
 * `oncall.*` tools — it does NOT ship code. The runtime injects a dedicated
 * instruction block for these runs (mirroring the Validator review marker).
 */

/** Distinct lane key stamped on an incident-triage dispatch (never a real board lane). */
export const INCIDENT_TRIAGE_LANE_KEY = '__incident_triage__';

/** True when an execution payload marks it as an incident-triage run. */
export function isIncidentTriagePayload(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    const obj = JSON.parse(payload) as { laneKey?: unknown; incidentTriage?: unknown };
    return obj.incidentTriage === true || obj.laneKey === INCIDENT_TRIAGE_LANE_KEY;
  } catch {
    return false;
  }
}

/** The incidentId carried on a triage payload, when present. */
export function incidentIdFromPayload(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload) as { incidentId?: unknown };
    return typeof obj.incidentId === 'string' ? obj.incidentId : null;
  } catch {
    return null;
  }
}
