'use client';

import { useEffect, useState } from 'react';
import { analyticsApi, type TenantActivityRollup } from '@/lib/builderforceApi';

/**
 * Owner-facing cross-project activity rollup — the whole tenant's activity from
 * every connected source (repos + boards), rolled up across all projects rather
 * than scoped to one. Reads /api/analytics/tenant-rollup (cached). MANAGER+.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

const TYPE_LABEL: Record<string, string> = {
  commit: 'Commits', pr_opened: 'PRs opened', pr_merged: 'PRs merged', pr_closed: 'PRs closed',
  pr_reviewed: 'Reviews', issue_created: 'Issues opened', issue_resolved: 'Issues resolved', issue_commented: 'Comments',
  ai_interaction: 'AI interactions', code_change: 'Code changes',
};

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? 'inherit' }}>{value}</div>
    </div>
  );
}

function Spark({ daily }: { daily: TenantActivityRollup['daily'] }) {
  if (daily.length === 0) return null;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const W = 2, GAP = 1, H = 40;
  return (
    <svg width={daily.length * (W + GAP)} height={H} role="img" aria-label="Daily activity" style={{ display: 'block' }}>
      {daily.map((d, i) => {
        const h = Math.max(1, Math.round((d.count / max) * H));
        return <rect key={d.date} x={i * (W + GAP)} y={H - h} width={W} height={h} fill="var(--accent, #6366f1)" rx={1}><title>{`${d.date}: ${d.count}`}</title></rect>;
      })}
    </svg>
  );
}

export function TenantActivityPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TenantActivityRollup | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    analyticsApi.tenantRollup(days).then(setData).catch((e: Error) => setError(e.message));
  }, [days]);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Tenant activity <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>· all projects</span></h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border-subtle)',
              background: days === d ? 'var(--accent, #6366f1)' : 'var(--bg-base)',
              color: days === d ? '#fff' : 'var(--text-secondary)',
            }}>{d}d</button>
          ))}
        </div>
      </div>

      {error && <div style={{ ...cardStyle, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Stat label={`Events (${data.windowDays}d)`} value={data.totalEvents.toLocaleString()} />
            <Stat label="Active contributors" value={data.activeContributors.toLocaleString()} />
            <Stat label="Lines added" value={data.totals.linesAdded.toLocaleString()} accent="#30a46c" />
            <Stat label="Lines removed" value={data.totals.linesRemoved.toLocaleString()} accent="#e5484d" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Daily trend</div>
              <Spark daily={data.daily} />
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>By type</div>
              {Object.entries(data.byType).length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No activity yet.</span> :
                Object.entries(data.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{TYPE_LABEL[k] ?? k}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>
                  </div>
                ))}
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Top repositories</div>
              {data.byRepository.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No repos linked.</span> :
                data.byRepository.slice(0, 8).map((r) => (
                  <div key={r.repository} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.repository}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.count.toLocaleString()}</span>
                  </div>
                ))}
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>By project</div>
              {data.byProject.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No project-attributed activity yet.</span> :
                data.byProject.slice(0, 8).map((p) => (
                  <div key={p.projectId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.projectName}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{p.count.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
