/**
 * Issues band (PRD 33 §4.1, 38% column): issue groups ranked for the window,
 * bounded to the rows that fit; "View all" opens the `issues` kind, a row the
 * `issue` kind. The first issue's route seeds the Page stage.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayIssueDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';
import { ISSUE_STATUS_TABS, IssueRows, IssueStatusTabs } from '../issueList';

/** Rows the 1440×900 home has room for (D16: nothing below the fold). */
export const HOME_ISSUE_ROWS = 6;

export function IssuesTable() {
  const t = useTranslations('insights.issues');
  const { siteId, days, filter, route, setRoute } = useInsightsScope();
  const { push } = usePanel();
  const [statusTab, setStatusTab] = useState('all');
  const status = ISSUE_STATUS_TABS.find((tab) => tab.id === statusTab)?.status ?? null;
  const filterKey = JSON.stringify(filter);
  const { data, loading, error } = useAdminData(
    () => replayApi.listIssues(siteId, { days, status, filter, limit: HOME_ISSUE_ROWS }),
    [siteId, days, status, filterKey],
  );
  const issues = (data?.items ?? []).slice(0, HOME_ISSUE_ROWS);
  const firstRoute = issues[0]?.route ?? null;

  useEffect(() => {
    if (!route && firstRoute) setRoute(firstRoute);
  }, [route, firstRoute, setRoute]);

  const open = (issue: ReplayIssueDto) => {
    setRoute(issue.route);
    push({ kind: 'issue', id: issue.id, tab: 'overview' });
  };

  return (
    <section aria-labelledby="insights-issues-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minHeight: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h3 id="insights-issues-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</h3>
        <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => push({ kind: 'issues', id: '' })}>
          {t('viewAll')}
        </button>
      </div>
      <IssueStatusTabs value={statusTab} onChange={setStatusTab} />
      <div style={{ minHeight: 0, overflow: 'auto' }}>
        {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('error')} {error}</p>}
        {!error && loading && !data && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
        {!error && data && issues.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
        {issues.length > 0 && <IssueRows issues={issues} onOpen={open} />}
      </div>
    </section>
  );
}
