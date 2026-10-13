/**
 * The `issues` panel kind: every issue group for the window and filter,
 * cursor-paginated (the home band shows only the rows that fit).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayIssueDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useCursorPages } from '@/hooks/useCursorPages';
import { useInsightsScope } from '../insightsScope';
import { ISSUE_STATUS_TABS, IssueRows, IssueStatusTabs } from '../issueList';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';

export function IssuesKind({ siteId, push }: InsightPanelKindProps) {
  const t = useTranslations('insights.issues');
  const errorText = useErrorText();
  const { days, filter, setRoute } = useInsightsScope();
  const [statusTab, setStatusTab] = useState('all');
  const status = ISSUE_STATUS_TABS.find((tab) => tab.id === statusTab)?.status ?? null;
  const pages = useCursorPages<ReplayIssueDto>(
    JSON.stringify([siteId, days, status, filter]),
    (cursor) => replayApi.listIssues(siteId, { days, status, cursor, filter }),
  );
  const error = pages.error ? errorText(pages.error) : '';

  const open = (issue: ReplayIssueDto) => {
    setRoute(issue.route);
    push({ kind: 'issue', id: issue.id, tab: 'overview' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <IssueStatusTabs value={statusTab} onChange={setStatusTab} />
      {pages.items.length > 0 && <IssueRows issues={pages.items} onOpen={open} />}
      {!pages.loading && !error && pages.items.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
      <PanelPending loading={pages.loading} error={error} />
      {pages.hasMore && !pages.loading && (
        <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={pages.loadMore}>
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
