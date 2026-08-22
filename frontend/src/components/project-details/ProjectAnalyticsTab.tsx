'use client';

/**
 * The Analytics tab: the reporting a visitor sees first.
 *
 * The health speedometer and % done ring beside the overall inspection rating,
 * then the prescriptive breakdown. Every visual here is shared with the project
 * card and list (`ProjectHealth`, `ProjectInspection`) so nothing drifts, and the
 * gauges self-hide when the project has no task data.
 *
 * A "what to target" fix is not this tab's business to carry out — it hands the
 * recommendation up, and `useRecommendationRouting` decides where a fix is made.
 */
import type { Project } from '@/lib/types';
import { ProjectHealthGauges } from '@/components/ProjectHealth';
import { ProjectInspectionReport, ProjectInspectionSummary } from '@/components/ProjectInspection';
import type { InspectionRecommendation } from '@/lib/projectInspection';
import { tabGridStyle } from './panelStyles';
import type { ProjectPanelTab } from './projectPanelTabs';

export function ProjectAnalyticsTab({
  project,
  onOpenTab,
  onTargetRecommendation,
}: {
  project: Project;
  onOpenTab: (tab: ProjectPanelTab) => void;
  onTargetRecommendation: (rec: InspectionRecommendation) => void;
}) {
  return (
    <div style={tabGridStyle}>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <ProjectHealthGauges project={project} size={120} />
        <div style={{ flex: 1, minWidth: 260 }}>
          <ProjectInspectionSummary project={project} />
        </div>
      </div>

      {/* Every dimension benchmarked + a "what to target" list that deep-links each
          fix to the right tab. The rating summary is in the metrics row above. */}
      <div style={{ gridColumn: '1 / -1' }}>
        <ProjectInspectionReport
          project={project}
          onNavigate={onOpenTab}
          onTargetRecommendation={onTargetRecommendation}
          showSummary={false}
        />
      </div>
    </div>
  );
}
