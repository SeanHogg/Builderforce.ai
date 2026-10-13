/**
 * The `funnel` kind's Steps tab (PRD 33 §2.1 "Funnels — with watch who dropped
 * at step N"): the site's funnels, the chosen one evaluated over the window and
 * the ONE filter — a bar per step, conversion from the previous step, the
 * median time from it, and for every step after the first the recordings that
 * dropped there. Funnels run over kept recordings, so every number is ≈ (D18).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayFunnelDto, ReplayFunnelEvalDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import { useAdminData } from '@/components/admin/adminShared';
import { BarChart } from '@/components/charts/BarChart';
import { PanelPending } from '@/components/insights/kinds/PanelPending';
import { useInsightsScope } from '@/components/insights/insightsScope';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { fmtClock } from '../replayMarks';
import { DroppedRecordings } from './DroppedRecordings';
import { funnelEditLevel } from './funnelLevel';
import { PrescriptionCard } from '../prescriptions/PrescriptionCard';
import { usePrescriptionsFor } from '../prescriptions/usePrescriptionsFor';

export interface FunnelsViewProps {
  siteId: string;
  /** The funnel to open on (the level id's `funnel=`); the first one otherwise. */
  initialFunnelId?: string;
  push: (level: InsightPanelLevel) => void;
}

export function FunnelsView({ siteId, initialFunnelId, push }: FunnelsViewProps) {
  const t = useTranslations('replay.funnels');
  const funnels = useAdminData<ReplayFunnelDto[]>(() => replayApi.listFunnels(siteId), [siteId]);
  const [chosen, setChosen] = useState<string | null>(initialFunnelId ?? null);
  const list = funnels.data ?? [];
  const selected = list.find((funnel) => funnel.id === chosen) ?? list[0] ?? null;

  if (!funnels.data) return <PanelPending loading={funnels.loading} error={funnels.error} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
        {list.length > 1 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-small)' }}>
            <span>{t('choose')}</span>
            <select className="input" value={selected?.id ?? ''} onChange={(event) => setChosen(event.currentTarget.value)} style={{ minHeight: 44 }}>
              {list.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}
            </select>
          </label>
        )}
        {selected && list.length === 1 && <strong>{selected.name}</strong>}
        {selected && (
          <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => push(funnelEditLevel(selected.id))}>{t('edit')}</button>
        )}
        <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => push(funnelEditLevel())}>{t('new')}</button>
      </div>
      {!selected && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
      {selected && <FunnelSteps siteId={siteId} funnel={selected} push={push} />}
    </div>
  );
}

function FunnelSteps({ siteId, funnel, push }: { siteId: string; funnel: ReplayFunnelDto; push: (level: InsightPanelLevel) => void }) {
  const t = useTranslations('replay.funnels');
  const fmt = useFormat();
  const { days, filter } = useInsightsScope();
  const filterKey = JSON.stringify(filter);
  const [watching, setWatching] = useState<number | null>(null);
  const { data, loading, error } = useAdminData<ReplayFunnelEvalDto>(
    () => replayApi.evaluateFunnel(siteId, funnel.id, { days, filter }),
    [siteId, funnel.id, days, filterKey],
  );
  if (!data) return <PanelPending loading={loading} error={error} />;
  const approx = (value: string) => t('approx', { value });

  return (
    <section aria-label={t('stepsAria', { name: funnel.name })} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <p role="note" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('estimatedNote')}</p>
      {data.truncated && <p role="note" style={{ margin: 0, color: 'var(--warning)', fontSize: 'var(--font-size-small)' }}>{t('truncated')}</p>}
      <BarChart
        monochrome
        labelWidth={140}
        ariaLabel={t('chartAria', { name: funnel.name })}
        formatValue={(value) => approx(fmt.number(value))}
        data={data.steps.map((step) => ({ key: String(step.ord), label: step.label, value: step.visits }))}
      />
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {data.steps.map((step, index) => {
          const dropped = step.droppedRecordingIds.length;
          return (
            <li
              key={step.ord}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', minWidth: 0 }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
                <strong style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{index + 1}. {step.label}</strong>
                <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
                  {t('visits', { value: approx(fmt.number(step.visits)) })}
                </span>
                {step.conversionFromPrevPct != null && (
                  <span style={{ fontSize: 'var(--font-size-small)' }}>{t('conversion', { value: fmt.percent(step.conversionFromPrevPct / 100, 1) })}</span>
                )}
                {step.medianTimeFromPrevMs != null && (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
                    {t('medianTime', { value: approx(fmtClock(step.medianTimeFromPrevMs)) })}
                  </span>
                )}
                {dropped > 0 && (
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-expanded={watching === step.ord}
                    style={{ minHeight: 44, marginLeft: 'auto' }}
                    onClick={() => setWatching((current) => (current === step.ord ? null : step.ord))}
                  >
                    {t('watchDropped', { count: dropped })}
                  </button>
                )}
              </div>
              {watching === step.ord && (
                <>
                  <StepPrescriptions siteId={siteId} funnelId={funnel.id} ord={step.ord} push={push} />
                  <DroppedRecordings
                    siteId={siteId}
                    ids={step.droppedRecordingIds}
                    onOpen={(recordingId) => push({ kind: 'recording', id: recordingId, tab: 'replay' })}
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * "Prescribed fix" in a step's drop panel (PRD 33 §5.1): the `error_on_step`
 * fixes whose subject is this funnel step (`<funnelId>:<ord>:<fingerprint>`),
 * as THE fix card, compact. Nothing when there is none.
 */
function StepPrescriptions({ siteId, funnelId, ord, push }: { siteId: string; funnelId: string; ord: number; push: (level: InsightPanelLevel) => void }) {
  const t = useTranslations('replay.fixes');
  const { items } = usePrescriptionsFor({ siteId, subject: `${funnelId}:${ord}:` });
  if (items.length === 0) return null;
  return (
    <section aria-label={t('stepTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('stepTitle')}</strong>
      {items.map((p) => <PrescriptionCard key={p.id} compact siteId={siteId} prescription={p} push={push} />)}
    </section>
  );
}
