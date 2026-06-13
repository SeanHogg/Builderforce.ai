'use client';

import { SourceControlContent } from './sourcecontrol/SourceControlContent';

/**
 * IDE settings slide-out (opened from the header cog). Today it hosts the
 * project's source-control configuration — the repositories the Designer's
 * coding agent can read and open pull requests against. Kept separate from the
 * Project Details panel so repo setup is one click away while building.
 */
export interface IdeSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  /** Called after a repo is imported, so the IDE can refresh its file tree. */
  onImported?: () => void;
}

export function IdeSettingsPanel({ open, onClose, projectId, onImported }: IdeSettingsPanelProps) {
  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 'var(--footer-height, 44px)',
          background: 'rgba(0,0,0,0.5)',
          zIndex: 9998,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project settings"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 'var(--footer-height, 44px)',
          width: 'min(460px, 92vw)',
          borderLeft: '1px solid var(--border-subtle)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.2)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-base)',
          fontFamily: 'var(--font-display)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
            background: 'var(--bg-elevated)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚙️</span> Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '6px 10px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 16 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
            Source control
          </div>
          <SourceControlContent projectId={projectId} onImported={onImported} />
        </div>
      </div>
    </>
  );
}
