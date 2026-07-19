'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import type { ProjectDiagnosticSummary } from '@/lib/tools';
import { ProjectHealthGauges } from './ProjectHealth';
import { ProjectInspectionGrade } from './ProjectInspection';
import { ProjectOriginBadge } from './ProjectOriginBadge';
import type { ProjectPanelTab } from './ProjectDetailsPanel';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { RunDiagnosticsButton } from './RunDiagnosticsButton';
import { ProjectDiagnosticsStrip } from './ProjectDiagnosticsStrip';

export interface ProjectCardProps {
  project: Project;
  /** Called when the card body is clicked (e.g. open details panel). */
  onCardClick?: (project: Project) => void;
  /** Open the project Information panel. The Details icon opens the default tab;
   *  the Architecture button opens 'prds' (view result) or 'integrations' (map a
   *  repo first). A card that can open details gets the full button group. */
  onDetailsClick?: (project: Project, tab?: ProjectPanelTab) => void;
  /** Show the Details button. Default true when onDetailsClick is provided. */
  showDetailsButton?: boolean;
  /** When user clicks the assigned agent (Workforce), called with assignedAgentHost so parent can open agent panel. */
  onAssignedAgentClick?: (assignedAgentHost: { id: number; name: string }) => void;
  /** Show a delete (trash) icon; called when the user confirms deletion. */
  onDelete?: (project: Project) => void;
  /** Show the delete icon. Defaults to true when onDelete is provided. */
  showDeleteButton?: boolean;
  /** Override the 💻 IDE button action. Defaults to opening the project in the
   *  editor (`/ide/<id>`); the Projects page overrides this to route through the
   *  IDE dashboard scoped to the project. */
  onOpenIde?: (project: Project) => void;
  /** Latest per-diagnostic scores (SOC 2, Quality, …) for this project, from the
   *  workspace rollup. Rendered as a compact score strip; omit/empty hides it. */
  diagnostics?: ProjectDiagnosticSummary[];
}

const createdDate = (project: Project): string => {
  if (project.created_at) return new Date(project.created_at).toLocaleDateString();
  const createdAt = (project as { createdAt?: string }).createdAt;
  return createdAt ? new Date(createdAt).toLocaleDateString() : '';
};

export function ProjectCard({
  project,
  onCardClick,
  onDetailsClick,
  showDetailsButton = !!onDetailsClick,
  onAssignedAgentClick,
  onDelete,
  showDeleteButton = !!onDelete,
  onOpenIde,
  diagnostics,
}: ProjectCardProps) {
  const t = useTranslations('projectCard');
  const openIde = onOpenIde ?? ((p: Project) => { window.location.href = `/ide/${p.publicId ?? p.id}`; });
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onCardClick && e.key === 'Enter') {
      e.preventDefault();
      onCardClick(project);
    }
  };

  const [showConfirm, setShowConfirm] = useState(false);
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    setShowConfirm(true);
  };

  // Shared style for the square icon buttons in the card header so they can't drift.
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

  return (
    <div
      role={onCardClick ? 'button' : undefined}
      tabIndex={onCardClick ? 0 : undefined}
      onClick={onCardClick ? () => onCardClick(project) : undefined}
      onKeyDown={onCardClick ? handleKeyDown : undefined}
      style={{
        padding: 20,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        transition: 'border-color 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: onCardClick ? 'pointer' : undefined,
      }}
      onMouseEnter={onCardClick ? (e) => { e.currentTarget.style.borderColor = 'var(--accent)'; } : undefined}
      onMouseLeave={onCardClick ? (e) => { e.currentTarget.style.borderColor = ''; } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text-primary)' }}>{project.name}</h3>
          {project.key != null && project.key !== '' && (
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 2 }}>
              {project.key}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {project.status != null && project.status !== '' && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  background: 'var(--surface-interactive)',
                  padding: '2px 6px',
                  borderRadius: 6,
                  textTransform: 'capitalize',
                  display: 'inline-block',
                }}
              >
                {project.status.replace(/_/g, ' ')}
              </span>
            )}
            <ProjectOriginBadge origin={project.origin} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {showDetailsButton && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetailsClick?.(project);
              }}
              aria-label={t('details')}
              style={iconButtonStyle}
            >
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <path d="M9 2h6l6 6v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4z" />
                <circle cx="15" cy="15" r="3" />
                <line x1="17.5" y1="17.5" x2="21" y2="21" />
              </svg>
            </button>
          )}
          {/* Task board button — opens the Task board scoped to this project */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `/projects?tab=tasks&project=${project.id}`;
            }}
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
          {/* Project 360 button — the whole-picture health view (health wheel,
              missing items, who's working). Reuses the shared <Project360View>. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `/projects/${project.id}/360`;
            }}
            aria-label={t('health360')}
            title={t('health360')}
            style={iconButtonStyle}
          >
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3 v9 l6.5 3.5" />
            </svg>
          </button>
          {/* IDE button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openIde(project);
            }}
            aria-label={t('openIde')}
            style={iconButtonStyle}
          >
            <span style={{ fontSize: 18 }} aria-hidden>💻</span>
          </button>
          {showDeleteButton && onDelete && (
            <>
              <button
                type="button"
                onClick={handleDeleteClick}
                aria-label={t('deleteProject')}
                style={iconButtonStyle}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>
              <DeleteProjectDialog
                project={showConfirm ? project : null}
                onCancel={() => setShowConfirm(false)}
                onConfirm={() => {
                  setShowConfirm(false);
                  onDelete(project);
                }}
              />
            </>
          )}
        </div>
      </div>
      {project.description && (
        <p
          title={project.description}
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            marginBottom: 4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            lineHeight: 1.5,
          }}
        >
          {project.description}
        </p>
      )}
      {project.assignedAgentHost && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>{t('agentLabel')}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAssignedAgentClick?.(project.assignedAgentHost!);
            }}
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
        </div>
      )}

      {/* Health speedometer + % done ring — the at-a-glance "is this project on
          track and how far along" visual. Shared with the details panel so the
          numbers/colours can never drift between surfaces. */}
      <ProjectHealthGauges project={project} />

      {/* Full-inspection PM grade — the "where does this project need to go" rating
          (vision/goals/planning/health/progress/execution). Clicking opens the
          prescriptive report in the details panel so the user knows what to target. */}
      <ProjectInspectionGrade
        project={project}
        onOpen={onDetailsClick ? (p) => onDetailsClick(p, 'analytics') : undefined}
      />

      {/* Diagnostics run against this project (SOC 2 readiness, Quality, …) — the
          latest score per diagnostic, straight from the workspace rollup so the
          card can show them without a per-card fetch. Self-hides when none. */}
      <ProjectDiagnosticsStrip
        diagnostics={diagnostics ?? []}
        onOpen={onDetailsClick ? () => onDetailsClick(project, 'diagnostics') : undefined}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
        {project.taskCount != null && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('tasks', { count: project.taskCount })}
          </span>
        )}
        {project.workflowCount != null && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('workflows', { count: project.workflowCount })}
            </span>
          </>
        )}
        <div style={{ flex: 1, minWidth: 0 }} />
        {onDetailsClick && (
          <RunDiagnosticsButton
            project={project}
            onOpen={(p) => onDetailsClick(p, 'diagnostics')}
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            window.location.href = `/workflows?project=${project.id}`;
          }}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--coral-bright)',
            background: 'transparent',
            border: '1px solid var(--coral-bright)',
            borderRadius: 8,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          {t('viewWorkflows')}
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{createdDate(project)}</p>
    </div>
  );
}
