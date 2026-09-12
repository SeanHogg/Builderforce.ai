'use client';

import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { computeDeliveryVerdict, type Verdict, type ReasonTone } from '@/lib/deliveryVerdict';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import { statusColor, statusPillStyle, type StatusToneMap } from '@/lib/statusTone';
import { useDora, useLifecycle, useBottlenecks } from './insightsSources';

/**
 * Delivery verdict banner — the narrative headline for /insights/delivery. The
 * dashboard used to open with rows of disconnected KPIs that never answered the
 * one question a leader asks: "is my team actually delivering value?". This card
 * renders the shared {@link computeDeliveryVerdict} fusion (DORA keys + cycle time
 * + live bottleneck signals → one yes / at-risk / no verdict + 0–100 health score
 * + reasons), so the answer is the first thing on the page.
 *
 * It reads the SAME cached collectors the DORA / Delivery / Bottleneck lenses
 * read — literally the same deduped requests, via {@link insightsSources}, so the
 * three reads it needs are free when the summaries beside it already made them —
 * AND the same verdict math the project cards use (so a project's health never
 * differs between the delivery tab and its card). Self-gates on
 * insights.delivery — an un-entitled viewer sees the role hint, never a 403.
 *
 * FRAMELESS by design: it is registered as a widget (`delivery.verdict`), and the
 * WidgetCard chrome supplies the frame/title/pin. The verdict's own colour is
 * carried by the left accent rule, not by a second card border.
 */

const REASON_TONE: StatusToneMap<ReasonTone> = { good: 'success', warn: 'warning', bad: 'danger' };
const VERDICT_TONE: StatusToneMap<Verdict> = { yes: 'success', at_risk: 'warning', no: 'danger', no_data: 'neutral' };

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
  const dora = useDora(days);
  const life = useLifecycle(days);
  const bott = useBottlenecks(days);

  const err = dora.error || life.error || bott.error;
  if (err) return <PmError message={err} />;
  if (!dora.data || !life.data || !bott.data) return <PmEmpty message={t('loading')} />;

  const result = computeDeliveryVerdict(dora.data, life.data, bott.data);
  // The rule and the gauge are marks (`solid`); the headline is ink (`text`, AA on paper).
  const color = statusColor(VERDICT_TONE, result.verdict, 'solid');
  const ink = statusColor(VERDICT_TONE, result.verdict);

  return (
    <div style={{ borderLeft: `5px solid ${color}`, paddingLeft: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
            {t('eyebrow')}
          </div>
          <div style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 800, lineHeight: 1.1, color: ink, margin: '2px 0 6px' }}>
            {t(`headline.${result.verdict}`)}
          </div>
          <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)' }}>
            {t(`explain.${result.verdict}`, { days })}
          </div>

          {result.reasons.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {result.reasons.map((r) => (
                <span
                  key={r.key}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', fontWeight: 600,
                    borderWidth: 1, borderStyle: 'solid', ...statusPillStyle(REASON_TONE, r.tone),
                    padding: '4px 10px', borderRadius: 'var(--radius-full)',
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
