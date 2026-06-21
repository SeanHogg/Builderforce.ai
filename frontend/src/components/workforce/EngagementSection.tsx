'use client';

import { useEffect, useState } from 'react';
import { membersApi, type MemberEngagement, type EngagementLevel } from '@/lib/builderforceApi';

/**
 * Unified engagement — one score per human member that folds EVERY signal we
 * capture (external dev activity, in-product usage, VS Code presence, delivery),
 * not just board behaviour. Reads /api/members/engagement. Lives under the
 * Performance tab beside the task scorecards. MANAGER+ on the API.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' };

const LEVEL_COLOR: Record<EngagementLevel, string> = {
  inactive: 'var(--muted)',
  low: 'var(--danger, #e5484d)',
  moderate: 'var(--warning, #f5a623)',
  high: 'var(--accent, #6366f1)',
  very_high: 'var(--success, #30a46c)',
};
const LEVEL_LABEL: Record<EngagementLevel, string> = {
  inactive: 'Inactive', low: 'Low', moderate: 'Moderate', high: 'High', very_high: 'Very high',
};

function ScoreBar({ m }: { m: MemberEngagement }) {
  const seg = (pts: number, cap: number, color: string) => (
    <span style={{ width: `${(pts / 100) * 100}%`, background: color, display: 'inline-block', height: '100%' }} title={`${pts.toFixed(0)} / ${cap}`} />
  );
  return (
    <span style={{ display: 'inline-flex', width: 120, height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--border-subtle)' }}>
      {seg(m.breakdown.activityPts, 40, '#39d353')}
      {seg(m.breakdown.platformPts, 25, '#6366f1')}
      {seg(m.breakdown.toolingPts, 20, '#8a4be0')}
      {seg(m.breakdown.deliveryPts, 15, '#f5a623')}
    </span>
  );
}

export function EngagementSection({ days }: { days: number }) {
  const [members, setMembers] = useState<MemberEngagement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMembers(null);
    setError(null);
    membersApi.engagement(Math.max(days, 30)).then((r) => setMembers(r.members)).catch((e: Error) => setError(e.message));
  }, [days]);

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        Engagement <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· last {Math.max(days, 30)}d · all signals combined</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span><span style={{ color: '#39d353' }}>■</span> dev activity</span>
        <span><span style={{ color: '#6366f1' }}>■</span> platform usage</span>
        <span><span style={{ color: '#8a4be0' }}>■</span> VS Code</span>
        <span><span style={{ color: '#f5a623' }}>■</span> delivery</span>
      </div>
      {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ ...th, textAlign: 'left' }}>Member</th>
              <th style={{ ...th, textAlign: 'left' }}>Engagement</th>
              <th style={th}>Score</th>
              <th style={th}>Activity</th>
              <th style={th}>Platform</th>
              <th style={th}>VS Code</th>
              <th style={th}>Completed</th>
            </tr>
          </thead>
          <tbody>
            {members == null ? (
              <tr><td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }} colSpan={7}>Loading…</td></tr>
            ) : members.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }} colSpan={7}>No members yet.</td></tr>
            ) : members.map((m) => (
              <tr key={m.userId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ ...td, textAlign: 'left' }}>
                  <div style={{ fontWeight: 500 }}>{m.displayName}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.role}</div>
                </td>
                <td style={{ ...td, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ScoreBar m={m} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: LEVEL_COLOR[m.level] }}>{LEVEL_LABEL[m.level]}</span>
                  </div>
                </td>
                <td style={{ ...td, fontWeight: 700, color: LEVEL_COLOR[m.level] }}>{Math.round(m.score)}</td>
                <td style={td}>{m.signals.activityEvents}</td>
                <td style={td}>{m.signals.platformActions}</td>
                <td style={td}>{m.signals.vscodeActive ? '🟢' : '—'}</td>
                <td style={td}>{m.signals.completedTasks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
