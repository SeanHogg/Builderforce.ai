/**
 * The `issues` panel kind: every issue group for the window and filter,
 * cursor-paginated (the home band shows only the rows that fit).
 *
 * The level id, when set, is a narrowing filter as a query string
 * (`filterToQuery` — e.g. the heatmap's "visits on /pricing that clicked
 * this element"), AND-ed onto the home's filter.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { filterFromQuery, type ReplayFilter, type ReplayIssueDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useCursorPages } from '@/hooks/useCursorPages';
import { useInsightsScope } from '../insightsScope';
import { ISSUE_STATUS_TABS, IssueRows, IssueStatusTabs } from '../issueList';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';
import { SegmentSummary } from '@/components/replay/SegmentSummary';

export function IssuesKind({ siteId, id, push }: InsightPanelKindProps) {
  const t = useTranslations('insights.issues');
  const errorText = useErrorText();
  const { days, filter: homeFilter, setRoute } = useInsightsScope();
  const filter = useMemo<ReplayFilter>(() => {
    const narrowing = id ? filterFromQuery(id).all : [];
    return narrowing.length > 0 ? { all: [...homeFilter.all, ...narrowing] } : homeFilter;
  }, [id, homeFilter]);
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
      <SegmentSummary key={JSON.stringify(filter)} siteId={siteId} days={days} filter={filter} onOpenRecording={(recordingId, seconds) => push({ kind: 'recording', id: recordingId, tab: 'replay', t: seconds })} />
      <IssueStatusTabs value={statusTab} onChange={setStatusTab} />
      {/* A filter is answered from kept recordings (≈), exactly as the API marks it `estimated`. */}
      {pages.items.length > 0 && filter.all.length > 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('estimatedNote')}</p>
      )}
      {pages.items.length > 0 && <IssueRows issues={pages.items} onOpen={open} estimated={filter.all.length > 0} />}
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
