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
 * It does NOT carry the copyright/version/Terms/Privacy row `LegalCorner`
 * renders elsewhere — that row floating loose over the board, spanning from
 * this corner toward the canvas's own toolbar, read as one strip of clutter
 * competing with the board's chrome rather than two purposeful pieces. On a
 * stage route it now lives instead as the docked Brain panel's own footer
 * (`BrainDock`), in normal flow the way `LegalCorner` sits in the shell —
 * chrome belonging to a real panel, never floating over the board itself.
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
