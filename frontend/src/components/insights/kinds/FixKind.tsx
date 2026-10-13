/**
 * The `fix` panel kind (PRD 33 §4.1: Change · Prompt · Measure) and the `issue`
 * kind's Fix and History tabs — one prescription, read by id.
 *
 *   Change   THE fix card in full (`PrescriptionCard`), with its actions.
 *   Measure  the acceptance test, the measured before → after and verdict, and
 *            the status history (`prescriptionHistory`).
 *
 * The Prompt tab is S4f's (the page review's improvement prompt) — a row it adds
 * to this kind, not a branch here. The issue tabs read the issue's
 * `prescriptionId` and show the same two views.
 */

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayIssueDetailDto, ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import { useAdminData } from '@/components/admin/adminShared';
import { PrescriptionCard } from '@/components/replay/prescriptions/PrescriptionCard';
import { MeasuredLine } from '@/components/replay/prescriptions/PrescriptionParts';
import { prescriptionHistory } from '@/components/replay/prescriptions/prescriptionModel';
import { useInsightsScope } from '../insightsScope';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';

function usePrescription(siteId: string, id: string | null) {
  return useAdminData<ReplayPrescriptionDto | null>(
    () => (id ? replayApi.getPrescription(siteId, id) : Promise.resolve(null)),
    [siteId, id],
  );
}

const heading = { margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' } as const;

/** The acceptance test, the measured verdict and the status history of one fix. */
export function FixMeasure({ prescription: p }: { prescription: ReplayPrescriptionDto }) {
  const t = useTranslations('insights.fix');
  const tRx = useTranslations('replay.prescription');
  const fmt = useFormat();
  const a = p.acceptance;
  const metricKey = a ? `metric.${a.metric}` : '';
  const history = prescriptionHistory(p);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
      <section>
        <h3 style={heading}>{t('measure.acceptanceTitle')}</h3>
        <p style={{ margin: 0 }}>
          {a
            ? tRx('acceptance.text', {
              metric: tRx.has(metricKey) ? tRx(metricKey) : a.metric,
              direction: tRx(`acceptance.direction.${a.direction}`),
              minVisits: fmt.number(a.minVisits),
            })
            : t('measure.acceptanceNone')}
        </p>
      </section>
      <section>
        <h3 style={heading}>{t('measure.resultTitle')}</h3>
        {p.measured || p.status === 'dismissed' ? <MeasuredLine p={p} /> : <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('measure.notYet')}</p>}
      </section>
      <FixHistory prescription={p} entries={history} />
    </div>
  );
}

function FixHistory({ prescription, entries }: { prescription: ReplayPrescriptionDto; entries: ReturnType<typeof prescriptionHistory> }) {
  const t = useTranslations('insights.fix');
  const tRx = useTranslations('replay.prescription');
  const fmt = useFormat();
  const valuesOf = (values: Record<string, string>) => ({
    ...values,
    ...(values.action ? { action: tRx.has(`maker.${values.action}`) ? tRx(`maker.${values.action}`) : values.action } : {}),
    ...(values.verdict ? { verdict: tRx(`verdict.${values.verdict}`) } : {}),
  });
  return (
    <section aria-label={t('history.title')}>
      <h3 style={heading}>{t('history.title')}</h3>
      <ol data-testid="fix-history" style={{ margin: 0, paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {entries.map((entry) => (
          <li key={`${entry.key}:${entry.at ?? ''}`} data-entry={entry.key} style={{ overflowWrap: 'anywhere' }}>
            {t(`history.${entry.key}`, valuesOf(entry.values))}
            {entry.at && <span style={{ color: 'var(--text-secondary)' }}> · {fmt.date(entry.at)}</span>}
          </li>
        ))}
      </ol>
      <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
        {tRx(`status.${prescription.status}`)}
      </p>
    </section>
  );
}

export function FixChangeTab({ siteId, id, push }: InsightPanelKindProps) {
  const { data, loading, error, setData } = usePrescription(siteId, id);
  if (!data) return <PanelPending loading={loading} error={error} />;
  return <PrescriptionCard siteId={siteId} prescription={data} push={push} onChanged={setData} />;
}

export function FixMeasureTab({ siteId, id }: InsightPanelKindProps) {
  const { data, loading, error } = usePrescription(siteId, id);
  if (!data) return <PanelPending loading={loading} error={error} />;
  return <FixMeasure prescription={data} />;
}

/** The issue's prescription id (null until a sweep prescribes one). */
function useIssuePrescription(siteId: string, issueId: string) {
  const { days } = useInsightsScope();
  const issue = useAdminData<ReplayIssueDetailDto>(() => replayApi.getIssue(siteId, issueId, { days }), [siteId, issueId, days]);
  const prescriptionId = issue.data?.prescriptionId ?? null;
  const fix = usePrescription(siteId, prescriptionId);
  return { issue, fix, prescriptionId };
}

type IssueFixView = (p: ReplayPrescriptionDto, props: InsightPanelKindProps, onChanged: (next: ReplayPrescriptionDto) => void) => ReactNode;

function IssueFixBody({ view, ...props }: InsightPanelKindProps & { view: IssueFixView }) {
  const t = useTranslations('insights.fix');
  const { issue, fix, prescriptionId } = useIssuePrescription(props.siteId, props.id);
  if (!issue.data) return <PanelPending loading={issue.loading} error={issue.error} />;
  if (!prescriptionId) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noFix')}</p>;
  if (!fix.data) return <PanelPending loading={fix.loading} error={fix.error} />;
  return <>{view(fix.data, props, fix.setData)}</>;
}

const issueFixView: IssueFixView = (p, { siteId, push }, onChanged) => (
  <PrescriptionCard siteId={siteId} prescription={p} push={push} onChanged={onChanged} />
);
const issueHistoryView: IssueFixView = (p) => <FixMeasure prescription={p} />;

export function IssueFixTab(props: InsightPanelKindProps) {
  return <IssueFixBody {...props} view={issueFixView} />;
}

export function IssueHistoryTab(props: InsightPanelKindProps) {
  return <IssueFixBody {...props} view={issueHistoryView} />;
}
