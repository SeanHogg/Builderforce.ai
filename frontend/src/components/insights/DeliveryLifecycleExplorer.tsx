import { useTranslations } from 'next-intl';
import { insightsApi, type LifecycleInsights, type LifecyclePhase } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError } from '@/components/pm/pmShared';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { PROJECTION_COLOR } from './deliveryLensShared';

/** Compact hours → "Xd Yh" / "Yh" / "Zm" for lifecycle phase durations. */
function fmtDur(hours: number): string {
  if (hours <= 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

const PHASE_ORDER: LifecyclePhase[] = ['refinement', 'work', 'review', 'deploy'];

/** Life cycle explorer — time per SDLC phase (Refinement → Work → Review → Deploy)
 *  and the end-to-end lifecycle trend over recent months. */
export function DeliveryLifecycleExplorer() {
  const t = useTranslations('insights');
  const { currentProjectId } = useProjectScope();
  const { data, error } = usePmData<LifecycleInsights>(() => insightsApi.lifecycle(30, currentProjectId), [currentProjectId]);
  if (error) return <PmError message={error} />;
  if (!data) return null;

  const maxAvg = Math.max(1, ...data.byPhase.map((p) => p.avgHours));
  const phases = [...data.byPhase].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));

  return (
    <PmCard title={t('deliv.lifecycle.title')}>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 0 }}>
        {t('deliv.lifecycle.subtitle', { d: fmtDur(data.totalAvgHours), n: data.sampleSize })}
      </p>
      {data.sampleSize === 0 ? (
        <PmEmpty message={t('deliv.lifecycle.empty')} />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {phases.map((p, i) => (
              <div key={p.phase} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 84px', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t(`deliv.lifecycle.phase.${p.phase}`)}</span>
                <div style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)', height: 18, overflow: 'hidden' }}>
                  <div style={{ width: `${(p.avgHours / maxAvg) * 100}%`, height: '100%', background: colorAt(i), borderRadius: 'var(--radius-sm)', minWidth: p.avgHours > 0 ? 2 : 0 }} />
                </div>
                <span style={{ fontSize: 'var(--font-size-small)', textAlign: 'right', fontWeight: 600 }} title={t('deliv.lifecycle.median', { d: fmtDur(p.medianHours) })}>
                  {fmtDur(p.avgHours)}
                </span>
              </div>
            ))}
          </div>
          {data.trend.length >= 2 && (
            <div>
              <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 6 }}>{t('deliv.lifecycle.trend')}</div>
              <TrendChart
                labels={data.trend.map((p) => p.period)}
                series={[{ key: 'lifecycle', label: t('deliv.lifecycle.trendSeries'), values: data.trend.map((p) => p.avgLifecycleHours / 24), color: PROJECTION_COLOR }]}
                formatValue={(v) => `${v.toFixed(0)}d`}
                area
                ariaLabel={t('deliv.lifecycle.trendAria')}
              />
            </div>
          )}
        </>
      )}
    </PmCard>
  );
}
