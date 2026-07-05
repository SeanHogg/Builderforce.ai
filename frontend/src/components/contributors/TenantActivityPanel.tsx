'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { analyticsApi, type TenantActivityRollup } from '@/lib/builderforceApi';

/**
 * Owner-facing cross-project activity rollup — the whole tenant's activity from
 * every connected source (repos + boards), rolled up across all projects rather
 * than scoped to one. Reads /api/analytics/tenant-rollup (cached). MANAGER+.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? 'inherit' }}>{value}</div>
    </div>
  );
}

function Spark({ daily, ariaLabel }: { daily: TenantActivityRollup['daily']; ariaLabel: string }) {
  if (daily.length === 0) return null;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const W = 2, GAP = 1, H = 40;
  return (
    <svg width={daily.length * (W + GAP)} height={H} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
      {daily.map((d, i) => {
        const h = Math.max(1, Math.round((d.count / max) * H));
        return <rect key={d.date} x={i * (W + GAP)} y={H - h} width={W} height={h} fill="var(--accent, #6366f1)" rx={1}><title>{`${d.date}: ${d.count}`}</title></rect>;
      })}
    </svg>
  );
}

export function TenantActivityPanel() {
  const t = useTranslations('contributors');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TenantActivityRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const typeLabel = (k: string): string => (t.has(`type.${k}` as never) ? t(`type.${k}` as never) : k);

  useEffect(() => {
    setData(null);
    setError(null);
    analyticsApi.tenantRollup(days).then(setData).catch((e: Error) => setError(e.message));
  }, [days]);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t('tenant.title')} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>· {t('tenant.allProjects')}</span></h2>
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
            <Stat label={t('tenant.events', { days: data.windowDays })} value={data.totalEvents.toLocaleString()} />
            <Stat label={t('tenant.activeContributors')} value={data.activeContributors.toLocaleString()} />
            <Stat label={t('tenant.linesAdded')} value={data.totals.linesAdded.toLocaleString()} accent="#30a46c" />
            <Stat label={t('tenant.linesRemoved')} value={data.totals.linesRemoved.toLocaleString()} accent="#e5484d" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('tenant.dailyTrend')}</div>
              <Spark daily={data.daily} ariaLabel={t('tenant.dailyAria')} />
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('tenant.byType')}</div>
              {Object.entries(data.byType).length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('tenant.noActivity')}</span> :
                Object.entries(data.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{typeLabel(k)}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>
                  </div>
                ))}
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('tenant.topRepos')}</div>
              {data.byRepository.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('tenant.noRepos')}</span> :
                data.byRepository.slice(0, 8).map((r) => (
                  <div key={r.repository} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.repository}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.count.toLocaleString()}</span>
                  </div>
                ))}
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('tenant.byProject')}</div>
              {data.byProject.length === 0 ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('tenant.noProjects')}</span> :
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
