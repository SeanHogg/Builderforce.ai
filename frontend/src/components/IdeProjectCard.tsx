'use client';

import { useTranslations } from 'next-intl';
import { useModalityCopy } from '@/lib/useModalityCopy';
import type { IdeProject } from '@/lib/types';

/**
 * Card for a single IDE project (0224) on the IDE dashboard. Self-contained:
 * renders its own modality glyph, parent-Project chip, and Open / Details /
 * Delete actions. Opening (card body or Open) launches the backing storage
 * project's IDE; Details opens the rename + reassign-parent modal.
 */
export function IdeProjectCard({
  ideProject,
  onOpen,
  onDetails,
  onDelete,
}: {
  ideProject: IdeProject;
  onOpen: (p: IdeProject) => void;
  onDetails: (p: IdeProject) => void;
  onDelete: (p: IdeProject) => void;
}) {
  const t = useTranslations('ide');
  const m = useModalityCopy()(ideProject.modality);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(ideProject)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(ideProject); }}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: 16,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'border-color 0.2s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = ''; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 22 }} aria-hidden>{m.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ideProject.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {ideProject.storageProjectKey}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            title={t('details')}
            aria-label={t('details')}
            onClick={(e) => { e.stopPropagation(); onDetails(ideProject); }}
            style={iconBtn}
          >
            ⚙
          </button>
          <button
            type="button"
            title={t('deleteAction')}
            aria-label={t('deleteAction')}
            onClick={(e) => { e.stopPropagation(); onDelete(ideProject); }}
            style={iconBtn}
          >
            🗑
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={chip}>{m.label}</span>
        <span style={{ ...chip, color: ideProject.containerName ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
          {ideProject.containerName ? `📁 ${ideProject.containerName}` : t('ungrouped')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {new Date(ideProject.updatedAt).toLocaleDateString()}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(ideProject); }}
          style={{
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
            border: '1px solid var(--border-subtle)', background: 'transparent',
            color: 'var(--coral-bright)', cursor: 'pointer',
          }}
        >
          {t('open')}
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-secondary)',
};

const chip: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
};
