'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminPlatformRollup } from '@/lib/adminApi';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { errText } from '../adminShared';

/**
 * Superadmin Health/Usage historical trends — platform-wide user + workspace
 * growth, LLM tokens/spend, and error-event volume over a chosen window. Reads
 * the cached /api/admin/platform-rollup rollup and renders the shared InsightStat
 * tiles + a multi-series TrendChart. Self-contained (own fetch + window state) so
 * it drops into the existing HealthPanel without touching its data flow.
 */

const WINDOWS = [7, 30, 90] as const;
const compactInt = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}K` : Math.round(n).toLocaleString());
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function PlatformTrends() {
  const t = useTranslations('admin');
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AdminPlatformRollup | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    adminApi.platformRollup(days)
      .then((d) => { if (alive) { setData(d); setError(''); } })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [days]);

  const labels = data?.series.newUsers.map((p) => p.day.slice(5)) ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t('health.trends')}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              style={{
                padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${days === w ? 'transparent' : 'var(--border-subtle)'}`,
                background: days === w ? 'var(--coral-bright, #f4726e)' : 'var(--bg-elevated)',
                color: days === w ? '#fff' : 'var(--text-primary)',
              }}
            >{t('health.windowDays', { days: w })}</button>
          ))}
        </div>
      </div>

      {error && <p className="text-muted" style={{ fontSize: 13, color: 'var(--danger, #d33)' }}>{error}</p>}
      {!data ? (
        <p className="text-muted" style={{ fontSize: 13 }}>{t('common.loading')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" style={{ marginBottom: 16 }}>
            <InsightStat label={t('health.newUsers')} value={compactInt(data.totals.newUsers)} series={data.series.newUsers.map((p) => p.value)} color={colorAt(0)} style={{ minWidth: 0 }} />
            <InsightStat label={t('health.newWorkspaces')} value={compactInt(data.totals.newTenants)} series={data.series.newTenants.map((p) => p.value)} color={colorAt(1)} style={{ minWidth: 0 }} />
            <InsightStat label={t('health.llmTokens')} value={compactInt(data.totals.tokens)} series={data.series.tokens.map((p) => p.value)} color={colorAt(2)} style={{ minWidth: 0 }} />
            <InsightStat label={t('health.llmSpend')} value={usd(data.totals.spendUsd)} series={data.series.spendUsd.map((p) => p.value)} color={colorAt(3)} style={{ minWidth: 0 }} />
            <InsightStat label={t('health.errorVolume')} value={compactInt(data.totals.errorEvents)} series={data.series.errorEvents.map((p) => p.value)} color="rgba(239,68,68,0.85)" style={{ minWidth: 0 }} />
          </div>
          <TrendChart
            labels={labels}
            series={[
              { key: 'users', label: t('health.newUsers'), values: data.series.newUsers.map((p) => p.value), color: colorAt(0) },
              { key: 'tenants', label: t('health.newWorkspaces'), values: data.series.newTenants.map((p) => p.value), color: colorAt(1) },
              { key: 'errors', label: t('health.errorVolume'), values: data.series.errorEvents.map((p) => p.value), color: 'rgba(239,68,68,0.85)' },
            ]}
            height={200}
            formatValue={(v) => compactInt(v)}
            ariaLabel={t('health.trends')}
          />
        </>
      )}
    </div>
  );
}
