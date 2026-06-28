'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import {
  benchmarkingApi,
  BENCHMARK_INDUSTRIES,
  BENCHMARK_SIZE_BANDS,
  type BenchmarkingResult,
  type BenchmarkMetric,
  type BenchmarkRating,
} from '@/lib/benchmarkingApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect } from './LensShell';

/** Format a percentile (e.g. 72 → "72nd"). */
function ordinal(n: number | null): string {
  if (n == null) return '—';
  const v = Math.round(n);
  const rem100 = v % 100;
  const rem10 = v % 10;
  let suffix = 'th';
  if (rem100 < 11 || rem100 > 13) {
    if (rem10 === 1) suffix = 'st';
    else if (rem10 === 2) suffix = 'nd';
    else if (rem10 === 3) suffix = 'rd';
  }
  return `${v}${suffix}`;
}

/** Render a metric value with its unit (units are short tokens like '%', 'h', '/wk'). */
function fmtValue(m: BenchmarkMetric): string {
  if (m.value == null) return '—';
  const v = m.value;
  const rounded = Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  const u = m.unit;
  if (!u) return rounded;
  if (u === '$') return `$${rounded}`;
  if (u === '%') return `${rounded}%`;
  return `${rounded}${u}`;
}

function fmtBench(value: number | null, unit: string | null): string {
  if (value == null) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1);
  if (!unit) return rounded;
  if (unit === '$') return `$${rounded}`;
  if (unit === '%') return `${rounded}%`;
  return `${rounded}${unit}`;
}

const RATING_COLOR: Record<BenchmarkRating, { bg: string; fg: string }> = {
  elite: { bg: 'rgba(16,185,129,0.16)', fg: '#059669' },
  high: { bg: 'rgba(59,130,246,0.16)', fg: '#2563eb' },
  medium: { bg: 'rgba(245,158,11,0.16)', fg: '#b45309' },
  low: { bg: 'rgba(239,68,68,0.16)', fg: '#dc2626' },
};

function RatingBadge({ rating }: { rating: BenchmarkRating | null }) {
  const t = useTranslations('insights');
  if (!rating) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const c = RATING_COLOR[rating];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
      background: c.bg, color: c.fg, fontSize: '0.74rem', fontWeight: 700,
    }}>
      {t(`benchmarking.rating.${rating}`)}
    </span>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};

/**
 * LENS — Industry Benchmarking. A profile selector (industry + size band, saved
 * via PATCH) plus a table ranking each key metric's live value against the seeded
 * cohort distribution (percentile + rating + cohort p50/p90).
 */
export function BenchmarkingLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const [profileTick, setProfileTick] = useState(0);
  const [saving, setSaving] = useState(false);

  const { data, error } = usePmData<BenchmarkingResult>(
    () => benchmarkingApi.get(days),
    [days, profileTick],
  );

  const saveProfile = useCallback(async (patch: { industry?: string; sizeBand?: string }) => {
    setSaving(true);
    try {
      await benchmarkingApi.updateProfile(patch);
      setProfileTick((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }, []);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {t('benchmarking.industry')}
            <Select
              style={selectStyle}
              value={data.industry}
              disabled={saving}
              onChange={(e) => saveProfile({ industry: e.target.value })}
              aria-label={t('benchmarking.industry')}
            >
              {BENCHMARK_INDUSTRIES.map((id) => (
                <option key={id} value={id}>{t(`benchmarking.industries.${id}`)}</option>
              ))}
            </Select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {t('benchmarking.sizeBand')}
            <Select
              style={selectStyle}
              value={data.sizeBand}
              disabled={saving}
              onChange={(e) => saveProfile({ sizeBand: e.target.value })}
              aria-label={t('benchmarking.sizeBand')}
            >
              {BENCHMARK_SIZE_BANDS.map((b) => (
                <option key={b} value={b}>{t(`benchmarking.sizeBands.${b}`)}</option>
              ))}
            </Select>
          </label>
        </div>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      <PmCard title={t('benchmarking.tableTitle')}>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('benchmarking.col.metric')}</th>
                <th style={thStyle}>{t('benchmarking.col.value')}</th>
                <th style={thStyle}>{t('benchmarking.col.percentile')}</th>
                <th style={thStyle}>{t('benchmarking.col.rating')}</th>
                <th style={thStyle}>{t('benchmarking.col.median')}</th>
                <th style={thStyle}>{t('benchmarking.col.elite')}</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.metric} style={trStyle}>
                  <td style={tdStyle}>{t(`benchmarking.metrics.${m.metric}`)}</td>
                  <td style={tdStyle}>{fmtValue(m)}</td>
                  <td style={tdMutedStyle}>{ordinal(m.percentile)}</td>
                  <td style={tdMutedStyle}><RatingBadge rating={m.rating} /></td>
                  <td style={tdMutedStyle}>{fmtBench(m.p50, m.unit)}</td>
                  <td style={tdMutedStyle}>{fmtBench(m.p90, m.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 12 }}>
          {t('benchmarking.footnote')}
        </p>
      </PmCard>
    </div>
  );
}
