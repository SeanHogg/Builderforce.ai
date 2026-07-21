'use client';

import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';

/**
 * ProjectOriginBadge — a small pill marking where a project was born. Self-gating:
 * renders nothing unless the project has a badge-worthy origin ('ide' or
 * 'imported'), so every consumer (card, table, details) can drop it in
 * unconditionally without computing visibility itself.
 */
const BADGES: Record<string, { labelKey: 'originBuilder' | 'originImported'; titleKey: 'originBuilderTitle' | 'originImportedTitle'; icon: string }> = {
  ide: { labelKey: 'originBuilder', titleKey: 'originBuilderTitle', icon: '🌐' },
  imported: { labelKey: 'originImported', titleKey: 'originImportedTitle', icon: '📥' },
};

export function ProjectOriginBadge({ origin, style }: { origin?: string | null; style?: React.CSSProperties }) {
  const t = useTranslations('projectCard');
  const badge = origin ? BADGES[origin] : undefined;
  if (!badge) return null;
  return (
    <span
      title={t(badge.titleKey)}
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
      {t(badge.labelKey)}
    </span>
  );
}

/** Convenience for the common case of passing a whole project. */
export function ProjectOriginBadgeFor({ project, style }: { project: Pick<Project, 'origin'>; style?: React.CSSProperties }) {
  return <ProjectOriginBadge origin={project.origin} style={style} />;
}
