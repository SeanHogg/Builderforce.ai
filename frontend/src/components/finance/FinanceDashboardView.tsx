'use client';

/**
 * /finance?tab=dashboard (PRD 25 A6) — render the tenant's saved vertical
 * dashboard, or prompt to install one from the Marketplace.
 *
 * Default pick: a saved dashboard whose name matches a known preset. Otherwise
 * the install prompt, keyed off the company's sector (or founder).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { verticalForSector } from '@builderforce/creation-canvas-contract';
import { WidgetCard } from '@/components/widgets/WidgetCard';
import { getComponent } from '@/components/widgets/registry';
import { DashboardWidget } from '@/components/dashboard/DashboardWidget';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import type { ComponentSize } from '@/lib/components/types';
import {
  dashboardsApi,
  type DashboardData,
  type SavedDashboard,
} from '@/lib/dashboardsApi';
import { benchmarkingApi } from '@/lib/benchmarkingApi';
import { DashboardInstallPrompt } from './DashboardInstallPrompt';

const SPAN: Record<ComponentSize, React.CSSProperties> = {
  sm: {},
  md: { gridColumn: 'span 2' },
  lg: { gridColumn: '1 / -1' },
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 16,
  alignItems: 'stretch',
};

/**
 * The marketplace key for a vertical's dashboard template.
 *
 * A template key may only carry `[a-z0-9-]` while a sector id is snake_case, so
 * `climate_energy` installs from `vertical-dashboard-climate-energy`. Getting
 * this wrong renders an install button that 404s — the exact failure the
 * catalogue's own key-grammar guard rejects on the API side.
 */
export function dashboardTemplateKey(vertical: string | null): string {
  return vertical ? `vertical-dashboard-${vertical.replace(/_/g, '-')}` : 'vertical-dashboard-founder';
}

const PRESET_NAMES = new Set([
  'Executive',
  'Founder',
  'SaaS',
  'AI-native',
  'FinTech',
  'Digital health',
  'MedTech',
  'BioTech',
  'Climate & energy',
  'Hardware & robotics',
  'Cybersecurity',
  'Marketplace',
]);

function pickDashboard(list: SavedDashboard[]): SavedDashboard | null {
  return list.find((d) => PRESET_NAMES.has(d.name)) ?? list[0] ?? null;
}

export function FinanceDashboardView() {
  const t = useTranslations('financeHub');
  const [list, setList] = useState<SavedDashboard[] | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [templateKey, setTemplateKey] = useState('vertical-dashboard-founder');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [listed, profile] = await Promise.all([
          dashboardsApi.list(),
          benchmarkingApi.getProfile().catch(() => null),
        ]);
        if (cancelled) return;
        const dashboards = listed.dashboards;
        setList(dashboards);
        const sector = profile?.industry ?? null;
        setTemplateKey(dashboardTemplateKey(sector ? verticalForSector(sector) : null));
        const chosen = pickDashboard(dashboards);
        if (!chosen) return;
        const payload = await dashboardsApi.data(chosen.id);
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const empty = useMemo(() => list !== null && list.length === 0, [list]);

  if (error) return <PmError message={error} />;
  if (list === null) return <PmEmpty message={t('dashboard.loading')} />;
  if (empty || !data) return <DashboardInstallPrompt templateKey={templateKey} />;
  if (data.widgets.length === 0) return <DashboardInstallPrompt templateKey={templateKey} />;

  return (
    <div style={gridStyle}>
      {data.widgets.map((w) => {
        const def = w.widgetKey ? getComponent(w.widgetKey) : undefined;
        return (
          <div key={w.widgetId} style={{ ...SPAN[def?.size ?? 'sm'], position: 'relative' }}>
            {def ? <WidgetCard def={def} days={w.days} /> : <DashboardWidget v={w} />}
          </div>
        );
      })}
    </div>
  );
}
