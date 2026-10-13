/**
 * The issue list's shared parts: the status tabs (data) and the rows. The
 * home's Issues band shows the rows that fit; the `issues` panel kind pages
 * through all of them. Same rows, same tabs, two bounds.
 */

import { useTranslations } from 'next-intl';
import type { ReplayIssueDto, ReplayIssueStatus } from '@builderforce/interaction-contract';
import { useFormat } from '@/i18n/useFormat';
import { Sparkline } from '@/components/charts/Sparkline';

export interface IssueStatusTab {
  id: string;
  labelKey: string;
  /** Sent as `?status=`; null lists every open status. */
  status: ReplayIssueStatus | null;
}

export const ISSUE_STATUS_TABS: ReadonlyArray<IssueStatusTab> = [
  { id: 'all', labelKey: 'status.all', status: null },
  { id: 'new', labelKey: 'status.new', status: 'new' },
  { id: 'regressed', labelKey: 'status.regressed', status: 'regressed' },
  { id: 'ongoing', labelKey: 'status.ongoing', status: 'ongoing' },
];

export function IssueStatusTabs({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useTranslations('insights.issues');
  return (
    <div role="tablist" aria-label={t('statusAria')} style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
      {ISSUE_STATUS_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={value === tab.id ? 'btn-secondary' : 'btn-ghost'}
          style={{ minHeight: 44 }}
          onClick={() => onChange(tab.id)}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
}

export function IssueRows({ issues, onOpen }: { issues: readonly ReplayIssueDto[]; onOpen: (issue: ReplayIssueDto) => void }) {
  const t = useTranslations('insights.issues');
  const fmt = useFormat();
  return (
    <div className="table-wrap" style={{ overflowX: 'auto', minWidth: 0 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('colIssue')}</th>
            <th style={{ textAlign: 'right' }}>{t('colSessions')}</th>
            <th style={{ textAlign: 'right' }}>{t('colShare')}</th>
            <th>{t('colTrend')}</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} onClick={() => onOpen(issue)} style={{ cursor: 'pointer' }}>
              <td style={{ minWidth: 0 }}>
                <button
                  type="button"
                  aria-label={t('rowAria', { title: issue.title })}
                  onClick={(event) => { event.stopPropagation(); onOpen(issue); }}
                  style={{ display: 'block', minHeight: 44, width: '100%', padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)' }}
                >
                  <span style={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>{issue.title}</span>
                  <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>
                    {issue.route} · {t(`statusName.${issue.status}`)}
                  </span>
                </button>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(issue.sessions)}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.percent(issue.share, 1)}</td>
              <td>
                <Sparkline values={issue.sparkline} width={72} height={20} color="var(--accent)" ariaLabel={t('trendAria', { title: issue.title })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
