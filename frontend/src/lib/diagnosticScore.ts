/**
 * Shared diagnostic-score helpers — the SINGLE source for mapping a 1–5
 * diagnostic maturity score to the project palette, so the maturity bar
 * (ProjectInspection), the project-card diagnostics strip, and the analytics
 * gauges all colour a SOC 2 / Quality / … score identically.
 */

import { healthTierColor } from './projectHealth';

/** Map a 1–5 diagnostic score to a tier colour. Higher is better. The colours are
 *  the project-health tiers' — one palette, owned by `projectHealth`. */
export function diagnosticScoreColor(score: number): string {
  if (score >= 4) return healthTierColor('healthy');
  if (score >= 3) return healthTierColor('watch');
  if (score >= 2) return healthTierColor('at_risk');
  return healthTierColor('critical');
}

/** SOC 2 audit id — surfaced first in diagnostic strips (compliance is the
 *  headline signal buyers ask about). Mirrors the backend SOC2_AUDIT_ID. */
export const SOC2_AUDIT_ID = 'soc2-audit';

/** Order diagnostics for display: SOC 2 first (the compliance headline), then by
 *  score (lowest first — the ones needing attention lead), then by name. */
export function orderDiagnostics<T extends { toolId: string; score: number | null; name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.toolId === SOC2_AUDIT_ID) return -1;
    if (b.toolId === SOC2_AUDIT_ID) return 1;
    return (a.score ?? 99) - (b.score ?? 99) || a.name.localeCompare(b.name);
  });
}
