// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { ButtonLink } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { canvasAppPath } from '@/lib/studio/studioHost';

/**
 * Studio's way back to the canvas: the same app, on the board that holds it. The
 * canvas App surface's "Open in Studio" is the other direction, so a person moves
 * between the two in one tab.
 *
 * Every Studio project gets it. One started in Studio has no build record yet;
 * `BuildCanvasRedirect` binds one on the way through and places it on a board.
 */
export function OpenOnCanvasLink({ projectId, publicId }: { projectId: number; publicId?: string | null }) {
  const t = useTranslations('studio.project');
  return (
    <ButtonLink href={canvasAppPath(publicId ?? projectId)} variant="secondary" size="sm" title={t('openOnCanvasTitle')}>
      <Icon name="canvas" size={14} /> {t('openOnCanvas')}
    </ButtonLink>
  );
}
