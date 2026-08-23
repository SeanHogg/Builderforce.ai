/**
 * Incident severity as the UI reads it — the order it is offered in, and the
 * badge each level wears.
 *
 * One module because both halves of Reliability declared it: `IncidentsPageClient`
 * and `MonitoringSections` each carried a byte-identical `SEVERITIES` array and
 * `SEVERITY_BADGE` map. They are two tabs of ONE page — a monitor's severity IS
 * the severity of the incident it opens — so a sev2 that is orange on the
 * Incidents tab and something else on Monitors would be the same fact rendered
 * two ways on one screen.
 *
 * `lib/` rather than `components/`: this is domain vocabulary with a
 * presentation mapping, not a component, and the escalation policy editor reads
 * the same order without rendering a badge at all.
 */

import type { IncidentSeverity } from '../builderforceApi';

/** Most severe first — the order every severity picker offers. */
export const SEVERITIES: IncidentSeverity[] = ['sev1', 'sev2', 'sev3', 'sev4'];

/** The badge class each level wears. */
export const SEVERITY_BADGE: Record<IncidentSeverity, string> = {
  sev1: 'badge-red',
  sev2: 'badge-orange',
  sev3: 'badge-amber',
  sev4: 'badge-blue',
};
