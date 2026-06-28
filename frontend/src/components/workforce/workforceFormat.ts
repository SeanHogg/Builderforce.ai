import type { MemberKind, EngagementLevel } from '@/lib/builderforceApi';

/**
 * Shared presentation helpers for workforce performance/engagement surfaces.
 * Score colouring and the engagement level scales were duplicated across the
 * Performance scorecards, the Engagement table, and the per-member card stats
 * strip — this is the single source so every surface reads identically.
 */

/** Hours → compact human duration (45m / 3.2h / 1.5d). */
export function fmtHrs(n: number | null): string {
  if (n == null) return '—';
  if (n < 1) return `${Math.round(n * 60)}m`;
  if (n < 48) return `${n.toFixed(1)}h`;
  return `${(n / 24).toFixed(1)}d`;
}

/** 0–100 score → rounded string, or em-dash when unknown. */
export function fmtScore(n: number | null): string {
  return n == null ? '—' : String(Math.round(n));
}

/** Traffic-light colour for a 0–100 score (≥75 green, ≥50 amber, else red). */
export function scoreColor(n: number | null): string {
  if (n == null) return 'var(--muted)';
  if (n >= 75) return 'var(--success, #30a46c)';
  if (n >= 50) return 'var(--warning, #f5a623)';
  return 'var(--danger, #e5484d)';
}

/** member_kind → fallback English label (callers localize where a catalog exists). */
export const MEMBER_KIND_LABEL: Record<MemberKind, string> = {
  human: 'Human', cloud_agent: 'Cloud agent', host_agent: 'Host agent',
};

export const ENGAGEMENT_LEVEL_COLOR: Record<EngagementLevel, string> = {
  inactive: 'var(--muted)',
  low: 'var(--danger, #e5484d)',
  moderate: 'var(--warning, #f5a623)',
  high: 'var(--accent, #6366f1)',
  very_high: 'var(--success, #30a46c)',
};

/** Order of engagement levels (low → high) for any scale/legend rendering. */
export const ENGAGEMENT_LEVELS: EngagementLevel[] = ['inactive', 'low', 'moderate', 'high', 'very_high'];
