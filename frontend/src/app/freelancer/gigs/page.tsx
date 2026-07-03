'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { listMyEngagements, type Engagement } from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18,
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  invited: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  interviewing: { bg: 'rgba(245,158,11,0.14)', fg: 'var(--warning-fg, #f59e0b)' },
  active: { bg: 'rgba(34,197,94,0.14)', fg: 'rgba(34,197,94,0.95)' },
};

export default function FreelancerGigsPage() {
  const t = useTranslations('freelancer');
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyEngagements()
      .then(setEngagements)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const fmtRate = (e: Engagement) => (e.rateCents != null ? `${e.currency} ${(e.rateCents / 100).toFixed(0)}/hr` : '—');

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('gigs.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('gigs.subtitle')}</p>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</p>
      ) : error ? (
        <p style={{ color: 'var(--coral-bright)', fontSize: 13 }}>{error}</p>
      ) : engagements.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
          {t('gigs.empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {engagements.map((e) => {
            const c = STATUS_COLORS[e.status] ?? { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' };
            return (
              <div key={e.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{e.tenantName ?? t('gigs.workspace')}</div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: c.bg, color: c.fg, flexShrink: 0 }}>
                    {t(`status.${e.status}`)}
                  </span>
                </div>
                {e.title && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{e.title}</div>}
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('gigs.rate')}: <strong style={{ color: 'var(--text-primary)' }}>{fmtRate(e)}</strong></div>
                {e.hiredAt && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('gigs.since')}: {new Date(e.hiredAt).toLocaleDateString()}</div>}
                {e.note && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>{e.note}</p>}
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
