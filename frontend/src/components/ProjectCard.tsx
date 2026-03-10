'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Project } from '@/lib/types';
import { ConfirmDialog } from './ConfirmDialog';

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
  /** Show a delete (trash) icon; called when the user confirms deletion. */
  onDelete?: (project: Project) => void;
  /** Show the delete icon. Defaults to true when onDelete is provided. */
  showDeleteButton?: boolean;
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
}: ProjectCardProps) {
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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {showDetailsButton && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetailsClick?.(project);
              }}
              aria-label="Details"
              style={{
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
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <path d="M9 2h6l6 6v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4z" />
                <circle cx="15" cy="15" r="3" />
                <line x1="17.5" y1="17.5" x2="21" y2="21" />
              </svg>
            </button>
          )}
          {/* IDE button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `/ide/${project.id}`;
            }}
            aria-label="Open in IDE"
            style={{
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
            }}
          >
            <span style={{ fontSize: 18 }} aria-hidden>💻</span>
          </button>
          {showDeleteButton && onDelete && (
            <>
              <button
                type="button"
                onClick={handleDeleteClick}
                aria-label="Delete project"
                style={{
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
                }}
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
              <ConfirmDialog
                open={showConfirm}
                message={`Delete project "${project.name}"? This cannot be undone.`}
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
        {/* moved to header */}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{createdDate(project)}</p>
    </div>
  );
}
