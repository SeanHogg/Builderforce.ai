'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { getStoredTenant } from '@/lib/auth';
import {
  listEngagements, updateEngagement, terminateEngagement,
  listEmployerTimecards, approveTimecard, rejectTimecard, getTimecardReview,
  type Engagement, type Timecard, type TimecardEntry,
} from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18,
};
const btn = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  border: variant === 'primary' ? 'none' : `1px solid ${variant === 'danger' ? 'rgba(239,68,68,0.5)' : 'var(--border-subtle)'}`,
  background: variant === 'primary' ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))' : 'var(--bg-elevated)',
  color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#f87171' : 'var(--text-primary)',
});
const fmtHrs = (m: number) => `${(m / 60).toFixed(1)}h`;
const money = (c: number, cur: string) => `${cur} ${(c / 100).toFixed(2)}`;

export default function HiresPage() {
  const t = useTranslations('hires');
  const tenant = getStoredTenant();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [cards, setCards] = useState<Timecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, TimecardEntry[]>>({});

  const load = useCallback(async () => {
    if (!tenant) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [engs, tcs] = await Promise.all([listEngagements(), listEmployerTimecards()]);
      setEngagements(engs);
      setCards(tcs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(null); }
  };

  const toggleReview = async (id: string) => {
    if (openCard === id) { setOpenCard(null); return; }
    setOpenCard(id);
    if (!entries[id]) {
      try { const { entries: rows } = await getTimecardReview(id); setEntries((p) => ({ ...p, [id]: rows })); }
      catch { /* leave collapsed content empty */ }
    }
  };

  if (!tenant) {
    return <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noWorkspace')}</p>
    </PageContainer>;
  }

  const pending = cards.filter((c) => c.status === 'submitted');
  const otherCards = cards.filter((c) => c.status !== 'submitted');

  return (
    <PageContainer width="full" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('subtitle')}</p>
      </div>
      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {loading ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</p> : (
        <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
          {/* Engaged freelancers */}
          <section>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('team')}</h2>
            {engagements.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>{t('teamEmpty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {engagements.map((e) => (
                  <div key={e.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{e.freelancerName ?? e.freelancerUserId}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {t(`status.${e.status}`)}{e.rateCents != null ? ` · ${e.currency} ${(e.rateCents / 100).toFixed(0)}${t('perHour')}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {e.status !== 'active' && (
                        <button type="button" style={btn('ghost')} disabled={busy === e.id}
                          onClick={() => act(e.id, () => updateEngagement(e.id, { status: 'active' }))}>{t('activate')}</button>
                      )}
                      <button type="button" style={btn('danger')} disabled={busy === e.id}
                        onClick={() => { if (confirm(t('terminateConfirm'))) void act(e.id, () => terminateEngagement(e.id)); }}>
                        {busy === e.id ? '…' : t('terminate')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Timecards awaiting approval */}
          <section>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('approvals')}</h2>
            {pending.length === 0 && otherCards.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>{t('approvalsEmpty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...pending, ...otherCards].map((tc) => (
                  <div key={tc.id} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{tc.freelancerName ?? ''}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {tc.periodStart} – {tc.periodEnd} · {fmtHrs(tc.billableMinutes)} · {money(tc.amountCents, tc.currency)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="button" style={btn('ghost')} onClick={() => toggleReview(tc.id)}>{openCard === tc.id ? t('hide') : t('review')}</button>
                        {tc.status === 'submitted' ? (
                          <>
                            <button type="button" style={btn('ghost')} disabled={busy === tc.id}
                              onClick={() => act(tc.id, () => rejectTimecard(tc.id))}>{t('reject')}</button>
                            <button type="button" style={btn('primary')} disabled={busy === tc.id}
                              onClick={() => act(tc.id, () => approveTimecard(tc.id))}>{busy === tc.id ? '…' : t('approve')}</button>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{t(`cardStatus.${tc.status}`)}</span>
                        )}
                      </div>
                    </div>
                    {openCard === tc.id && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                        {(entries[tc.id] ?? []).length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noEntries')}</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(entries[tc.id] ?? []).map((en) => (
                              <div key={en.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                                <span>{en.workDate} · {t(`entrySource.${en.source}`)}{en.description ? ` · ${en.description}` : ''}</span>
                                <span style={{ color: en.billable ? 'var(--text-primary)' : 'var(--text-muted)' }}>{fmtHrs(en.minutes)}{en.billable ? '' : ` (${t('nonBillable')})`}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  );
}
