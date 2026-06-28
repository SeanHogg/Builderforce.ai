'use client';

import { useState } from 'react';
import { DaysWindowSelect } from './LensShell';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { AI_IMPACT_WIDGETS } from './widgets/aiImpactWidgets';

/**
 * LENS — "AI Impact": adoption & usage trends, a multi-tool evaluation matrix,
 * and a composite AI productivity score.
 *
 * The report is now a grid of individually-PINNABLE widgets (see
 * aiImpactWidgets.tsx) rather than one hand-laid-out block: each card carries a
 * pin in its corner so the user can lift the exact tile they care about onto their
 * home dashboard. Drill is suppressed here (we're already inside the AI-Impact
 * slide-out). One shared window drives every card via the deduped collector read.
 */

const AI_IMPACT_IDS = AI_IMPACT_WIDGETS.map((w) => w.id);

export function AiImpactLens() {
  const [days, setDays] = useState(30);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>
      <WidgetGrid ids={AI_IMPACT_IDS} days={days} showDrill={false} />
    </div>
  );
}
