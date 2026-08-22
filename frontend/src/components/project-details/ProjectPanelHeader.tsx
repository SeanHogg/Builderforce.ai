'use client';

/**
 * The drawer's header: what project this is, and the two ways out of it.
 *
 * Delete is a destructive approval, so it goes through `DeleteProjectDialog` — a
 * modal, which is the one thing modals are for here. The header owns the confirm
 * state because nothing above it needs to know the dialog is open.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { useProjectStatusLabel } from '@/lib/projectStatus';
import { DeleteProjectDialog } from '@/components/DeleteProjectDialog';

const iconButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-base)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const iconStyle: React.CSSProperties = { width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 };

export function ProjectPanelHeader({
  project,
  onClose,
  onDelete,
}: {
  project: Project;
  onClose: () => void;
  /** Absent when this caller cannot delete — the button then does not exist. */
  onDelete?: (project: Project) => void;
}) {
  const t = useTranslations('projectDetails');
  const statusLabel = useProjectStatusLabel();
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>
          {project.name}
        </div>
        <div style={{ fontSize: 'var(--font-size-small)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
          {project.key ?? `#${project.id}`}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {project.status && (
          <span
            style={{
              fontSize: 'var(--font-size-eyebrow)',
              fontWeight: 600,
              textTransform: 'uppercase',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              background: project.status === 'active' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
              color: 'var(--text-secondary)',
            }}
          >
            {statusLabel(project.status)}
          </span>
        )}
        {onDelete && (
          <>
            <button type="button" onClick={() => setConfirming(true)} aria-label={t('deleteAria')} style={iconButtonStyle}>
              <svg viewBox="0 0 24 24" style={iconStyle}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
            </button>
            <DeleteProjectDialog
              project={confirming ? project : null}
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                onDelete(project);
              }}
            />
          </>
        )}
        <button type="button" onClick={onClose} style={iconButtonStyle} aria-label={t('closeAria')}>
          <svg viewBox="0 0 24 24" style={iconStyle}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
