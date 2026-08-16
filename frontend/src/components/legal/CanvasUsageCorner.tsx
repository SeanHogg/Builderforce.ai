'use client';

import { usePathname } from 'next/navigation';
import { isStageRoute } from '@/lib/workbenchPolicy';
import { useConsumption } from '@/lib/useConsumption';
import { ConsumptionMeterCard } from '@/components/UsageMeter';
import { LegalStrip } from './LegalStrip';

/**
 * The canvas's own bottom-right corner: usage/consumption meters for the
 * metered features, plus the SAME copyright/version/legal row `LegalCorner`
 * renders everywhere else.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────
 * `LegalCorner` stands itself down on a stage route — the canvas floats its own
 * chrome and has no flow-based footer row to sit in — which is correct for the
 * shell but left the corner of a signed-in tenant's board with nothing at all.
 * This is that corner's own content, positioned as a FIXED overlay the way
 * every other piece of floating canvas chrome is (the command bar, the anchored
 * panel, the prompt), never as a row the board has to reserve height for.
 *
 * ── WHY IT SELF-GATES ON THE METERS AND NOT ON THE ROUTE ALONE ───────────────
 * A signed-out guest's board has no tenant and therefore no `useConsumption`
 * snapshot — `ConsumptionMeterCard` needs one, so the meter row is simply absent
 * for them rather than showing empty tiles. The legal row still renders: the
 * version and the two documents are true for every visitor, tenant or not.
 */
export default function CanvasUsageCorner() {
  const pathname = usePathname() || '';
  if (!isStageRoute(pathname)) return null;

  return (
    <div className="canvas-usage-corner">
      <CanvasUsageMeters />
      <LegalStrip className="canvas-usage-corner-legal" />
    </div>
  );
}

/** Only the meters actually in use — a fresh tenant's empty allowances would
 *  otherwise fill the corner with zeroes nobody asked to see. */
function CanvasUsageMeters() {
  const snapshot = useConsumption();
  if (!snapshot) return null;
  const used = snapshot.meters.filter((meter) => meter.used > 0);
  if (!used.length) return null;
  const isFree = snapshot.plan.effective === 'free';

  return (
    <div className="canvas-usage-corner-meters" role="group">
      {used.map((meter) => (
        <ConsumptionMeterCard key={meter.key} meter={meter} isFree={isFree} usageOnly />
      ))}
    </div>
  );
}
