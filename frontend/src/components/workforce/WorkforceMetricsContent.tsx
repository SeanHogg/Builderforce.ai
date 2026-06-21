'use client';

import { useEffect, useState } from 'react';
import { membersApi, type DoraRollup, type MemberScorecard } from '@/lib/builderforceApi';
import { MemberProfileEditor } from './MemberProfileEditor';
import { EngagementSection } from './EngagementSection';

/**
 * Performance tab — workforce effectiveness/engagement scorecards (humans AND
 * agents) + the four DORA metrics. Reads /api/members/metrics and /dora. Each
 * scorecard row opens the capability/availability profile editor (the planner's
 * inputs). MANAGER+ on the API; non-managers get an empty/forbidden state.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

function fmtHrs(n: number | null): string {
  if (n == null) return '—';
  if (n < 1) return `${Math.round(n * 60)}m`;
  if (n < 48) return `${n.toFixed(1)}h`;
  return `${(n / 24).toFixed(1)}d`;
}
function fmtScore(n: number | null): string {
  return n == null ? '—' : String(Math.round(n));
}
function scoreColor(n: number | null): string {
  if (n == null) return 'var(--muted)';
  if (n >= 75) return 'var(--success, #30a46c)';
  if (n >= 50) return 'var(--warning, #f5a623)';
  return 'var(--danger, #e5484d)';
}

const KIND_LABEL: Record<MemberScorecard['memberKind'], string> = {
  human: 'Human', cloud_agent: 'Cloud agent', host_agent: 'Host agent',
};

function DoraTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 160px', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' };

export function WorkforceMetricsContent() {
  const [days, setDays] = useState(7);
  const [members, setMembers] = useState<MemberScorecard[] | null>(null);
  const [dora, setDora] = useState<DoraRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberScorecard | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    membersApi.metrics(days).then((r) => setMembers(r.members)).catch((e: Error) => setError(e.message));
    membersApi.dora(Math.max(days, 30)).then(setDora).catch(() => { /* optional */ });
  }, [days, reloadKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Performance</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border-subtle)',
              background: days === d ? 'var(--accent, #6366f1)' : 'var(--bg-base)',
              color: days === d ? '#fff' : 'var(--text-secondary)',
            }}>{d}d</button>
          ))}
        </div>
      </div>

      {/* DORA */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <DoraTile label="Deployment frequency" value={dora ? `${dora.deploymentFrequencyPerDay.toFixed(2)}/day` : '—'} hint={dora ? `${dora.totalDeployments} in ${dora.windowDays}d` : undefined} />
        <DoraTile label="Lead time for changes" value={fmtHrs(dora?.leadTimeHours ?? null)} hint="created → done" />
        <DoraTile label="Change failure rate" value={dora?.changeFailureRatePct == null ? '—' : `${dora.changeFailureRatePct.toFixed(0)}%`} hint="failed deploys" />
        <DoraTile label="MTTR" value={fmtHrs(dora?.mttrHours ?? null)} hint="restore time" />
      </div>

      {/* Scorecards */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Member scorecards <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· last {days}d · click a row to edit capability/availability</span></div>
        {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ ...th, textAlign: 'left' }}>Member</th>
                <th style={th}>Assigned</th>
                <th style={th}>Completed</th>
                <th style={th}>Redo</th>
                <th style={th}>Reopen</th>
                <th style={th}>Cycle</th>
                <th style={th}>Pickup</th>
                <th style={th}>Idle→done</th>
                <th style={th}>Hygiene</th>
                <th style={th}>Engage</th>
                <th style={th}>Effective</th>
              </tr>
            </thead>
            <tbody>
              {members == null ? (
                <tr><td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }} colSpan={11}>Loading…</td></tr>
              ) : members.length === 0 ? (
                <tr><td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }} colSpan={11}>No activity in this window.</td></tr>
              ) : members.map((m) => (
                <tr key={`${m.memberKind}:${m.memberRef}`} onClick={() => setEditing(m)}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div style={{ fontWeight: 500 }}>{m.memberName}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{KIND_LABEL[m.memberKind]}</div>
                  </td>
                  <td style={td}>{m.assignedCount}</td>
                  <td style={td}>{m.completedCount}</td>
                  <td style={{ ...td, color: m.redoCount > 0 ? 'var(--warning, #f5a623)' : undefined }}>{m.redoCount}</td>
                  <td style={{ ...td, color: m.reopenCount > 0 ? 'var(--danger, #e5484d)' : undefined }}>{m.reopenCount}</td>
                  <td style={td}>{fmtHrs(m.avgCycleTimeHours)}</td>
                  <td style={td}>{fmtHrs(m.avgPickupLatencyHours)}</td>
                  <td style={td}>{fmtHrs(m.avgIdleAfterDoneHours)}</td>
                  <td style={{ ...td, color: scoreColor(m.boardHygieneScore) }}>{fmtScore(m.boardHygieneScore)}</td>
                  <td style={{ ...td, color: scoreColor(m.engagementScore) }}>{fmtScore(m.engagementScore)}</td>
                  <td style={{ ...td, fontWeight: 700, color: scoreColor(m.effectivenessScore) }}>{fmtScore(m.effectivenessScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unified engagement — all signals folded into one score per member. */}
      <EngagementSection days={days} />

      {editing && (
        <MemberProfileEditor
          kind={editing.memberKind}
          refId={editing.memberRef}
          name={editing.memberName}
          onClose={() => setEditing(null)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
