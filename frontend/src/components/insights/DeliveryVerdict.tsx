'use client';

import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { GaugeChart } from '@/components/charts/GaugeChart';
import {
  insightsApi,
  type DoraInsights, type BottleneckInsights, type LifecycleInsights,
} from '@/lib/builderforceApi';
import { computeDeliveryVerdict, type Verdict, type ReasonTone } from '@/lib/deliveryVerdict';
import { usePmData } from '@/lib/pm/usePmData';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { PmEmpty, PmError } from '@/components/pm/pmShared';

/**
 * Delivery verdict banner — the narrative headline for /insights/delivery. The
 * dashboard used to open with rows of disconnected KPIs that never answered the
 * one question a leader asks: "is my team actually delivering value?". This card
 * renders the shared {@link computeDeliveryVerdict} fusion (DORA keys + cycle time
 * + live bottleneck signals → one yes / at-risk / no verdict + 0–100 health score
 * + reasons), so the answer is the first thing on the page.
 *
 * It reads the SAME cached collectors the DORA / Delivery / Bottleneck lenses
 * read (so the headline always agrees with the drill-downs) AND the same verdict
 * math the project cards use (so a project's health never differs between the
 * delivery tab and its card). Self-gates on insights.delivery — an un-entitled
 * viewer sees the role hint, never a 403.
 */

const TONE_COLOR: Record<ReasonTone, string> = { good: '#16a34a', warn: '#d97706', bad: '#dc2626' };
const VERDICT_COLOR: Record<Verdict, string> = { yes: '#16a34a', at_risk: '#d97706', no: '#dc2626', no_data: '#6b7280' };

export function DeliveryVerdict({ days }: { days: number }) {
  const { currentProjectId } = useProjectScope();
  const t = useTranslations('insights.delivhub.verdict');
  const { allowed } = usePermission('insights.delivery');

  if (!allowed) {
    return (
      <RoleGate capability="insights.delivery" variant="block">
        <div style={{ minHeight: 96 }} aria-hidden />
      </RoleGate>
    );
  }
  return <VerdictInner t={t} days={days} projectId={currentProjectId} />;
}

function VerdictInner({ t, days, projectId }: { t: ReturnType<typeof useTranslations>; days: number; projectId: number | null }) {
  const dora = usePmData<DoraInsights>(() => insightsApi.dora(days, projectId), [days, projectId]);
  const life = usePmData<LifecycleInsights>(() => insightsApi.lifecycle(days, projectId), [days, projectId]);
  const bott = usePmData<BottleneckInsights>(() => insightsApi.bottlenecks(days, projectId), [days, projectId]);

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
