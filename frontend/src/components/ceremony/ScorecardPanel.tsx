'use client';

import { useEffect, useState } from 'react';
import { membersApi, type MemberScorecard, type MemberProfile } from '@/lib/builderforceApi';
import { formatHours } from '@/lib/duration';
import type { CeremonyMember } from './types';

/** One labelled stat tile; renders "No data yet" when the value is null. */
function Tile({ label, value, hint }: { label: string; value: string | number | null; hint?: string }) {
  const empty = value == null || value === '';
  return (
    <div style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: empty ? 'var(--text-muted)' : 'var(--text-primary)', marginTop: 2 }}>
        {empty ? 'No data yet' : value}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/**
 * Scorecard slide-out content for one member. Consumes the member-metrics system
 * (`/api/members/metrics` + `/profiles`) — no duplicate aggregation. Engagement
 * stats are human-only; agents show "No data yet" for those.
 */
export function ScorecardPanel({ member }: { member: CeremonyMember }) {
  const [card, setCard] = useState<MemberScorecard | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.all([
      membersApi.metrics(7).then((r) => r.members).catch(() => [] as MemberScorecard[]),
      membersApi.profiles().then((r) => r.profiles).catch(() => [] as MemberProfile[]),
    ])
      .then(([metrics, profiles]) => {
        if (!live) return;
        setCard(metrics.find((m) => m.memberKind === member.kind && m.memberRef === member.ref) ?? null);
        setProfile(profiles.find((p) => p.memberKind === member.kind && p.memberRef === member.ref) ?? null);
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [member.kind, member.ref]);

  if (loading) return <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Loading scorecard…</div>;
  if (error) return <div style={{ padding: 16, color: 'var(--error-text)', fontSize: 13 }}>{error}</div>;

  const toTags = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const skills = toTags(profile?.skills);
  const focus = toTags(profile?.focusAreas);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last 7 days · {member.name}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Tile label="Capacity (WIP)" value={profile?.maxConcurrentWip ?? null} hint={profile?.dailyCapacityPoints != null ? `${profile.dailyCapacityPoints} pts/day` : undefined} />
        <Tile label="Assigned" value={card?.assignedCount ?? null} />
        <Tile label="Completed" value={card?.completedCount ?? null} />
        <Tile label="Cycle time" value={card ? formatHours(card.avgCycleTimeHours) : null} hint="first in-progress → done" />
        <Tile label="Redo" value={card?.redoCount ?? null} hint="backward lane moves" />
        <Tile label="Reopen" value={card?.reopenCount ?? null} hint="bounced out of done" />
        <Tile label="Pickup latency" value={card ? formatHours(card.avgPickupLatencyHours) : null} hint="assigned → started (human)" />
        <Tile label="Board hygiene" value={card?.boardHygieneScore != null ? Math.round(card.boardHygieneScore) : null} hint="0–100 (human)" />
        <Tile label="Effectiveness" value={card?.effectivenessScore != null ? Math.round(card.effectivenessScore) : null} />
        <Tile label="Engagement" value={card?.engagementScore != null ? Math.round(card.engagementScore) : null} hint="human board behaviour" />
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Specialization</div>
        {skills.length + focus.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...skills, ...focus].map((s, i) => (
              <span key={`${s}-${i}`} className="badge-blue" style={{ fontSize: 11 }}>{s}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data yet</div>
        )}
      </div>
    </div>
  );
}
