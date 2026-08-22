'use client';

/**
 * The project drawer — a CONTAINER, and nothing else.
 *
 * It used to be 804 lines and nine responsibilities: the drawer chrome, the header,
 * the tab strip, the whole overview edit form (six fields, a debounced key-availability
 * request and a save), the analytics layout, the workspace shortcuts, the
 * recommendation routing, and the delete confirmation — plus the six tabs it
 * delegates. Everything in it had to be edited here, which is the definition of the
 * file everyone has to edit.
 *
 * What is left is the one job a container has: which tab is open, and which
 * component renders it. The tab SET is data (`projectPanelTabs.ts`), the form is a
 * hook (`useProjectEditForm`), "take me to the fix" is a hook
 * (`useRecommendationRouting`), and each non-trivial tab is its own component in
 * `project-details/`.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { TaskMgmtContent } from './TaskMgmtContent';
import { PRDsContent } from './PRDsContent';
import { AgentTab } from './agent/AgentTab';
import { BrainPanel } from './brain/BrainPanel';
import { SourceControlContent } from './sourcecontrol/SourceControlContent';
import { IntegrationCredentialsManager } from './integrations/IntegrationCredentialsManager';
import { BoardConnectionsManager } from './integrations/BoardConnectionsManager';
import { ProjectDiagnosticsTab } from './ProjectDiagnosticsTab';
import { ProjectAnalyticsTab } from './project-details/ProjectAnalyticsTab';
import { ProjectOverviewTab } from './project-details/ProjectOverviewTab';
import { ProjectPanelHeader } from './project-details/ProjectPanelHeader';
import { ProjectPanelTabBar } from './project-details/ProjectPanelTabBar';
import { ProjectWorkspaceTab } from './project-details/ProjectWorkspaceTab';
import { panelDrawerStyle, panelOverlayStyle } from './project-details/panelStyles';
import { useProjectEditForm } from './project-details/useProjectEditForm';
import { useRecommendationRouting } from './project-details/useRecommendationRouting';
import type { ProjectPanelTab } from './project-details/projectPanelTabs';

export interface ProjectDetailsPanelProps {
  project: Project;
  open: boolean;
  onClose: () => void;
  /** Initial tab when panel opens. */
  initialTab?: ProjectPanelTab;
  /** When opening on the diagnostics tab from a notification deep-link, the audit
   *  whose results should auto-open. */
  initialAuditId?: string | null;
  /** When opening on the PRDs tab, the spec KIND whose document should auto-open
   *  (e.g. 'architecture' for "view the arch analysis"). */
  initialSpecKind?: string | null;
  /** Same, but the EXACT spec id — how a Brain chat's "Open" on a created PRD lands
   *  on that document rather than on the tab that lists it. Wins over the kind. */
  initialSpecId?: string | null;
  /** Called when project is updated (e.g. name, description). */
  onProjectUpdate?: (project: Project) => void;
  /** Called when the user deletes the project. Prompts for confirmation first. */
  onDelete?: (project: Project) => void;
}

export function ProjectDetailsPanel({
  project,
  open,
  onClose,
  initialTab = 'analytics',
  initialAuditId,
  initialSpecKind = null,
  initialSpecId = null,
  onProjectUpdate,
  onDelete,
}: ProjectDetailsPanelProps) {
  const t = useTranslations('projectDetails');
  const [activeTab, setActiveTab] = useState<ProjectPanelTab>(initialTab);
  const form = useProjectEditForm(project, onProjectUpdate);
  const routing = useRecommendationRouting({
    open,
    activeTab,
    initialSpecKind,
    initialSpecId,
    onOpenTab: setActiveTab,
    onOpenEditForm: form.begin,
    editing: form.editing,
  });

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Leaving the details tab abandons an in-progress edit rather than keeping a
  // form alive on a screen that no longer shows it.
  useEffect(() => {
    if (activeTab !== 'details' && form.editing) form.cancel();
  }, [activeTab, form]);

  if (!open) return null;

  const isChat = activeTab === 'brainChat';

  return (
    <>
      <div className="project-panel-overlay" role="presentation" style={panelOverlayStyle} onClick={onClose} aria-hidden />
      <div className="project-panel-drawer" style={panelDrawerStyle} role="dialog" aria-label={t('dialogAria')}>
        <ProjectPanelHeader project={project} onClose={onClose} onDelete={onDelete} />
        <ProjectPanelTabBar active={activeTab} onSelect={setActiveTab} />

        <div style={{ flex: 1, overflow: isChat ? 'hidden' : 'auto', padding: isChat ? 0 : 20 }}>
          {activeTab === 'analytics' && (
            <ProjectAnalyticsTab project={project} onOpenTab={setActiveTab} onTargetRecommendation={routing.target} />
          )}

          {activeTab === 'details' && <ProjectOverviewTab project={project} form={form} />}

          {activeTab === 'integrations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <IntegrationCredentialsManager projectId={project.id} heading={t('integrationKeys')} />
              <SourceControlContent projectId={project.id} />
              <BoardConnectionsManager projectId={project.id} />
            </div>
          )}

          {activeTab === 'taskMgmt' && <TaskMgmtContent projectId={project.id} projectName={project.name} />}

          {activeTab === 'prds' && (
            <PRDsContent
              projectId={project.id}
              projectName={project.name}
              initialSpecKind={routing.pendingSpecKind}
              initialSpecId={routing.pendingSpecId}
              onInitialSpecConsumed={routing.consumeSpec}
            />
          )}

          {activeTab === 'diagnostics' && (
            <ProjectDiagnosticsTab projectId={project.id} initialAuditId={initialAuditId} />
          )}

          {isChat && (
            <div style={{ height: '100%' }}>
              <BrainPanel variant="docked" pinnedProjectId={project.id} />
            </div>
          )}

          {activeTab === 'workspace' && <ProjectWorkspaceTab project={project} onOpenTab={setActiveTab} />}

          {activeTab === 'capabilities' && (
            <AgentTab projectId={project.id} agentHostId={project.assignedAgentHost?.id} />
          )}
        </div>
      </div>
    </>
  );
}
