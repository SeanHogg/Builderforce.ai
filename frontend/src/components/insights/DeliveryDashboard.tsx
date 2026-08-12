'use client';

/**
 * Consolidated Delivery hub — the single entry point at /insights/delivery that
 * replaces the six separate routes (Delivery, Bottlenecks, DORA, SPACE,
 * Benchmarking and the Innovation Funnel). The verdict banner answers "are we
 * delivering?" first, then one card per report drills into the full lens in the
 * shared slide-out side panel (see DeliveryPanelProvider).
 *
 * ── It is a standard page, and its cards are REGISTRY WIDGETS ────────────────
 * This used to be a `WorkspaceCanvas` of absolutely-positioned floating panels,
 * so the verdict and every summary existed only on this page — un-pinnable, and
 * laid out by a coordinate table that broke below the canvas's assumed width.
 * The hub is now a responsive {@link WidgetGrid} over ids from the app-wide
 * widget registry (see hubWidgets.tsx), so each tile carries its own pin and can
 * be lifted onto a dashboard or a custom canvas, and the grid reflows instead of
 * overflowing.
 *
 * Each card gates ITSELF on its panel's capability (WidgetCard wraps the body in
 * RoleGate), so an un-entitled viewer gets the role hint rather than a read that
 * would 403 — the same rule the old bespoke `SummarySlot` implemented by hand.
 * And every summary now reads through the deduped source layer, so the verdict's
 * three collectors are shared with the tiles beside it instead of re-fetched.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { DaysWindowSelect } from './LensShell';
import { ExportMenu } from './ExportMenu';
import { useDeliveryPanel } from './DeliveryPanelProvider';
import { isDeliveryPanelId, type DeliveryPanelId } from './deliveryPanels';
import { DELIVERY_HUB_WIDGET_IDS } from './widgets/hubWidgets';

export function DeliveryDashboard() {
  const [days, setDays] = useState(30);
  const { open } = useDeliveryPanel();
  const searchParams = useSearchParams();

  // Deep-link: /insights/delivery?panel=dora (and the redirects from the retired
  // /insights/bottlenecks, /dora, /space, /benchmarking, /funnel routes)
  // auto-open the drill-down.
  const panelParam = searchParams?.get('panel');
  useEffect(() => {
    if (isDeliveryPanelId(panelParam)) open(panelParam as DeliveryPanelId);
  }, [panelParam, open]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <ExportMenu days={days} />
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>
      <WidgetGrid ids={DELIVERY_HUB_WIDGET_IDS} days={days} />
    </div>
  );
}
