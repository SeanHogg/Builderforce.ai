/**
 * Single source of truth for the consolidated Finance hub's drill-down panels.
 *
 * Every financial capability that used to be its own route (FinOps spend,
 * Investment Allocation, DevFinOps R&D / SOC / Audit) is declared here once as a
 * reusable {@link FinancePanelDef} — a lens component plus its i18n title + RBAC
 * capability. The Finance hub renders these as drill-downs in a slide-out side
 * panel, and the Brain opens the SAME definitions on demand (see
 * FinancePanelProvider + FinancePanelBrainBridge), so there is exactly one place
 * that knows how to show a finance insight.
 *
 * Self-contained on purpose: it depends only on the lens components (loaded on
 * demand, below) and the shared SlideOutPanel primitive, NOT on the wider
 * insights-registry — so the finance hub stays correct regardless of that churn.
 */

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import type { Capability } from '@/lib/rbac';

/**
 * The lenses load ON DEMAND — the same reason, and the same cycle, as the AI and
 * Delivery hubs' registries. `FinanceLens` embeds `FinanceDashboardView`, whose
 * `WidgetCard` drills through `useComponentDrill` → `FinancePanelProvider` → THIS
 * registry. Held statically that is an initialization loop ("Cannot read
 * properties of undefined (reading 'map')" on `FINANCE_PANELS`), and the root
 * layout mounts `FinancePanelProvider` on every page, so the widget registry
 * behind the dashboard rode into every first paint. An async `dynamic()` edge
 * takes no part in module-evaluation order, and a drawer-only lens has no
 * business in the shared chunk of a page that never opens one.
 */
const FinanceLens = dynamic(() => import('@/components/insights/FinanceLens').then((module) => module.FinanceLens), { ssr: false });
const AllocationLens = dynamic(() => import('@/components/insights/AllocationLens').then((module) => module.AllocationLens), { ssr: false });
const ForecastPanel = dynamic(() => import('@/components/insights/ForecastPanel').then((module) => module.ForecastPanel), { ssr: false });
const RdReconciliationLens = dynamic(() => import('@/components/insights/RdReconciliationLens').then((module) => module.RdReconciliationLens), { ssr: false });
const FinopsLens = dynamic(() => import('./FinopsLens').then((module) => module.FinopsLens), { ssr: false });

/** Stable, gateway-safe ids (also the `?drill=` deep-link + Brain enum values). */
export type FinancePanelId = 'finance' | 'allocation' | 'devfinops' | 'forecast' | 'rdReconciliation';

export interface FinancePanelDef {
  id: FinancePanelId;
  icon: string;
  /** i18n key (under the `insights` namespace) for the panel/section title. */
  titleKey: string;
  /** i18n key for the one-line subtitle shown on the tile + slide-out. */
  subtitleKey: string;
  /** Capability that gates this panel's content (and the Brain action). */
  capability: Capability;
  render: () => ReactNode;
}

export const FINANCE_PANELS: FinancePanelDef[] = [
  { id: 'finance', icon: '💰', titleKey: 'fin.title', subtitleKey: 'fin.subtitle', capability: 'insights.finance', render: () => <FinanceLens /> },
  { id: 'allocation', icon: '🧭', titleKey: 'alloc.title', subtitleKey: 'alloc.subtitle', capability: 'insights.allocation', render: () => <AllocationLens /> },
  { id: 'devfinops', icon: '🧾', titleKey: 'finhub.devfinops.title', subtitleKey: 'finhub.devfinops.subtitle', capability: 'finops.manage', render: () => <FinopsLens /> },
  { id: 'forecast', icon: '📈', titleKey: 'forecast.title', subtitleKey: 'forecast.subtitle', capability: 'insights.finance', render: () => <ForecastPanel /> },
  { id: 'rdReconciliation', icon: '⚖️', titleKey: 'emp.recon.title', subtitleKey: 'emp.recon.subtitle', capability: 'finops.rdReconciliation', render: () => <RdReconciliationLens /> },
];

export const FINANCE_PANEL_IDS = FINANCE_PANELS.map((p) => p.id);

export function isFinancePanelId(v: unknown): v is FinancePanelId {
  return typeof v === 'string' && FINANCE_PANELS.some((p) => p.id === v);
}
