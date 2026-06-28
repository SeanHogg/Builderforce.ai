'use client';

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
 * Self-contained on purpose: it depends only on the stable lens components and
 * the shared SlideOutPanel primitive, NOT on the wider insights-registry that is
 * mid-consolidation — so the finance hub stays correct regardless of that churn.
 */

import type { ReactNode } from 'react';
import type { Capability } from '@/lib/rbac';
import { FinanceLens } from '@/components/insights/FinanceLens';
import { AllocationLens } from '@/components/insights/AllocationLens';
import { FinopsLens } from './FinopsLens';

/** Stable, gateway-safe ids (also the `?drill=` deep-link + Brain enum values). */
export type FinancePanelId = 'finance' | 'allocation' | 'devfinops';

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
];

export const FINANCE_PANEL_IDS = FINANCE_PANELS.map((p) => p.id);

export function getFinancePanel(id: string | null | undefined): FinancePanelDef | undefined {
  return id == null ? undefined : FINANCE_PANELS.find((p) => p.id === id);
}

export function isFinancePanelId(v: unknown): v is FinancePanelId {
  return typeof v === 'string' && FINANCE_PANELS.some((p) => p.id === v);
}
