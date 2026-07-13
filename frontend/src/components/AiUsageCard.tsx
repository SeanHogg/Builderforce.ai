'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { useConsumption } from '@/lib/useConsumption';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { buildInsightDelta } from '@/components/dashboard/metricFormat';
import { colorAt } from '@/components/charts/chartColors';
import { compactTokens } from '@/components/insights/format';

/**
 * Dashboard AI-usage card — month-to-date AI token consumption with a daily
 * sparkline, rendered as an InsightStat so it sits as a peer tile in the
 * dashboard metric row (same size/shape as the other metric cards). Self-gating
 * per the DRY rule: it decides its own visibility (renders null until there's a
 * tenant session and an ai_tokens meter with data) and reads the SAME cached,
 * all-members consumption snapshot as the sidebar <UsageMeter/> via the shared
 * hook — no manager-gated insights fetch, so it never 403s for non-managers.
 */

export function AiUsageCard({ style }: { style?: CSSProperties } = {}) {
  const t = useTranslations('aiUsageCard');
  const snapshot = useConsumption();
  const meter = snapshot?.meters.find((m) => m.key === 'ai_tokens');
  // Show only once there's a real trend to draw (avoids an empty flat card).
  if (!meter || !meter.trend || meter.trend.length < 2 || !meter.trend.some((v) => v > 0)) return null;

  return (
    <InsightStat
      label={t('title')}
      value={compactTokens(meter.used)}
      sub={meter.unlimited ? t('tokensThisMonth') : t('percentOfPlan', { percent: meter.percentUsed })}
      series={meter.trend}
      delta={buildInsightDelta(meter.trend, null)}
      href="/insights/ai-impact"
      color={colorAt(1)}
      style={style}
    />
  );
}
