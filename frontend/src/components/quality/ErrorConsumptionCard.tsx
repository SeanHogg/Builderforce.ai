'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConsumptionMeterCard } from '@/components/UsageMeter';
import { useConsumption } from '@/lib/useConsumption';
import { qualityApi, type QualityCollectorConsumption, type MeterSnapshot } from '@/lib/builderforceApi';

/**
 * Reuses the canonical Errors allowance meter. With no collector it displays the
 * tenant aggregate from /api/consumption; with a collector it keeps that shared
 * allowance but replaces usage/trend with the collector's month-to-date share.
 */
export function ErrorConsumptionCard({
  collectorId, collectorName, refreshKey,
}: {
  collectorId?: string;
  collectorName?: string;
  refreshKey?: string | null;
}) {
  const t = useTranslations('quality');
  const snapshot = useConsumption();
  const [scoped, setScoped] = useState<QualityCollectorConsumption | null>(null);

  useEffect(() => {
    if (!collectorId) { setScoped(null); return; }
    let active = true;
    qualityApi.collectors.consumption(collectorId)
      .then((value) => { if (active) setScoped(value); })
      .catch(() => { if (active) setScoped(null); });
    return () => { active = false; };
  }, [collectorId, refreshKey]);

  const aggregate = snapshot?.meters.find((meter) => meter.key === 'error_events');
  const meter = useMemo<MeterSnapshot | null>(() => {
    if (!aggregate) return null;
    if (!collectorId) return aggregate;
    if (!scoped) return null;
    const used = scoped.used;
    const unlimited = aggregate.unlimited;
    const remaining = unlimited ? -1 : Math.max(0, aggregate.limit - used);
    const percentUsed = unlimited || aggregate.limit <= 0
      ? 0
      : Math.min(100, Math.round((used / aggregate.limit) * 100));
    return { ...aggregate, used, remaining, percentUsed, trend: scoped.trend };
  }, [aggregate, collectorId, scoped]);

  if (!snapshot || !meter) return null;

  const title = collectorName
    ? t('setup.collectorConsumption', { name: collectorName })
    : t('aggregateConsumption');
  return <ConsumptionMeterCard meter={meter} isFree={snapshot.plan.effective === 'free'} title={title} />;
}
