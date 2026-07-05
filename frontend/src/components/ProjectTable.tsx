'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import type { ProjectDiagnosticSummary } from '@/lib/tools';
import { ProjectOriginBadge } from './ProjectOriginBadge';
import { ProjectHealthBadge } from './ProjectHealth';
import type { ProjectPanelTab } from './ProjectDetailsPanel';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { RunDiagnosticsButton } from './RunDiagnosticsButton';
import { ProjectDiagnosticsStrip } from './ProjectDiagnosticsStrip';
import { tableWrapStyle, tableStyle } from './dataTableStyles';

export interface ProjectTableProps {
  projects: Project[];
  /** Per-project latest diagnostic scores (SOC 2, Quality, …), keyed by project
   *  id, from the workspace rollup. Rendered as a compact strip; empty hides it. */
  diagnosticsByProject?: Map<number, ProjectDiagnosticSummary[]>;
  /** Open the project Information panel. The Details button opens the default tab;
   *  the Architecture button opens 'prds' / 'integrations'. A row that can open
   *  details gets the Architecture button — same rule as {@link ProjectCard}. */
  onDetailsClick?: (project: Project, tab?: ProjectPanelTab) => void;
  /** Override the 💻 IDE action. Defaults to opening the project editor (`/ide/<id>`). */
  onOpenIde?: (project: Project) => void;
  /** Click the assigned agent name → parent opens the agent panel. */
  onAssignedAgentClick?: (assignedAgentHost: { id: number; name: string }) => void;
  /** Show a delete action; called once the user confirms in the dialog. */
  onDelete?: (project: Project) => void;
}

const cellStyle: React.CSSProperties = { padding: '12px 16px' };
const headStyle: React.CSSProperties = { ...cellStyle, fontWeight: 600, color: 'var(--text-secondary)' };
const iconButtonStyle: React.CSSProperties = {
  padding: 6,
  fontSize: 0,
  background: 'var(--bg-base)',
  color: 'var(--coral-bright)',
  border: '1px solid var(--coral-bright)',
  borderRadius: 8,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
};

/**
 * Tabular project list — the List view counterpart to {@link ProjectCard}. Both
 * the Dashboard and Projects/Tasks pages render this so the row actions (Details,
 * Task board, IDE, Architecture, Workflows, Delete) can't drift between surfaces.
 * Delete is self-contained (per-row {@link DeleteProjectDialog}), mirroring the card.
 */
export function ProjectTable({
  projects,
  diagnosticsByProject,
  onDetailsClick,
  onOpenIde,
  onAssignedAgentClick,
  onDelete,
}: ProjectTableProps) {
  const t = useTranslations('projectTable');
  const router = useRouter();
  const [confirmProject, setConfirmProject] = useState<Project | null>(null);
  const openIde = onOpenIde ?? ((p: Project) => { window.location.href = `/ide/${p.publicId ?? p.id}`; });

  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
            <th style={headStyle}>{t('name')}</th>
            <th style={headStyle}>{t('health')}</th>
            <th style={headStyle}>{t('diagnostics')}</th>
            <th style={headStyle}>{t('description')}</th>
            <th style={headStyle}>{t('agent')}</th>
            <th style={headStyle}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ ...cellStyle, fontWeight: 500, color: 'var(--text-primary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {project.name}
                  <ProjectOriginBadge origin={project.origin} />
                </span>
              </td>
              <td style={cellStyle}>
                <ProjectHealthBadge project={project} />
              </td>
              <td style={cellStyle}>
                {(() => {
                  const diags = diagnosticsByProject?.get(project.id) ?? [];
                  return diags.length > 0 ? (
                    <ProjectDiagnosticsStrip
                      diagnostics={diags}
                      onOpen={onDetailsClick ? () => onDetailsClick(project, 'diagnostics') : undefined}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                  );
                })()}
              </td>
              <td style={{ ...cellStyle, color: 'var(--text-secondary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {project.description ?? '—'}
              </td>
              <td style={cellStyle}>
                {project.assignedAgentHost ? (
                  <button
                    type="button"
                    onClick={() => onAssignedAgentClick?.(project.assignedAgentHost!)}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--coral-bright)',
                      background: 'none',
                      border: 'none',
                      cursor: onAssignedAgentClick ? 'pointer' : 'default',
                      padding: 0,
                      textDecoration: 'underline',
                    }}
                  >
                    {project.assignedAgentHost.name}
                  </button>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                )}
              </td>
              <td style={cellStyle}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {onDetailsClick && (
                    <button
                      type="button"
                      onClick={() => onDetailsClick(project)}
                      aria-label={t('details')}
                      title={t('details')}
                      style={iconButtonStyle}
                    >
                      <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                        <path d="M9 2h6l6 6v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4z" />
                        <circle cx="15" cy="15" r="3" />
                        <line x1="17.5" y1="17.5" x2="21" y2="21" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => router.push(`/projects?tab=tasks&project=${project.id}`)}
                    aria-label={t('taskBoard')}
                    title={t('taskBoard')}
                    style={iconButtonStyle}
                  >
                    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                      <rect x="3" y="4" width="4" height="16" rx="1" />
                      <rect x="10" y="4" width="4" height="11" rx="1" />
                      <rect x="17" y="4" width="4" height="14" rx="1" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/workflows?project=${project.id}`)}
                    aria-label={t('viewWorkflows')}
                    title={project.workflowCount != null ? t('workflowsWithCount', { count: project.workflowCount }) : t('workflows')}
                    style={iconButtonStyle}
                  >
                    <span style={{ fontSize: 16 }} aria-hidden>🔀</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openIde(project)}
                    aria-label={t('openIde')}
                    title={t('openIde')}
                    style={iconButtonStyle}
                  >
                    <span style={{ fontSize: 18 }} aria-hidden>💻</span>
                  </button>
                  {onDetailsClick && (
                    <RunDiagnosticsButton
                      project={project}
                      onOpen={(p) => onDetailsClick(p, 'diagnostics')}
                    />
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => setConfirmProject(project)}
                      style={{
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--coral-bright)',
                        background: 'transparent',
                        border: '1px solid var(--coral-bright)',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      {t('delete')}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {onDelete && (
        <DeleteProjectDialog
          project={confirmProject}
          onCancel={() => setConfirmProject(null)}
          onConfirm={(project) => {
            setConfirmProject(null);
            onDelete(project);
          }}
        />
      )}
    </div>
  );
}
