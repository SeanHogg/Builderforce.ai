'use client';

import { useState } from 'react';
import { ViewToggle } from '@/components/ViewToggle';
import { usePmScope } from '@/lib/pm/scope';
import { EpicTreeView } from './EpicTreeView';
import { DependencyGraph } from './DependencyGraph';
import { RoadmapTimeline } from './RoadmapTimeline';
import { RoadmapGantt } from './RoadmapGantt';
import { RiceMatrix } from './RiceMatrix';
import { RoiDashboard } from './RoiDashboard';
import { PmCard } from './pmShared';

/**
 * Product Management visualizers container — the single switchboard behind the
 * `pm` tab. Owns the section selector (Epics / Roadmap / ROI) and each section's
 * sub-view toggle. Scope (project vs portfolio) comes from {@link usePmScope}, so
 * nothing here prop-drills a project id. Must be rendered inside a PmScopeProvider.
 */
type Section = 'epics' | 'roadmap' | 'roi';
type EpicView = 'tree' | 'flow';
type RoadmapView = 'timeline' | 'gantt' | 'map';

export function PmVisualizersContent() {
  const { isPortfolio } = usePmScope();
  const [section, setSection] = useState<Section>('roadmap');
  const [epicView, setEpicView] = useState<EpicView>('tree');
  const [roadmapView, setRoadmapView] = useState<RoadmapView>('timeline');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <ViewToggle<Section>
          value={section}
          onChange={setSection}
          options={[
            { value: 'epics', label: 'Epics' },
            { value: 'roadmap', label: 'Roadmap' },
            { value: 'roi', label: 'ROI' },
          ]}
        />
        {section === 'epics' && (
          <ViewToggle<EpicView>
            value={epicView}
            onChange={setEpicView}
            options={[
              { value: 'tree', label: 'Tree' },
              { value: 'flow', label: 'Flow' },
            ]}
          />
        )}
        {section === 'roadmap' && (
          <ViewToggle<RoadmapView>
            value={roadmapView}
            onChange={setRoadmapView}
            options={[
              { value: 'timeline', label: 'Timeline' },
              { value: 'gantt', label: 'Gantt' },
              { value: 'map', label: 'Map' },
            ]}
          />
        )}
      </div>

      {section === 'epics' && (epicView === 'tree' ? <EpicTreeView /> : <DependencyGraph />)}

      {section === 'roadmap' && (
        <>
          {roadmapView === 'timeline' && <RoadmapTimeline />}
          {roadmapView === 'gantt' && <RoadmapGantt />}
          {roadmapView === 'map' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <PmCard title="RICE matrix">
                <RiceMatrix />
              </PmCard>
              <PmCard title="Dependency map">
                <DependencyGraph />
              </PmCard>
            </div>
          )}
        </>
      )}

      {section === 'roi' && <RoiDashboard />}

      {isPortfolio && section === 'epics' && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Viewing the portfolio — epics and dependencies are per-project. Open a project to see them.
        </div>
      )}
    </div>
  );
}
