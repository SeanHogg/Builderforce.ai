'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DaysWindowSelect } from './LensShell';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { AUTONOMY_WIDGET_IDS, AutonomyCoverage, useAutonomy } from './widgets/autonomyWidgets';

/** The coverage tile is a pinnable widget for other dashboards; inside the lens
 *  the same notice already rides the header, so it is not repeated in the grid. */
const LENS_WIDGET_IDS = AUTONOMY_WIDGET_IDS.filter((id) => id !== 'autonomy.coverage');

/**
 * LENS — "Autonomy Health": are the tickets the AI manager (or a human) opens
 * ACTUALLY going through their full lifecycle autonomously?
 *
 * The report is a grid of individually-PINNABLE widgets (see autonomyWidgets.tsx)
 * rather than one hand-laid-out block, so a manager can lift the exact tile they
 * watch — usually the per-origin funnel or the hop split — onto their dashboard.
 * One shared window drives every card through the deduped collector read, and the
 * cards additionally follow the GLOBAL project scope (the TopBar switcher), so
 * "all projects" and "this project" are the same lens with a narrower `projectId`.
 *
 * The coverage line above the grid is deliberate: the server audits at most N
 * tickets per window, and when it truncates, these figures are a sample. Saying
 * so is part of the report, not a footnote.
 */
export function AutonomyLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const { currentProject } = useProjectScope();
  // Same deduped read the cards use — no extra request for the header line.
  const { data } = useAutonomy(days);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, flex: '1 1 220px', minWidth: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          {currentProject
            ? t('autonomy.scopeProject', { project: currentProject.name })
            : t('autonomy.scopeAll')}
        </p>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      {data && <AutonomyCoverage data={data} />}

      <WidgetGrid ids={LENS_WIDGET_IDS} days={days} showDrill={false} />
    </div>
  );
}
