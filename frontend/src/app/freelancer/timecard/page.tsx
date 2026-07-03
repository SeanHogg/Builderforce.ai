'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import {
  listMyEngagements, listMyTimecards, resolveTimecard, submitTimecard, getTodayActivity,
  type Engagement, type Timecard,
} from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18,
};

/** Current week's Mon–Sun as ISO dates (UTC). */
function currentWeek(): { start: string; end: string } {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // 0 = Monday
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const fmtHrs = (min: number) => `${(min / 60).toFixed(1)}h`;
const money = (cents: number, cur: string) => `${cur} ${(cents / 100).toFixed(2)}`;

export default function FreelancerTimecardPage() {
  const t = useTranslations('freelancer');
  const [today, setToday] = useState<{ signalCount: number; minutes: number; byKind: Record<string, number> } | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [cards, setCards] = useState<Timecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [act, engs, tcs] = await Promise.all([
        getTodayActivity().catch(() => null),
        listMyEngagements().catch(() => []),
        listMyTimecards().catch(() => []),
      ]);
      setToday(act);
      setEngagements(engs.filter((e) => e.status === 'active'));
      setCards(tcs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resolveWeek = async (engagementId: string) => {
    setBusy(engagementId); setError(null);
    try {
      const { start, end } = currentWeek();
      await resolveTimecard({ engagementId, periodStart: start, periodEnd: end });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve');
    } finally {
      setBusy(null);
    }
  };

  const submit = async (id: string) => {
    setBusy(id); setError(null);
    try { await submitTimecard(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to submit'); }
    finally { setBusy(null); }
  };

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('timecard.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('timecard.subtitle')}</p>
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* Today — "what did you do today" */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('timecard.today')}</div>
        {today ? (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline', marginTop: 8 }}>
            <div><span style={{ fontSize: 26, fontWeight: 800, color: 'var(--coral-bright)' }}>{fmtHrs(today.minutes)}</span> <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('timecard.active')}</span></div>
            <div><span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{today.signalCount}</span> <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('timecard.actions')}</span></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(today.byKind).slice(0, 8).map(([k, n]) => (
                <span key={k} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{k} · {n}</span>
              ))}
            </div>
          </div>
        ) : <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 0' }}>{t('timecard.noActivity')}</p>}
      </div>

      {/* Resolve this week per active engagement */}
      {engagements.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('timecard.thisWeek')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {engagements.map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{e.tenantName ?? t('gigs.workspace')}</span>
                <button type="button" onClick={() => resolveWeek(e.id)} disabled={busy === e.id}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {busy === e.id ? t('timecard.resolving') : t('timecard.resolveWeek')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timecards */}
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('timecard.history')}</div>
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</p>
      ) : cards.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 14 }}>{t('timecard.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cards.map((c) => (
            <div key={c.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{c.tenantName ?? ''} · {c.periodStart} – {c.periodEnd}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {fmtHrs(c.billableMinutes)} {t('timecard.billable')} · {money(c.amountCents, c.currency)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{t(`timecard.status.${c.status}`)}</span>
                {c.status === 'draft' && (
                  <button type="button" onClick={() => submit(c.id)} disabled={busy === c.id}
                    style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {busy === c.id ? t('saving') : t('timecard.submit')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
