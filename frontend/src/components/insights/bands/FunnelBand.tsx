/**
 * Funnel band (PRD 33 §4.1): the site's first funnel as one row of segments —
 * each step's visits and its conversion from the step before, all ≈ (funnels
 * run over kept recordings, D18) — over the window and the ONE filter. A
 * segment opens the `funnel` kind on that funnel. A site with no funnel gets
 * "Create a funnel", which opens the editor as a level of the ONE panel
 * (`funnel_edit`, D16) — and the band reads again when the panel moves on.
 */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayFunnelDto, ReplayFunnelEvalDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import { useAdminData } from '@/components/admin/adminShared';
import { funnelEditLevel, funnelLevelId } from '@/components/replay/funnels/funnelLevel';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';

interface Segment {
  ord: number;
  label: string;
  visits: number | null;
  conversionFromPrevPct: number | null;
}

const segmentStyle = {
  flex: '1 1 0',
  minWidth: 96,
  minHeight: 44,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  padding: 'var(--space-1) var(--space-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

export function FunnelBand() {
  const t = useTranslations('insights.funnel.band');
  const fmt = useFormat();
  const { siteId, days, filter } = useInsightsScope();
  const { push, levels } = usePanel();
  const funnels = useAdminData<ReplayFunnelDto[]>(() => replayApi.listFunnels(siteId), [siteId]);
  const first = funnels.data?.[0] ?? null;
  const hasFunnel = first !== null;
  const reloadFunnels = funnels.reload;
  // A funnel created in the panel's editor level: read again once the panel moves on from it.
  const editing = levels.some((level) => level.kind === 'funnel_edit');
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && !hasFunnel) reloadFunnels();
    wasEditing.current = editing;
  }, [hasFunnel, editing, reloadFunnels]);
  const filterKey = JSON.stringify(filter);
  const evaluation = useAdminData<ReplayFunnelEvalDto | null>(
    () => (first ? replayApi.evaluateFunnel(siteId, first.id, { days, filter }) : Promise.resolve(null)),
    [siteId, first?.id, days, filterKey],
  );

  if (!funnels.data) return null;

  if (!first) {
    return (
      <section aria-label={t('aria')} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('none')}</span>
        <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => push(funnelEditLevel())}>{t('create')}</button>
      </section>
    );
  }

  const open = () => push({ kind: 'funnel', id: funnelLevelId({ funnelId: first.id }), tab: 'steps' });
  const evaluated = evaluation.data?.steps ?? [];
  // Before the evaluation lands, the funnel's own steps hold the row's shape.
  const segments: Segment[] = evaluated.length > 0
    ? evaluated
    : first.steps.map((step) => ({ ord: step.ord, label: step.label, visits: null, conversionFromPrevPct: null }));

  return (
    <section aria-label={t('aria')} style={{ display: 'flex', alignItems: 'stretch', gap: 'var(--space-2)', minWidth: 0 }}>
      <span style={{ alignSelf: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {first.name}
      </span>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 'var(--space-1)', flex: 1, minWidth: 0, overflowX: 'auto' }}>
        {segments.map((step) => (
          <li key={step.ord} style={{ display: 'flex', flex: '1 1 0', minWidth: 96 }}>
            <button
              type="button"
              aria-label={t('openAria', { step: step.label })}
              onClick={open}
              style={segmentStyle}
            >
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {step.label}
              </span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {step.visits == null ? '…' : t('approx', { value: fmt.number(step.visits) })}
              </strong>
              {step.conversionFromPrevPct != null && (
                <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                  {t('conversion', { value: fmt.percent(step.conversionFromPrevPct / 100, 0) })}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
