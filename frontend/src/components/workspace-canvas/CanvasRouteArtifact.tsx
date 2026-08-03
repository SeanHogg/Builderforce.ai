'use client';

import { useMemo, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { findActiveGroup } from '@/lib/navGroups';
import { WorkspaceCanvas, type WorkspaceCanvasPanel } from './WorkspaceCanvas';
import { shouldRenderRouteAsCanvasArtifact } from './routeCanvasPolicy';

function fallbackTitle(pathname: string): string {
  const leaf = pathname.split('/').filter(Boolean).at(-1) ?? 'workspace';
  return leaf.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Transitional renderer for dedicated application pages. The page component
 * remains fully interactive, but now executes as a movable/resizable artifact
 * on the common spatial canvas. As each domain is decomposed further, its child
 * widgets can become sibling panels without changing its route contract.
 */
export function CanvasRouteArtifact({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const t = useTranslations('nav');
  const group = findActiveGroup(pathname);
  const tabId = searchParams.get('tab') ?? '';
  const tab = group?.tabs?.find((candidate) => group.tabKind === 'query'
    ? candidate.id === tabId
    : candidate.id === pathname || candidate.activePaths?.some((prefix) => pathname.startsWith(prefix)));
  const title = tab ? t(tab.labelKey) : group ? t(group.labelKey) : fallbackTitle(pathname);
  const icon = tab?.icon ?? group?.icon ?? '◇';

  const panels = useMemo<WorkspaceCanvasPanel[]>(() => [{
    id: `route:${pathname}`,
    title,
    subtitle: 'Application artifact',
    icon,
    content: children,
    position: { x: 48, y: 48 },
    width: 1380,
    height: 820,
  }], [children, icon, pathname, title]);

  if (!shouldRenderRouteAsCanvasArtifact(pathname)) return <>{children}</>;
  return <WorkspaceCanvas panels={panels} />;
}
