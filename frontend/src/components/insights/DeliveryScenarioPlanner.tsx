import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type DeliverableScope, type DeliveryInsights, type ScenarioResponse } from '@/lib/builderforceApi';
import { PmCard, StatCard } from '@/components/pm/pmShared';
import { statusColor } from '@/lib/statusTone';
import { KpiGrid } from './LensShell';
import { STATUS_TONE } from './deliveryLensShared';

const sliderRow: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const sliderLabel: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' };

/**
 * Scenario planner — model the deliverable's completion under different team size,
 * focus, and scope, graded against its target. Server-computed off the live
 * delivery baseline (single source of truth); debounced as the levers move.
 * Keyed by deliverable in the parent so the levers reset on a deliverable switch.
 */
export function DeliveryScenarioPlanner({ scope, id, baseline }: { scope: DeliverableScope; id: string; baseline: DeliveryInsights }) {
  const t = useTranslations('insights');
  const [developers, setDevelopers] = useState(Math.max(1, baseline.activeContributors));
  const [attentionPct, setAttentionPct] = useState(100);
  const [scopeDelta, setScopeDelta] = useState(0);
  const [res, setRes] = useState<ScenarioResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const h = setTimeout(() => {
      insightsApi.deliveryScenario(scope, id, { developers, attentionPct, scopeDelta })
        .then((r) => { if (alive) setRes(r); })
        .catch(() => { if (alive) setRes(null); });
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [scope, id, developers, attentionPct, scopeDelta]);

  const s = res?.scenario;
  const deltaLabel = s?.deltaDaysVsTarget == null ? null
    : s.deltaDaysVsTarget > 0 ? t('deliv.scenario.daysLate', { n: s.deltaDaysVsTarget })
    : s.deltaDaysVsTarget < 0 ? t('deliv.scenario.daysEarly', { n: -s.deltaDaysVsTarget })
    : t('deliv.scenario.onTheDay');

  return (
    <PmCard title={t('deliv.scenario.title')}>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 0 }}>{t('deliv.scenario.subtitle')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div style={sliderRow}>
          <span style={sliderLabel}><span>{t('deliv.scenario.developers')}</span><strong>{developers}</strong></span>
          <input type="range" min={0} max={Math.max(12, baseline.activeContributors * 3)} step={1} value={developers}
            onChange={(e) => setDevelopers(Number(e.target.value))} aria-label={t('deliv.scenario.developers')} />
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('deliv.scenario.developersHint', { n: Math.max(1, baseline.activeContributors) })}</span>
        </div>
        <div style={sliderRow}>
          <span style={sliderLabel}><span>{t('deliv.scenario.attention')}</span><strong>{attentionPct}%</strong></span>
          <input type="range" min={0} max={100} step={5} value={attentionPct}
            onChange={(e) => setAttentionPct(Number(e.target.value))} aria-label={t('deliv.scenario.attention')} />
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('deliv.scenario.attentionHint')}</span>
        </div>
        <div style={sliderRow}>
          <span style={sliderLabel}><span>{t('deliv.scenario.scope')}</span><strong>{scopeDelta > 0 ? `+${scopeDelta}` : scopeDelta}</strong></span>
          <input type="range" min={-baseline.openTasks} max={Math.max(20, baseline.openTasks)} step={1} value={scopeDelta}
            onChange={(e) => setScopeDelta(Number(e.target.value))} aria-label={t('deliv.scenario.scope')} />
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('deliv.scenario.scopeHint', { n: s?.adjustedOpenTasks ?? baseline.openTasks })}</span>
        </div>
      </div>

      <KpiGrid>
        <StatCard label={t('deliv.scenario.projectedDate')} value={s?.projectedDate ?? '—'}
          sub={deltaLabel ?? (baseline.targetDate ? t('deliv.target', { d: baseline.targetDate }) : t('deliv.noTarget'))} />
        <StatCard label={t('deliv.status')} value={s ? t(`deliv.statusLabel.${s.status}`) : '—'}
          sub={baseline.forecastDate ? t('deliv.scenario.baselineForecast', { d: baseline.forecastDate }) : t('deliv.forecastNone')} />
        <StatCard label={t('deliv.scenario.projectedPace')} value={s ? `${s.projectedThroughputPerWeek.toFixed(1)}/${t('deliv.week')}` : '—'}
          sub={t('deliv.scenario.baselinePace', { n: baseline.throughputPerWeek.toFixed(1) })} />
        <StatCard label={t('deliv.scenario.effort')} value={s?.effortPersonWeeks != null ? t('deliv.scenario.personWeeks', { n: s.effortPersonWeeks.toFixed(1) }) : '—'}
          sub={s?.projectedWeeks != null ? t('deliv.scenario.weeksRemaining', { n: s.projectedWeeks.toFixed(1) }) : '—'} />
      </KpiGrid>
      {s && (
        <div style={{ marginTop: 10, fontSize: 'var(--font-size-small)', color: statusColor(STATUS_TONE, s.status), fontWeight: 600 }}>
          {t(`deliv.scenario.verdict.${s.status}`)}
        </div>
      )}
    </PmCard>
  );
}
