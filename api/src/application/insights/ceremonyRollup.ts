/**
 * Tenant-wide ceremonies rollup (the "insights everywhere" agg the Ceremonies
 * surface was missing — `ceremonySessionsApi.active` is per-project only).
 *
 * Reads the completed + active standup/planning sessions and their participant
 * turn accruals across the whole tenant over a window, and derives:
 *   - volume: sessions run (by kind) + completion rate,
 *   - cadence: a per-day sessions trend (drives a TrendChart / Sparkline),
 *   - engagement: participant turns + talk-time, and a talk-time distribution
 *     across the roster (who dominates vs who is quiet),
 *   - agent participation share (human vs AI-agent talk time).
 *
 * Pure derivation over two windowed queries; no new tables. Mirrors the
 * velocity/DORA rollup shape ({ windowDays, ...totals, series }).
 */

import { and, eq, gte, inArray } from 'drizzle-orm';
import { ceremonySessions, ceremonyParticipants } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

const DAY_MS = 86_400_000;

export interface CeremonyDayPoint {
  /** UTC day 'YYYY-MM-DD'. */
  day: string;
  sessions: number;
}

export interface CeremonyTalker {
  memberKind: string;
  memberRef: string;
  memberName: string;
  /** Total accrued talk time across the window, in seconds. */
  talkSeconds: number;
  turns: number;
}

export interface CeremonyRollup {
  windowDays: number;
  totals: {
    sessions: number;
    completed: number;
    active: number;
    /** Completed / total, 0–1. */
    completionRate: number;
    /** Distinct projects that ran a ceremony in the window. */
    projects: number;
    /** Mean wall-clock minutes of a completed session (started→ended). */
    avgDurationMinutes: number;
    participants: number;
    /** Mean accrued talk time per participant-turn, in seconds. */
    avgTurnSeconds: number;
    /** Share of talk time attributed to AI agents (0–1). */
    agentTalkShare: number;
  };
  byKind: Array<{ kind: string; sessions: number }>;
  /** Per-day sessions cadence over the window (zero-filled). */
  series: CeremonyDayPoint[];
  /** Talk-time leaderboard (most-talkative first), bounded. */
  topTalkers: CeremonyTalker[];
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function computeCeremonyRollup(db: Db, tenantId: number, days: number): Promise<CeremonyRollup> {
  const now = Date.now();
  const windowStart = now - days * DAY_MS;
  const since = new Date(windowStart);

  const sessions = await db
    .select({
      id: ceremonySessions.id,
      projectId: ceremonySessions.projectId,
      kind: ceremonySessions.kind,
      status: ceremonySessions.status,
      startedAt: ceremonySessions.startedAt,
      endedAt: ceremonySessions.endedAt,
    })
    .from(ceremonySessions)
    .where(and(eq(ceremonySessions.tenantId, tenantId), gte(ceremonySessions.startedAt, since)));

  const sessionIds = sessions.map((s) => s.id);
  const participants = sessionIds.length
    ? await db
        .select({
          sessionId: ceremonyParticipants.sessionId,
          memberKind: ceremonyParticipants.memberKind,
          memberRef: ceremonyParticipants.memberRef,
          memberName: ceremonyParticipants.memberName,
          durationMs: ceremonyParticipants.durationMs,
        })
        .from(ceremonyParticipants)
        .where(inArray(ceremonyParticipants.sessionId, sessionIds))
    : [];

  // ── Session totals ──────────────────────────────────────────────────────────
  const completedSessions = sessions.filter((s) => s.status === 'completed');
  const kindCounts = new Map<string, number>();
  const projectSet = new Set<number>();
  let durationMsSum = 0;
  let durationSamples = 0;
  for (const s of sessions) {
    kindCounts.set(s.kind, (kindCounts.get(s.kind) ?? 0) + 1);
    projectSet.add(s.projectId);
    if (s.endedAt && s.startedAt) {
      durationMsSum += Math.max(0, s.endedAt.getTime() - s.startedAt.getTime());
      durationSamples += 1;
    }
  }

  // ── Cadence series (zero-filled per UTC day) ─────────────────────────────────
  const span = Math.max(1, days);
  const todayIdx = Math.floor(now / DAY_MS);
  const buckets = new Array<number>(span).fill(0);
  for (const s of sessions) {
    if (!s.startedAt) continue;
    const idx = span - 1 - (todayIdx - Math.floor(s.startedAt.getTime() / DAY_MS));
    if (idx >= 0 && idx < span) buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  const series: CeremonyDayPoint[] = buckets.map((sessionsCount, i) => ({
    day: dayKey((todayIdx - (span - 1 - i)) * DAY_MS),
    sessions: sessionsCount,
  }));

  // ── Engagement / talk-time ───────────────────────────────────────────────────
  const talkers = new Map<string, CeremonyTalker>();
  let totalTalkMs = 0;
  let agentTalkMs = 0;
  let turnCount = 0;
  for (const p of participants) {
    const key = `${p.memberKind}:${p.memberRef}`;
    const t = talkers.get(key) ?? { memberKind: p.memberKind, memberRef: p.memberRef, memberName: p.memberName, talkSeconds: 0, turns: 0 };
    t.talkSeconds += Math.round(p.durationMs / 1000);
    t.turns += 1;
    talkers.set(key, t);
    totalTalkMs += p.durationMs;
    if (p.memberKind !== 'human') agentTalkMs += p.durationMs;
    turnCount += 1;
  }

  const topTalkers = [...talkers.values()].sort((a, b) => b.talkSeconds - a.talkSeconds).slice(0, 12);

  return {
    windowDays: days,
    totals: {
      sessions: sessions.length,
      completed: completedSessions.length,
      active: sessions.length - completedSessions.length,
      completionRate: sessions.length ? completedSessions.length / sessions.length : 0,
      projects: projectSet.size,
      avgDurationMinutes: durationSamples ? Math.round(durationMsSum / durationSamples / 60_000) : 0,
      participants: turnCount,
      avgTurnSeconds: turnCount ? Math.round(totalTalkMs / turnCount / 1000) : 0,
      agentTalkShare: totalTalkMs ? agentTalkMs / totalTalkMs : 0,
    },
    byKind: [...kindCounts.entries()].map(([kind, s]) => ({ kind, sessions: s })).sort((a, b) => b.sessions - a.sessions),
    series,
    topTalkers,
  };
}
