'use client';

import { usePathname } from 'next/navigation';
import { isStageRoute } from '@/lib/workbenchPolicy';
import { useConsumption } from '@/lib/useConsumption';
import { ConsumptionMeterCard } from '@/components/UsageMeter';

/**
 * The canvas's own bottom-right corner: usage/consumption meters for the
 * metered features, positioned as a FIXED overlay the way every other piece of
 * floating canvas chrome is (the command bar, the anchored panel, the prompt),
 * never as a row the board has to reserve height for.
 *
 * It does NOT carry the copyright/version/Terms/Privacy row — that lives in
 * the sidebar (`Sidebar`'s own footer row) off the board entirely, and on a
 * stage route as the docked Brain panel's own footer (`BrainDock`) instead;
 * floating it loose over the board here would read as clutter competing with
 * the board's chrome rather than two purposeful pieces.
 */
export default function CanvasUsageCorner() {
  const pathname = usePathname() || '';
  if (!isStageRoute(pathname)) return null;

  return (
    <div className="canvas-usage-corner">
      <CanvasUsageMeters />
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
