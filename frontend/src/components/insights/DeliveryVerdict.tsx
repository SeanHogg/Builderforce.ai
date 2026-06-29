'use client';

import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { GaugeChart } from '@/components/charts/GaugeChart';
import {
  insightsApi,
  type DoraInsights, type BottleneckInsights, type LifecycleInsights,
} from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError } from '@/components/pm/pmShared';

/**
 * Delivery verdict banner — the narrative headline for /insights/delivery. The
 * dashboard used to open with rows of disconnected KPIs that never answered the
 * one question a leader asks: "is my team actually delivering value?". This card
 * fuses the DORA keys, end-to-end cycle time and the live bottleneck signals into
 * a single yes / at-risk / no verdict with a 0–100 health score and the reasons
 * behind it, so the answer is the first thing on the page.
 *
 * It reads the SAME cached collectors the DORA / Delivery / Bottleneck lenses
 * read (so the headline always agrees with the drill-downs) and self-gates on
 * insights.delivery — an un-entitled viewer sees the role hint, never a 403.
 */

export type Verdict = 'yes' | 'at_risk' | 'no' | 'no_data';
export type ReasonTone = 'good' | 'warn' | 'bad';

export interface VerdictReason {
  /** i18n key under insights.delivhub.verdict.reason. */
  key: string;
  tone: ReasonTone;
  /** Interpolation values for the localized reason string. */
  values: Record<string, string | number>;
}

export interface VerdictResult {
  verdict: Verdict;
  /** Composite delivery-health score, 0–100 (null when there's no data). */
  score: number | null;
  reasons: VerdictReason[];
}

const TONE_COLOR: Record<ReasonTone, string> = { good: '#16a34a', warn: '#d97706', bad: '#dc2626' };
const VERDICT_COLOR: Record<Verdict, string> = { yes: '#16a34a', at_risk: '#d97706', no: '#dc2626', no_data: '#6b7280' };

/** Band a 0..1-ish component into a 0..100 sub-score against four thresholds. */
function band(value: number, t: [number, number, number], higherIsBetter: boolean): number {
  const [a, b, c] = t;
  if (higherIsBetter) {
    if (value >= a) return 100;
    if (value >= b) return 78;
    if (value >= c) return 52;
    return value > 0 ? 30 : 0;
  }
  if (value <= a) return 100;
  if (value <= b) return 78;
  if (value <= c) return 52;
  return 30;
}

/**
 * Pure verdict computation — fuses DORA, lifecycle and bottleneck signals into a
 * single health score + reasons. Exported and hook-free so it is unit-testable
 * and the Brain can reuse the same logic. Thresholds follow the DORA performance
 * tiers (elite/high/medium) and the flow penalties mirror the bottleneck lens.
 */
export function computeDeliveryVerdict(
  dora: DoraInsights,
  lifecycle: LifecycleInsights,
  bottlenecks: BottleneckInsights,
): VerdictResult {
  const hasData = lifecycle.sampleSize > 0 || dora.totalDeployments > 0;
  if (!hasData) return { verdict: 'no_data', score: null, reasons: [] };

  // DORA sub-scores (deploys/day↑, lead-time h↓, change-failure %↓, MTTR h↓).
  // Lead time / change-failure / MTTR can be null (no signal yet) — drop those
  // from the average rather than scoring them as zero.
  const deployScore = band(dora.deploymentFrequencyPerDay, [1, 1 / 7, 1 / 30], true);
  const leadScore = dora.leadTimeHours != null ? band(dora.leadTimeHours, [24, 168, 720], false) : null;
  const cfrScore = dora.changeFailureRatePct != null ? band(dora.changeFailureRatePct, [5, 15, 30], false) : null;
  const mttrScore = dora.mttrHours != null ? band(dora.mttrHours, [1, 24, 168], false) : null;
  const doraParts = [deployScore, leadScore, cfrScore, mttrScore].filter((x): x is number => x != null);
  const doraScore = doraParts.reduce((s, x) => s + x, 0) / doraParts.length;

  // Flow health — penalise rework loops and currently-stuck WIP.
  const reworkPenalty = bottlenecks.rework.reworkRate > 0.2 ? 30 : bottlenecks.rework.reworkRate > 0.1 ? 15 : 0;
  const stuckPenalty = Math.min(40, bottlenecks.agingWip.stuckCount * 6);
  const flowScore = Math.max(0, 100 - reworkPenalty - stuckPenalty);

  const score = Math.round(doraScore * 0.7 + flowScore * 0.3);
  const verdict: Verdict = score >= 70 ? 'yes' : score >= 45 ? 'at_risk' : 'no';

  // The salient reasons behind the verdict (max four, most decision-relevant).
  const reasons: VerdictReason[] = [];
  reasons.push({
    key: 'deploy',
    tone: deployScore >= 78 ? 'good' : deployScore >= 52 ? 'warn' : 'bad',
    values: { value: dora.deploymentFrequencyPerDay.toFixed(2) },
  });
  if (lifecycle.sampleSize > 0) {
    const cycleDays = lifecycle.totalAvgHours / 24;
    reasons.push({
      key: 'cycle',
      tone: cycleDays <= 5 ? 'good' : cycleDays <= 14 ? 'warn' : 'bad',
      values: { value: cycleDays.toFixed(1) },
    });
  }
  if (dora.changeFailureRatePct != null && cfrScore != null) {
    reasons.push({
      key: 'cfr',
      tone: cfrScore >= 78 ? 'good' : cfrScore >= 52 ? 'warn' : 'bad',
      values: { value: Math.round(dora.changeFailureRatePct) },
    });
  }
  if (bottlenecks.agingWip.stuckCount > 0) {
    reasons.push({ key: 'stuck', tone: 'bad', values: { n: bottlenecks.agingWip.stuckCount } });
  } else if (bottlenecks.rework.reworkRate > 0.1) {
    reasons.push({ key: 'rework', tone: 'warn', values: { value: Math.round(bottlenecks.rework.reworkRate * 100) } });
  }
  return { verdict, score, reasons };
}

export function DeliveryVerdict({ days }: { days: number }) {
  const t = useTranslations('insights.delivhub.verdict');
  const { allowed } = usePermission('insights.delivery');

  if (!allowed) {
    return (
      <RoleGate capability="insights.delivery" variant="block">
        <div style={{ minHeight: 96 }} aria-hidden />
      </RoleGate>
    );
  }
  return <VerdictInner t={t} days={days} />;
}

function VerdictInner({ t, days }: { t: ReturnType<typeof useTranslations>; days: number }) {
  const dora = usePmData<DoraInsights>(() => insightsApi.dora(days), [days]);
  const life = usePmData<LifecycleInsights>(() => insightsApi.lifecycle(days), [days]);
  const bott = usePmData<BottleneckInsights>(() => insightsApi.bottlenecks(days), [days]);

  const err = dora.error || life.error || bott.error;
  if (err) return <PmError message={err} />;
  if (!dora.data || !life.data || !bott.data) return <PmEmpty message={t('loading')} />;

  const result = computeDeliveryVerdict(dora.data, life.data, bott.data);
  const color = VERDICT_COLOR[result.verdict];

  return (
    <div
      style={{
        background: 'var(--bg-elevated)', borderRadius: 12, padding: 20,
        border: '1px solid var(--border-subtle)', borderLeft: `5px solid ${color}`,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
            {t('eyebrow')}
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1.1, color, margin: '2px 0 6px' }}>
            {t(`headline.${result.verdict}`)}
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {t(`explain.${result.verdict}`, { days })}
          </div>

          {result.reasons.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {result.reasons.map((r) => (
                <span
                  key={r.key}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600,
                    color: TONE_COLOR[r.tone], background: 'var(--bg-base)', border: `1px solid ${TONE_COLOR[r.tone]}`,
                    padding: '4px 10px', borderRadius: 999,
                  }}
                >
                  <span aria-hidden>{r.tone === 'good' ? '✓' : r.tone === 'warn' ? '!' : '✕'}</span>
                  {t(`reason.${r.key}`, r.values)}
                </span>
              ))}
            </div>
          )}
        </div>

        {result.score != null && (
          <GaugeChart
            value={result.score}
            min={0}
            max={100}
            color={color}
            size={148}
            centerValue={String(result.score)}
            centerLabel={t('scoreLabel')}
            ariaLabel={t('scoreAria', { score: result.score })}
          />
        )}
      </div>
    </div>
  );
}
