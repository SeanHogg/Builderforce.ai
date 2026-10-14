/**
 * The `issue` panel kind: Overview (what, where, how many, since which
 * release, on which devices) and Recordings (the representatives first, then
 * every kept recording that hit the issue).
 *
 * The recordings filter is the `issue` clause (the issue group's fingerprint,
 * PRD 33 §3.4) AND-ed onto the home's ONE filter, so the list honours whatever
 * slice the reader is looking at; the segment summary sits above it.
 */

import { useTranslations } from 'next-intl';
import { MAX_FILTER_CLAUSES, type ReplayIssueDetailDto, type ReplayFilter } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import { StatTile, useAdminData } from '@/components/admin/adminShared';
import { BarChart } from '@/components/charts/BarChart';
import { RecordingsList } from '@/components/replay/RecordingsList';
import { SegmentSummary } from '@/components/replay/SegmentSummary';
import { useInsightsScope } from '../insightsScope';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';

function useIssue(siteId: string, id: string, days: number) {
  return useAdminData<ReplayIssueDetailDto>(() => replayApi.getIssue(siteId, id, { days }), [siteId, id, days]);
}

/** The home's filter narrowed to recordings that hit the issue (its fingerprint). */
export function issueRecordingsFilter(fingerprint: string, base: ReplayFilter = { all: [] }): ReplayFilter {
  // The issue clause always wins a slot: a home filter already at the cap gives up its last clause.
  const rest = base.all.filter((clause) => clause.field !== 'issue').slice(0, MAX_FILTER_CLAUSES - 1);
  return { all: [...rest, { field: 'issue', op: 'eq', value: fingerprint }] };
}

export function IssueOverviewTab({ siteId, id }: InsightPanelKindProps) {
  const t = useTranslations('insights.issues');
  const tPlayer = useTranslations('replay.player');
  const fmt = useFormat();
  const { days } = useInsightsScope();
  const { data, loading, error } = useIssue(siteId, id, days);
  if (!data) return <PanelPending loading={loading} error={error} />;
  const section = { margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{data.title}</h3>
        <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
          {data.route} · {data.kind} · {t(`statusName.${data.status}`)}
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <StatTile label={t('overview.sessions')} value={fmt.number(data.sessions)} />
        <StatTile label={t('overview.share')} value={fmt.percent(data.share, 1)} />
        <StatTile label={t('overview.firstSeen')} value={fmt.date(data.firstSeenAt)} hint={data.firstRelease?.slice(0, 12)} />
        <StatTile label={t('overview.lastSeen')} value={fmt.date(data.lastSeenAt)} hint={data.lastRelease?.slice(0, 12)} />
      </div>
      {data.byRelease.length > 0 && (
        <section>
          <h4 style={section}>{t('overview.byRelease')}</h4>
          <BarChart monochrome ariaLabel={t('overview.byRelease')} data={data.byRelease.map((row) => ({ key: row.releaseKey, label: row.releaseKey.slice(0, 12), value: row.sessions }))} />
        </section>
      )}
      {data.byDevice.length > 0 && (
        <section>
          <h4 style={section}>{t('overview.byDevice')}</h4>
          <BarChart monochrome ariaLabel={t('overview.byDevice')} data={data.byDevice.map((row) => ({ key: row.deviceClass, label: tPlayer(`deviceClass.${row.deviceClass}`), value: row.sessions }))} />
        </section>
      )}
    </div>
  );
}

export function IssueRecordingsTab({ siteId, id, push }: InsightPanelKindProps) {
  const t = useTranslations('insights.issues');
  const fmt = useFormat();
  const { days, filter } = useInsightsScope();
  const { data, loading, error } = useIssue(siteId, id, days);
  if (!data) return <PanelPending loading={loading} error={error} />;
  const open = (recordingId: string) => push({ kind: 'recording', id: recordingId, tab: 'replay' });
  const recordingsFilter = issueRecordingsFilter(data.fingerprint, filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
      {data.representatives.length > 0 && (
        <section>
          <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)' }}>{t('representatives')}</h3>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {data.representatives.map((rep) => (
              <li key={rep.recordingId}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ minHeight: 44, width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
                  aria-label={t('repAria', { rank: rep.rank })}
                  onClick={() => open(rep.recordingId)}
                >
                  #{rep.rank} · {rep.label ?? rep.recordingId.slice(0, 8)} · {fmt.percent(rep.share, 0)}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section>
        <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>
          {t('recordingsOfIssue', { route: data.route })}
        </h3>
        <SegmentSummary
          key={JSON.stringify(recordingsFilter)}
          siteId={siteId}
          days={days}
          filter={recordingsFilter}
          onOpenRecording={(recordingId, seconds) => push({ kind: 'recording', id: recordingId, tab: 'replay', t: seconds })}
        />
        <RecordingsList siteId={siteId} days={days} filter={recordingsFilter} onOpen={open} />
      </section>
    </div>
  );
}
