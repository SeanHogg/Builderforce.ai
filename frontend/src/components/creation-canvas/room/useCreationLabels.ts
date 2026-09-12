import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { RoomCreation } from '@/lib/canvas/roomCreations';

export interface CreationLabels {
  title: string;
  kind: string;
  /** The accessible name of its Open — or Play, for a level played in the room. */
  openName: string;
  /** The visible word on that button. */
  openLabel: string;
}

/**
 * What one creation in the room is called, what it is, and what its button says.
 *
 * Shared by the 3D stand and the no-WebGL list, so the two readings of the room name
 * a creation the same way and offer the same verb: a Roblox place is PLAYED here, in
 * the room; everything else is opened into the surface its kind has.
 */
export function useCreationLabels(): (creation: RoomCreation) => CreationLabels {
  const t = useTranslations('creationCanvas.surface.room');
  const tCanvas = useTranslations('creationCanvas');
  return useCallback((creation: RoomCreation) => {
    const title = creation.title || t('creation.untitled');
    const plays = !!creation.placeUrl;
    return {
      title,
      kind: tCanvas(`object.${creation.kind}`),
      openName: plays ? t('level.playNamed', { title }) : t('creation.openNamed', { title }),
      openLabel: plays ? t('level.play') : t('session.openButton'),
    };
  }, [t, tCanvas]);
}
