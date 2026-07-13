'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { recommendationsApi, type RecommendationsResult, type Recommendation, type RecSeverity } from '@/lib/recommendationsApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import { DaysWindowSelect } from './LensShell';

/**
 * AI-driven Recommendations lens — the prescriptive layer over the read-only
 * lenses. Ranked recommendation cards (severity badge + category + detail +
 * the prescriptive action) with a Dismiss button that acknowledges a rec and
 * refetches so it drops off the list.
 */

const SEVERITY_COLOR: Record<RecSeverity, string> = {
  critical: '#dc2626',
  warning: '#d97706',
  info: '#2563eb',
};

export function RecommendationsLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, reload } = usePmData<RecommendationsResult>(() => recommendationsApi.recommendations(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  async function dismiss(key: string) {
    setBusy(key);
    try {
      await recommendationsApi.dismiss(key);
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><DaysWindowSelect value={days} onChange={setDays} /></div>
      {data.recommendations.length === 0 ? (
        <PmEmpty message={t('recs.empty')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.recommendations.map((r) => (
            <Card key={r.key} r={r} dismissing={busy === r.key} onDismiss={() => dismiss(r.key)} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({
  r, dismissing, onDismiss, t,
}: {
  r: Recommendation;
  dismissing: boolean;
  onDismiss: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const color = SEVERITY_COLOR[r.severity];
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${color}`, borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#fff', background: color, padding: '2px 8px', borderRadius: 999 }}>
            {t(`recs.severity.${r.severity}`)}
          </span>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t(`recs.category.${r.category}`)}
          </span>
          <span style={{ fontSize: '1rem', fontWeight: 700 }}>{r.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{r.metric}</span>
          <button
            type="button"
            onClick={onDismiss}
            disabled={dismissing}
            style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: dismissing ? 'default' : 'pointer', opacity: dismissing ? 0.6 : 1 }}
          >
            {dismissing ? t('recs.dismissing') : t('recs.dismiss')}
          </button>
        </div>
      </div>
      <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', margin: '10px 0 6px' }}>{r.detail}</p>
      <p style={{ fontSize: '0.86rem', color: 'var(--text-primary)', margin: 0 }}>
        <span style={{ fontWeight: 600 }}>{t('recs.action')}: </span>{r.recommendation}
      </p>
    </div>
  );
}
