'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ViewToggle } from '@/components/ViewToggle';
import { EpicTreeView } from './EpicTreeView';
import { DependencyGraph } from './DependencyGraph';
import { RoadmapTimeline } from './RoadmapTimeline';
import { RoadmapGantt } from './RoadmapGantt';
import { RiceMatrix } from './RiceMatrix';
import { RoiDashboard } from './RoiDashboard';
import { PlanningSpineGantt } from './PlanningSpineGantt';
import { PmCard } from './pmShared';

/**
 * Product Management visualizers container — the single switchboard behind the
 * `pm` tab. Owns the section selector (Epics / Roadmap / ROI) and each section's
 * sub-view toggle. Scope (project vs portfolio) comes from {@link usePmScope}, so
 * nothing here prop-drills a project id. Must be rendered inside a PmScopeProvider.
 */
type Section = 'spine' | 'epics' | 'roadmap' | 'roi';
type EpicView = 'tree' | 'flow';
type RoadmapView = 'timeline' | 'gantt' | 'map';

export function PmVisualizersContent() {
  const t = useTranslations('pm');
  const [section, setSection] = useState<Section>('spine');
  const [epicView, setEpicView] = useState<EpicView>('tree');
  const [roadmapView, setRoadmapView] = useState<RoadmapView>('timeline');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <ViewToggle<Section>
          value={section}
          onChange={setSection}
          options={[
            { value: 'spine', label: t('spine') },
            { value: 'epics', label: t('epics') },
            { value: 'roadmap', label: t('roadmap') },
            { value: 'roi', label: t('roi') },
          ]}
        />
        {section === 'epics' && (
          <ViewToggle<EpicView>
            value={epicView}
            onChange={setEpicView}
            options={[
              { value: 'tree', label: t('tree') },
              { value: 'flow', label: t('flow') },
            ]}
          />
        )}
        {section === 'roadmap' && (
          <ViewToggle<RoadmapView>
            value={roadmapView}
            onChange={setRoadmapView}
            options={[
              { value: 'timeline', label: t('timeline') },
              { value: 'gantt', label: t('gantt') },
              { value: 'map', label: t('map') },
            ]}
          />
        )}
      </div>

      {section === 'spine' && <PlanningSpineGantt />}

      {section === 'epics' && (epicView === 'tree' ? <EpicTreeView /> : <DependencyGraph />)}

      {section === 'roadmap' && (
        <>
          {roadmapView === 'timeline' && <RoadmapTimeline />}
          {roadmapView === 'gantt' && <RoadmapGantt />}
          {roadmapView === 'map' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <PmCard title={t('riceMatrix')}>
                <RiceMatrix />
              </PmCard>
              <PmCard title={t('dependencyMap')}>
                <DependencyGraph />
              </PmCard>
            </div>
          )}
        </>
      )}

      {section === 'roi' && <RoiDashboard />}
    </div>
  );
}
