'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  membersApi,
  type MemberScorecard,
  type MemberEngagement,
  type MemberKind,
} from '@/lib/builderforceApi';
import { useRole, hasMinRole } from '@/lib/rbac';

/**
 * One shared fetch of workforce performance + engagement for the whole Workforce
 * directory, exposed as lookups so every member/agent card reads the same data
 * without an N+1 (the grid mounts the provider once; each card just looks itself
 * up by identity). Scorecards key on `${memberKind}:${memberRef}` and engagement
 * keys on the user id — both endpoints are MANAGER+, so for non-managers the
 * provider stays empty (cards self-hide their stats) instead of spamming 403s.
 */

interface WorkforceMetricsValue {
  scorecardFor: (kind: MemberKind, ref: string) => MemberScorecard | undefined;
  engagementFor: (userId: string) => MemberEngagement | undefined;
  /** True once at least one of the two datasets is enabled and resolved. */
  ready: boolean;
}

const Ctx = createContext<WorkforceMetricsValue | null>(null);

export function WorkforceMetricsProvider({ days = 30, children }: { days?: number; children: ReactNode }) {
  const role = useRole();
  const enabled = hasMinRole(role, 'manager');

  const [scorecards, setScorecards] = useState<MemberScorecard[]>([]);
  const [engagement, setEngagement] = useState<MemberEngagement[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) { setReady(false); return; }
    let cancelled = false;
    // Both endpoints are best-effort here — a failure just means the cards render
    // without their stats strip, never a thrown error in the directory grid.
    Promise.allSettled([
      membersApi.metrics(days),
      membersApi.engagement(Math.max(days, 30)),
    ]).then(([m, e]) => {
      if (cancelled) return;
      if (m.status === 'fulfilled') setScorecards(m.value.members);
      if (e.status === 'fulfilled') setEngagement(e.value.members);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [enabled, days]);

  const value = useMemo<WorkforceMetricsValue>(() => {
    const byKey = new Map(scorecards.map((s) => [`${s.memberKind}:${s.memberRef}`, s]));
    const byUser = new Map(engagement.map((e) => [e.userId, e]));
    return {
      scorecardFor: (kind, ref) => byKey.get(`${kind}:${ref}`),
      engagementFor: (userId) => byUser.get(userId),
      ready,
    };
  }, [scorecards, engagement, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read one member's stats from the surrounding provider. Returns empty lookups
 * (everything `undefined`) when rendered outside a provider, so a card can call
 * it unconditionally and simply render no stats.
 */
export function useWorkforceMetrics(): WorkforceMetricsValue {
  return useContext(Ctx) ?? { scorecardFor: () => undefined, engagementFor: () => undefined, ready: false };
}
