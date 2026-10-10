'use client';

/**
 * The CFO's finance destination — one client boundary over its sub-views (B1).
 *
 * The shell owns the index (`finance` declares its tabs in `navGroups.ts`);
 * this owns the body, looked up from the view tables below. ONE read for both views: the runway report
 * carries the observed series, the declared side for the chosen company and the
 * company picker, so switching from Runway to Cashflow is a re-render, not a
 * refetch — and the two views can never disagree about which month is which.
 *
 * Signed in, the route opens as a panel over the board (§11.4.5) — asking "how
 * long do we have" must not cost the thing you were building.
 */

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
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
import { FinanceReportsView } from './FinanceReportsView';
import { errorStyle, labelStyle, mutedStyle, rowStyle, sectionStyle } from './financeStyles';

/**
 * The tab bodies, as DATA keyed by the `?tab=` ids `navGroups.ts` declares —
 * adding a tab is a row here plus a row there, never another branch below.
 *
 * Two kinds, because the difference is real: report views render the ONE
 * runway read this component holds (so Runway and Cashflow can never disagree
 * about a month), while self-loading views read their own data and must not
 * wait on it.
 */
type ReportViewProps = { report: RunwayReport; reload: () => void };

const REPORT_VIEWS: Record<string, (props: ReportViewProps) => ReactNode> = {
  '': ({ report, reload }) => (
    // Keyed by company so switching remounts the declared inputs (see RunwayView).
    <RunwayView key={report.declared?.companyId ?? 'none'} report={report} onDeclared={reload} />
  ),
  cashflow: ({ report }) => <CashflowView report={report} />,
};

const SELF_LOADING_VIEWS: Record<string, ComponentType> = {
  dashboard: FinanceDashboardView,
  reports: FinanceReportsView,
};

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

  const reloadReport = useCallback(() => {
    financeApi.runway(companyId).then(setReport).catch(() => undefined);
  }, [companyId]);

  if (!allowed) return null;

  // An unknown `?tab=` falls back to Runway rather than rendering an empty body.
  const SelfView = SELF_LOADING_VIEWS[tab];
  const renderReportView = SelfView ? undefined : (REPORT_VIEWS[tab] ?? REPORT_VIEWS['']);

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

        {error && !SelfView && <p style={errorStyle} role="alert">{error}</p>}
        {loading && !report && renderReportView && <p style={mutedStyle}>{t('loading')}</p>}

        {/* A render function, not a component: no hooks, so no identity to keep. */}
        {report && renderReportView?.({ report, reload: reloadReport })}
        {SelfView && <SelfView />}
      </div>
    </PageContainer>
  );
}
