// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonLink } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { fetchIdeProjectByStorage } from '@/lib/ideProjectsApi';
import { canvasAppPath } from '@/lib/studio/studioHost';

/**
 * Studio's way back to the canvas: the same app, on the board that holds it. The
 * canvas App surface's "Open in Studio" is the other direction, so a person moves
 * between the two in one tab.
 *
 * Renders only for a project that HAS a canvas app (a build record). A project
 * started in Studio has none, and the link would land on the build list instead
 * of the app.
 */
export function OpenOnCanvasLink({ projectId, publicId }: { projectId: number; publicId?: string | null }) {
  const t = useTranslations('studio.project');
  const [onCanvas, setOnCanvas] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchIdeProjectByStorage(projectId)
      .then((build) => { if (!cancelled) setOnCanvas(build != null); })
      .catch(() => { if (!cancelled) setOnCanvas(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (!onCanvas) return null;
  return (
    <ButtonLink href={canvasAppPath(publicId ?? projectId)} variant="secondary" size="sm" title={t('openOnCanvasTitle')}>
      <Icon name="canvas" size={14} /> {t('openOnCanvas')}
    </ButtonLink>
  );
}
