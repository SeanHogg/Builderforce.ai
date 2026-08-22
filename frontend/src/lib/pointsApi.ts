/**
 * Points, badges and rewards — the typed client.
 *
 * Its own module rather than another entry in `builderforceApi.ts`, which is past
 * ten thousand lines and is the file every feature has to edit. One domain, one
 * client, and this one can be dropped into a second surface without dragging the
 * rest of the platform's API surface with it.
 *
 * ── THERE IS NO `award` FUNCTION HERE, DELIBERATELY ──────────────────────────
 * Points are a side effect of a domain event, awarded server-side where the event
 * happens. A browser-callable "give me points" endpoint would be the farming
 * vector the whole catalog of daily caps exists to close, so the client can read
 * its balance and spend it, and that is all.
 */
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';

export interface HeldBadge {
  key: string;
  name: string;
  description: string;
  iconKey: string;
  awardedAt: string;
}

export interface PointsActivityEntry {
  id: number;
  amount: number;
  entryKind: 'grant' | 'spend' | 'refund' | 'adjustment' | string;
  action: string;
  source: string;
  memo: string | null;
  occurredAt: string;
}

export interface RewardSku {
  id: string;
  kind: string;
  label: string;
  pointsCost: number;
  /** False when this build has no way to deliver it. The server derives this from
   *  whether a fulfilment adapter is registered, so the button this drives cannot
   *  promise a reward the redeem call would refuse. */
  available: boolean;
}

export interface EarnRule {
  key: string;
  label: string;
  points: number;
  dailyCapPoints: number | null;
}

export interface PointsSummary {
  balance: number;
  streak: { current: number; longest: number; lastActivityDate: string | null };
  suspended: boolean;
  badges: HeldBadge[];
  available: Array<{ key: string; name: string; description: string; iconKey: string }>;
  activity: PointsActivityEntry[];
  rewards: RewardSku[];
  earnRules: EarnRule[];
}

export interface LeaderboardRow {
  userRef: string;
  points: number;
  rank: number;
}

export async function fetchPointsSummary(): Promise<PointsSummary> {
  const res = await apiRequestStream('/api/points', { auth: 'tenant' });
  return jsonOrThrow<PointsSummary>(res, 'Failed to load your points');
}

export async function fetchPointsLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const res = await apiRequestStream(`/api/points/leaderboard?limit=${limit}`, { auth: 'tenant' });
  const body = await jsonOrThrow<{ rows: LeaderboardRow[] }>(res, 'Failed to load the leaderboard');
  return body.rows;
}

export interface RedeemOutcome {
  redemptionId: number;
  pointsSpent: number;
  balance: number;
}

export async function redeemReward(skuId: string): Promise<RedeemOutcome> {
  const res = await apiRequestStream('/api/points/redeem', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ skuId }),
  });
  return jsonOrThrow<RedeemOutcome>(res, 'That redemption was refused');
}
