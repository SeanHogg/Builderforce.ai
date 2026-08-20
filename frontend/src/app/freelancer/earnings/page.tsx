'use client';

/**
 * MY EARNINGS — the statement, the fee, and where the money goes.
 *
 * Three things a for-hire account could not see at all before this page: what it has
 * earned across every workspace that has hired it, what the platform's cut is and why,
 * and how it has told us to pay it.
 *
 * ── ONE FETCH PER QUESTION, AND NO CLIENT CACHE ──────────────────────────────────
 * The report is cached on the server behind a per-user version token that every money
 * write bumps. A second cache here would only add a window in which a release has
 * happened and this page still says it has not — the one number a person will not
 * forgive being wrong.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { EarningsReportView } from '@/components/earnings/EarningsReport';
import { WithdrawalMethods } from '@/components/earnings/WithdrawalMethods';
import {
  getEarningsReport,
  listWithdrawalMethods,
  type EarningsPeriod,
  type EarningsReport,
  type WithdrawalMethodsView,
} from '@/lib/earningsApi';

export const runtime = 'edge';

export default function FreelancerEarningsPage() {
  const t = useTranslations('earnings');
  const [report, setReport] = useState<EarningsReport | null>(null);
  const [methods, setMethods] = useState<WithdrawalMethodsView | null>(null);
  const [period, setPeriod] = useState<EarningsPeriod>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async (next: EarningsPeriod) => {
    const fetched = await getEarningsReport({ period: next });
    setReport(fetched);
  }, []);

  const loadMethods = useCallback(async () => {
    // A person with no workspace yet gets a 404 here on their very first visit, and
    // that is not an error worth a page-level failure: the report is still the point,
    // and the panel simply has nothing to list until the workspace is provisioned.
    try {
      setMethods(await listWithdrawalMethods());
    } catch {
      setMethods(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadReport(period), loadMethods()]);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadMethods, loadReport, period]);

  return (
    <PageContainer>
      <header style={{ display: 'grid', gap: 6, marginBottom: 18 }}>
        <h1 style={{
          margin: 0, fontSize: 'var(--font-size-page-title)', fontWeight: 800,
          color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
        }}>{t('pageTitle')}</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('pageSubtitle')}
        </p>
        <Link href="/freelancer/disputes" style={{ color: 'var(--cyan-bright)', fontSize: 'var(--font-size-small)' }}>
          {t('disputesLink')}
        </Link>
      </header>

      {error && (
        <p role="alert" style={{ margin: '0 0 14px', color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>
          {error}
        </p>
      )}

      {loading && !report && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>
      )}

      <div style={{ display: 'grid', gap: 18 }}>
        {report && (
          <EarningsReportView
            report={report}
            period={period}
            onPeriodChange={setPeriod}
            busy={loading}
          />
        )}
        {methods && <WithdrawalMethods view={methods} onChanged={loadMethods} />}
        {/* Named rather than quietly absent — a person looking for tax documents needs
            to be told they are not here yet, not left searching the page for them. */}
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-eyebrow)' }}>
          {t('taxFormsUnavailable')}
        </p>
      </div>
    </PageContainer>
  );
}
