'use client';

/**
 * The CFO's finance destination — one client boundary over two sub-views (B1).
 *
 * The shell owns the index (`finance` declares `runway` and `cashflow` in
 * `navGroups.ts`); this owns the body. ONE read for both views: the runway report
 * carries the observed series, the declared side for the chosen company and the
 * company picker, so switching from Runway to Cashflow is a re-render, not a
 * refetch — and the two views can never disagree about which month is which.
 *
 * Signed in, the route opens as a panel over the board (§11.4.5) — asking "how
 * long do we have" must not cost the thing you were building.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { Select } from '@/components/Select';
import { mayRender, useRequireSession } from '@/lib/useRequireSession';
import { faultMessage } from '@/lib/apiClient';
import { financeApi, type RunwayReport } from '@/lib/financeApi';
import { RunwayView } from './RunwayView';
import { CashflowView } from './CashflowView';
import { FinanceDashboardView } from './FinanceDashboardView';
import { errorStyle, labelStyle, mutedStyle, rowStyle, sectionStyle } from './financeStyles';

export default function FinanceClient() {
  const t = useTranslations('financeHub');
  const allowed = mayRender(useRequireSession());
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') ?? '';
  const companyFromUrl = params.get('company');
  const [companyId, setCompanyId] = useState<number | null>(companyFromUrl ? Number(companyFromUrl) : null);
  const [report, setReport] = useState<RunwayReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    financeApi.runway(companyId)
      .then((next) => { if (!cancelled) { setReport(next); setError(null); } })
      .catch((cause: unknown) => { if (!cancelled) setError(faultMessage(cause, t('error.load'))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, companyId, t]);

  /** The company choice is a URL fact, so a shared link opens on the same company. */
  const selectCompany = useCallback((id: number) => {
    setCompanyId(id);
    const next = new URLSearchParams(params.toString());
    next.set('company', String(id));
    router.replace(`/finance?${next.toString()}`);
  }, [params, router]);

  if (!allowed) return null;

  return (
    <PageContainer>
      <div style={sectionStyle}>
        <div style={rowStyle}>
          <div>
            <h1 style={{ margin: 0, fontSize: 'var(--font-size-section)' }}>{t('title')}</h1>
            <p style={mutedStyle}>{t('subtitle')}</p>
          </div>
          {report && report.companies.length > 1 && (
            <div style={{ minWidth: 220 }}>
              <label style={labelStyle} htmlFor="finance-company">{t('company')}</label>
              <Select
                id="finance-company"
                value={String(report.declared?.companyId ?? companyId ?? '')}
                onChange={(e) => selectCompany(Number(e.target.value))}
              >
                {report.companies.map((company) => (
                  <option key={company.id} value={String(company.id)}>{company.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {error && <p style={errorStyle} role="alert">{error}</p>}
        {loading && !report && tab !== 'dashboard' && <p style={mutedStyle}>{t('loading')}</p>}

        {report && tab === '' && (
          <RunwayView
            // Keyed by company so switching remounts the declared inputs (see RunwayView).
            key={report.declared?.companyId ?? 'none'}
            report={report}
            onDeclared={() => financeApi.runway(companyId).then(setReport).catch(() => undefined)}
          />
        )}
        {report && tab === 'cashflow' && <CashflowView report={report} />}
        {/* The dashboard reads its own tiles, so it does not wait on the runway
            report the other two tabs share. */}
        {tab === 'dashboard' && <FinanceDashboardView />}
      </div>
    </PageContainer>
  );
}
