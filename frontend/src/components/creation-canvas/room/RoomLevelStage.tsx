import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { robloxLevelFromUrl } from '@/lib/gameTargets';
import type { RoomCreation } from '@/lib/canvas/roomCreations';
import { WorldViewport } from '../world3d/WorldViewport';
import styles from './room.module.css';

/**
 * A ROBLOX PLACE, PLAYED INSIDE THE ROOM.
 *
 * The level the place holds is walked right here, on the room's stage — the same
 * runtime, the same walker, the same scoring (`WorldViewport`) the play surface uses —
 * with one (X) back to the room it was standing in. It is announced as its own space
 * (the game's object id), so everyone else in the session playing it is drawn in it,
 * and nobody standing in the room is.
 *
 * What it does NOT run is the place's Luau: that runs on Roblox's own servers, and the
 * strip above the level says so rather than implying the scripts are live.
 */
export function RoomLevelStage({ creation, title, onBack, onOpenFull }: {
  creation: RoomCreation;
  title: string;
  onBack: () => void;
  /** Leave the room for the game's own surface — shipping, targets, full screen. */
  onOpenFull: () => void;
}) {
  const t = useTranslations('creationCanvas.surface.room.level');
  const tPlay = useTranslations('creationCanvas.surface.play');
  const level = useMemo(() => (creation.placeUrl ? robloxLevelFromUrl(creation.placeUrl) : null), [creation.placeUrl]);

  return (
    <div className={styles.levelStage} data-testid="room-level-stage">
      <div className={styles.levelStrip}>
        <strong className={styles.levelTitle}>{title}</strong>
        {level && <span className={styles.levelNote}>{tPlay('worldParts', { count: level.partCount })}</span>}
        <span className={styles.levelNote}>{tPlay('robloxScriptsNote')}</span>
        <button type="button" className={styles.levelBack} onClick={onOpenFull}>{t('openFull')}</button>
        <button type="button" className={styles.levelBack} onClick={onBack} aria-label={t('back')} data-testid="room-level-back">
          <span aria-hidden>✕</span>
          <span className={styles.levelBackLabel}>{t('back')}</span>
        </button>
      </div>
      {level
        ? <div className={styles.levelViewport}><WorldViewport scene={level.scene} mode="walk" spaceId={creation.id} /></div>
        : <p className={styles.levelEmpty} role="status">{t('empty')}</p>}
    </div>
  );
}
