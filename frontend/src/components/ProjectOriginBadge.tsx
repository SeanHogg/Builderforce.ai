'use client';

import type { Project } from '@/lib/types';

/**
 * ProjectOriginBadge — a small pill marking where a project was born. Self-gating:
 * renders nothing unless the project has a badge-worthy origin ('ide' or
 * 'imported'), so every consumer (card, table, details) can drop it in
 * unconditionally without computing visibility itself.
 */
const BADGES: Record<string, { label: string; icon: string }> = {
  ide: { label: 'Designer', icon: '🎨' },
  imported: { label: 'Imported', icon: '📥' },
};

export function ProjectOriginBadge({ origin, style }: { origin?: string | null; style?: React.CSSProperties }) {
  const badge = origin ? BADGES[origin] : undefined;
  if (!badge) return null;
  return (
    <span
      title={origin === 'ide' ? 'Started in the IDE (Designer)' : 'Imported from a repository'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 600, lineHeight: 1.4,
        padding: '2px 8px', borderRadius: 999,
        background: 'var(--surface-interactive, var(--bg-deep))',
        border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)',
        ...style,
      }}
    >
      <span aria-hidden>{badge.icon}</span>
      {badge.label}
    </span>
  );
}

/** Convenience for the common case of passing a whole project. */
export function ProjectOriginBadgeFor({ project, style }: { project: Pick<Project, 'origin'>; style?: React.CSSProperties }) {
  return <ProjectOriginBadge origin={project.origin} style={style} />;
}
