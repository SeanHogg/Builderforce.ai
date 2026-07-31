/**
 * EMP-16 — High / low-performer flagging + coaching.
 *
 * Derives a performer TIER for every member from the effectiveness/engagement
 * scores the workforce scorecard already computes ({@link computeMemberMetrics}),
 * ranked as a PERCENTILE within the member's builder discipline so a QA engineer is
 * compared to QA, not to backend (fairer than one global ranking). A composite
 * (effectiveness, blended with engagement when present) drives the ranking.
 *
 * Tiers: `high` (top of the discipline), `solid` (the healthy middle), `watch`
 * (a coaching candidate). The route pairs each row with the member's coaching
 * notes (migration 0311). {@link assignTiers} is pure for unit testing.
 */
import type { Db } from '../../infrastructure/database/connection';
import { computeMemberMetrics, type MemberKind, type MemberScorecard } from './workforceMetrics';

export type PerformerTier = 'high' | 'solid' | 'watch';

export interface PerformerRow {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  discipline: string | null;
  effectivenessScore: number | null;
  engagementScore: number | null;
  /** effectiveness blended with engagement (0..100) — the ranking basis. */
  composite: number;
  /** 0..100 rank within the member's discipline (100 = strongest). */
  percentile: number;
  tier: PerformerTier;
}

/** Effectiveness, blended with engagement when the member has one (humans). */
function compositeOf(c: MemberScorecard): number {
  const eff = c.effectivenessScore ?? 0;
  if (c.engagementScore == null) return eff;
  return 0.7 * eff + 0.3 * c.engagementScore;
}

/**
 * Pure: assign a percentile + tier to each scorecard, ranked within its discipline.
 * Groups with ≥4 members tier by percentile (top 25% high, bottom 25% watch); tiny
 * groups fall back to absolute composite thresholds so a 1-person discipline isn't
 * auto-labelled. Sorted high→watch, then composite desc.
 */
export function assignTiers(cards: MemberScorecard[]): PerformerRow[] {
  const byDiscipline = new Map<string, MemberScorecard[]>();
  for (const c of cards) {
    const d = c.discipline ?? 'unassigned';
    const bucket = byDiscipline.get(d) ?? [];
    bucket.push(c);
    byDiscipline.set(d, bucket);
  }

  const rows: PerformerRow[] = [];
  for (const [discipline, group] of byDiscipline) {
    const scored = group.map((c) => ({ c, composite: compositeOf(c) })).sort((a, b) => a.composite - b.composite);
    const n = scored.length;
    scored.forEach(({ c, composite }, i) => {
      const percentile = n <= 1 ? 100 : Math.round((i / (n - 1)) * 100);
      let tier: PerformerTier;
      if (n >= 4) {
        tier = percentile >= 75 ? 'high' : percentile < 25 ? 'watch' : 'solid';
      } else {
        tier = composite >= 75 ? 'high' : composite < 50 ? 'watch' : 'solid';
      }
      rows.push({
        memberKind: c.memberKind,
        memberRef: c.memberRef,
        name: c.memberName,
        discipline: discipline === 'unassigned' ? null : discipline,
        effectivenessScore: c.effectivenessScore,
        engagementScore: c.engagementScore,
        composite: Math.round(composite),
        percentile,
        tier,
      });
    });
  }

  const tierRank: Record<PerformerTier, number> = { high: 0, solid: 1, watch: 2 };
  return rows.sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || b.composite - a.composite || a.name.localeCompare(b.name));
}

export interface PerformerTiersResult {
  windowDays: number;
  members: PerformerRow[];
  counts: Record<PerformerTier, number>;
}

export async function computePerformerTiers(db: Db, tenantId: number, days: number): Promise<PerformerTiersResult> {
  const cards = await computeMemberMetrics(db, tenantId, days);
  const members = assignTiers(cards);
  const counts: Record<PerformerTier, number> = { high: 0, solid: 0, watch: 0 };
  for (const m of members) counts[m.tier] += 1;
  return { windowDays: days, members, counts };
}
