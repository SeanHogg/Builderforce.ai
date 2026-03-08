'use client';

import Link from 'next/link';
import type { Project } from '@/lib/types';

export interface ProjectCardProps {
  project: Project;
  /** Called when the card body is clicked (e.g. open details panel). */
  onCardClick?: (project: Project) => void;
  /** When true, show the Details button; when set, called when Details is clicked. */
  onDetailsClick?: (project: Project) => void;
  /** Show the Details button. Default true when onDetailsClick is provided. */
  showDetailsButton?: boolean;
  /** When user clicks the assigned agent (Workforce), called with assignedClaw so parent can open agent panel. */
  onAssignedAgentClick?: (assignedClaw: { id: number; name: string }) => void;
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
}: ProjectCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onCardClick && e.key === 'Enter') {
      e.preventDefault();
      onCardClick(project);
    }
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
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{project.key}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {project.status != null && project.status !== '' && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                background: 'var(--surface-interactive)',
                padding: '2px 6px',
                borderRadius: 6,
                textTransform: 'capitalize',
              }}
            >
              {project.status.replace(/_/g, ' ')}
            </span>
          )}
          {showDetailsButton && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetailsClick?.(project);
              }}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--surface-interactive)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Details
            </button>
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
      {project.assignedClaw && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Agent:</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAssignedAgentClick?.(project.assignedClaw!);
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
            {project.assignedClaw.name}
          </button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
        {project.taskCount != null && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {project.taskCount} task{project.taskCount !== 1 ? 's' : ''}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }} />
        <Link
          href={`/ide/${project.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--coral-bright)',
            textDecoration: 'none',
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--coral-bright)',
            background: 'var(--bg-base)',
          }}
        >
          Open in IDE →
        </Link>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{createdDate(project)}</p>
    </div>
  );
}
