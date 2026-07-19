'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { buildInsightDelta } from '@/components/dashboard/metricFormat';
import { cumulativeDailySeries, cumulativeDailyTotals } from '@/components/dashboard/seriesFromTimestamps';
import { TabCountBadge } from '@/components/TabCountBadge';
import { MessagesButton } from '@/components/freelance/MessagesButton';
import { RateClientButton } from '@/components/freelance/RateClientButton';
import { useAvailableForHire } from '@/lib/rbac';
import { useAuth } from '@/lib/AuthContext';
import { useOnboardingPrompt } from '@/lib/onboarding';
import { OnboardingStepper } from '@/components/OnboardingStepper';
import {
  listMyEngagements, listMyTimecards, listMyInvoices, getTodayActivity,
  type Engagement, type Timecard, type Invoice,
} from '@/lib/freelancerApi';

const FREELANCER_TABS = ['work', 'timecards'] as const;
type FreelancerTab = (typeof FREELANCER_TABS)[number];

const money = (cents: number, cur = 'USD') => `${cur} ${(cents / 100).toFixed(2)}`;
const fmtHrs = (min: number) => `${(min / 60).toFixed(1)}h`;

const ENGAGEMENT_TONE: Record<Engagement['status'], string> = {
  invited: 'var(--warning-text, #b45309)',
  interviewing: 'var(--cyan-bright, #00e5cc)',
  active: 'rgba(34,197,94,0.9)',
  declined: 'var(--text-muted)',
  terminated: 'var(--text-muted)',
};

const TIMECARD_TONE: Record<Timecard['status'], string> = {
  draft: 'var(--text-muted)',
  submitted: 'var(--cyan-bright, #00e5cc)',
  approved: 'rgba(34,197,94,0.9)',
  rejected: 'var(--danger, #dc2626)',
  paid: 'var(--coral-bright, #f4726e)',
};

/**
 * Job-seeker (for-hire worker) dashboard — the at-a-glance home for a freelancer
 * or an opted-in builder. Charts the four things a gig worker tracks (active
 * engagements, billable hours, paid + pending earnings) with honest 14-day trend
 * sparklines derived from data already fetched, then two tabs: My Work
 * (engagements) and My Timecards. Reuses the shared InsightStat/TabCountBadge
 * primitives and the freelancerApi worker endpoints (web-token scoped) — no new
 * fetch surface.
 */
export default function FreelancerDashboardPage() {
  const t = useTranslations('freelancerDashboard');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, webToken } = useAuth();
  const forHire = useAvailableForHire();
  // A hired account never reaches /dashboard (the shell blocks it), so this is
  // where its setup wizard lives — same shared decision, hired step track.
  const onboarding = useOnboardingPrompt();

  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [timecards, setTimecards] = useState<Timecard[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [today, setToday] = useState<{ signalCount: number; minutes: number; byKind: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);

  const tabParam = searchParams.get('tab');
  const activeTab: FreelancerTab = (FREELANCER_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as FreelancerTab)
    : 'work';
  const selectTab = (key: FreelancerTab) =>
    router.replace(key === 'work' ? '/freelancer/dashboard' : `/freelancer/dashboard?tab=${key}`, { scroll: false });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      listMyEngagements().catch(() => [] as Engagement[]),
      listMyTimecards().catch(() => [] as Timecard[]),
      listMyInvoices().catch(() => [] as Invoice[]),
      getTodayActivity().catch(() => null),
    ]).then(([engs, tcs, invs, act]) => {
      if (!alive) return;
      setEngagements(Array.isArray(engs) ? engs : []);
      setTimecards(Array.isArray(tcs) ? tcs : []);
      setInvoices(Array.isArray(invs) ? invs : []);
      setToday(act);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const activeEngagements = useMemo(() => engagements.filter((e) => e.status === 'active'), [engagements]);
  const paidInvoices = useMemo(() => invoices.filter((i) => i.status === 'paid'), [invoices]);
  const pendingInvoices = useMemo(() => invoices.filter((i) => i.status === 'pending'), [invoices]);

  const totalBillableMin = useMemo(() => timecards.reduce((s, tc) => s + (tc.billableMinutes || 0), 0), [timecards]);
  const paidCents = useMemo(() => paidInvoices.reduce((s, i) => s + (i.amountCents || 0), 0), [paidInvoices]);
  const pendingCents = useMemo(() => pendingInvoices.reduce((s, i) => s + (i.amountCents || 0), 0), [pendingInvoices]);
  const currency = paidInvoices[0]?.currency ?? pendingInvoices[0]?.currency ?? 'USD';

  const engagementSeries = useMemo(() => cumulativeDailySeries(engagements.map((e) => e.hiredAt)), [engagements]);
  const hoursSeries = useMemo(
    () => cumulativeDailyTotals(timecards.map((tc) => ({ ts: tc.submittedAt ?? tc.periodEnd, value: (tc.billableMinutes || 0) / 60 }))),
    [timecards],
  );
  const paidSeries = useMemo(
    () => cumulativeDailyTotals(paidInvoices.map((i) => ({ ts: i.paidAt, value: (i.amountCents || 0) / 100 }))),
    [paidInvoices],
  );
  const pendingSeries = useMemo(
    () => cumulativeDailyTotals(pendingInvoices.map((i) => ({ ts: i.issuedAt, value: (i.amountCents || 0) / 100 }))),
    [pendingInvoices],
  );

  if (!isAuthenticated) return null;

  // A builder who hasn't opted into being hired has no worker data — nudge them
  // to the opt-in rather than showing four empty tiles.
  if (!forHire && !loading) {
    return (
      <PageContainer>
        <div style={{ maxWidth: 520, margin: '48px auto', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>{t('optIn.title')}</h1>
          <p style={{ fontSize: 14, margin: '0 0 18px' }}>{t('optIn.body')}</p>
          <Link
            href="/settings"
            style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 8, background: 'var(--coral-bright)', color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}
          >
            {t('optIn.cta')}
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer style={{ padding: 0 }}>
      {onboarding.show && webToken && (
        <OnboardingStepper
          webToken={webToken}
          onComplete={onboarding.complete}
          onDismiss={onboarding.dismiss}
        />
      )}
      <main style={{ padding: '24px 16px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>{t('heading')}</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>{t('subheading')}</p>
          </div>
          <MessagesButton side="freelancer" />
        </div>

        {/* Metric tiles — each with a 14-day trend sparkline. */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ marginBottom: 32 }}>
            <InsightStat
              label={t('metric.activeEngagements')}
              value={String(activeEngagements.length)}
              sub={t('metric.totalEngagements', { count: engagements.length })}
              series={engagementSeries}
              delta={buildInsightDelta(engagementSeries, true)}
              href="/marketplace?category=gigs"
              color="var(--coral-bright, #f4726e)"
            />
            <InsightStat
              label={t('metric.billableHours')}
              value={fmtHrs(totalBillableMin)}
              sub={today ? t('metric.todayHours', { hours: (today.minutes / 60).toFixed(1) }) : ''}
              series={hoursSeries}
              delta={buildInsightDelta(hoursSeries, true)}
              href="/freelancer/timecard"
              color="var(--cyan-bright, #00e5cc)"
            />
            <InsightStat
              label={t('metric.paidEarnings')}
              value={money(paidCents, currency)}
              sub={t('metric.invoicesPaid', { count: paidInvoices.length })}
              series={paidSeries}
              delta={buildInsightDelta(paidSeries, true)}
              href="/freelancer/timecard"
              color="rgba(34,197,94,0.9)"
            />
            <InsightStat
              label={t('metric.pendingEarnings')}
              value={money(pendingCents, currency)}
              sub={t('metric.invoicesPending', { count: pendingInvoices.length })}
              series={pendingSeries}
              delta={buildInsightDelta(pendingSeries, null)}
              href="/freelancer/timecard"
              color={pendingCents > 0 ? 'rgba(245,158,11,0.9)' : 'var(--text-muted)'}
            />
          </div>
        )}

        {/* Tabs — My Work / My Timecards */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 24, overflowX: 'auto' }}>
          {([
            { key: 'work', label: t('tabs.work'), count: engagements.length },
            { key: 'timecards', label: t('tabs.timecards'), count: timecards.length },
          ] as const).map(({ key, label, count }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectTab(key)}
                style={{
                  padding: '10px 16px', fontSize: '0.9rem', fontWeight: 600, background: 'none', border: 'none',
                  borderBottom: active ? '2px solid var(--coral-bright)' : '2px solid transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
                }}
              >
                {label}
                <TabCountBadge count={loading ? null : count} />
              </button>
            );
          })}
        </div>

        {loading && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('loading')}</div>}

        {/* My Work — engagements */}
        {!loading && activeTab === 'work' && (
          engagements.length === 0 ? (
            <EmptyState message={t('work.empty')} ctaHref="/marketplace?category=gigs" ctaLabel={t('work.findWork')} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {engagements.map((e) => (
                <div key={e.id} style={rowStyle}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.title || t('work.untitled')}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.tenantName ?? '—'}</span>
                  </span>
                  {e.rateCents != null && (
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{money(e.rateCents, e.currency)}</span>
                  )}
                  {(e.status === 'active' || e.status === 'interviewing' || e.status === 'invited') && (
                    <MessagesButton side="freelancer" variant="inline" label="" context={{ engagementId: e.id, title: e.title ?? undefined }} />
                  )}
                  {(e.status === 'active' || e.status === 'terminated') && e.hiredAt && (
                    <RateClientButton engagementId={e.id} clientName={e.tenantName} />
                  )}
                  <span style={{ ...badgeStyle, color: ENGAGEMENT_TONE[e.status] }}>{t(`work.status.${e.status}`)}</span>
                </div>
              ))}
            </div>
          )
        )}

        {/* My Timecards */}
        {!loading && activeTab === 'timecards' && (
          timecards.length === 0 ? (
            <EmptyState message={t('timecards.empty')} ctaHref="/freelancer/timecard" ctaLabel={t('timecards.manage')} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
                <Link href="/freelancer/timecard" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
                  {t('timecards.manage')} →
                </Link>
              </div>
              {timecards.map((tc) => (
                <div key={tc.id} style={rowStyle}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                      {tc.periodStart} – {tc.periodEnd}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tc.tenantName ?? '—'} · {fmtHrs(tc.billableMinutes)}</span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{money(tc.amountCents, tc.currency)}</span>
                  <span style={{ ...badgeStyle, color: TIMECARD_TONE[tc.status] }}>{t(`timecards.status.${tc.status}`)}</span>
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </PageContainer>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
  border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-elevated)',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
};

function EmptyState({ message, ctaHref, ctaLabel }: { message: string; ctaHref: string; ctaLabel: string }) {
  return (
    <div style={{ border: '1px dashed var(--border-subtle)', borderRadius: 12, padding: '28px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
      <p style={{ margin: '0 0 12px', fontSize: 14 }}>{message}</p>
      <Link href={ctaHref} style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 8, background: 'var(--coral-bright)', color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
        {ctaLabel}
      </Link>
    </div>
  );
}
