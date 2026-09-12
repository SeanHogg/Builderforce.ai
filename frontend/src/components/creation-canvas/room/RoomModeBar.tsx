import { useTranslations } from 'next-intl';
import { useCanvasBoardBridge } from '../canvasBoardBridge';
import styles from './room.module.css';

/** How the reader is in the room: looking round it, walking it, or rearranging it. */
export type RoomMode = 'look' | 'walk' | 'design';

export interface RoomWalkChrome {
  cameraView: 'first' | 'third';
  onToggleCamera: () => void;
  onRespawn: () => void;
}

/**
 * THE ROOM'S OWN CONTROLS — Look · Walk · Design, on the room itself.
 *
 * On the stage, not on the session bar: the room publishes only its status there
 * (an earlier control group pushed the bar under the Brain panel). Design is offered
 * only to someone who can edit the board, decided here from the board itself rather
 * than from a flag a host passes down. While walking, the two things a walker needs
 * — the camera and a way back to the door — sit beside the mode they belong to.
 */
export function RoomModeBar({ mode, onMode, walk }: { mode: RoomMode; onMode: (mode: RoomMode) => void; walk?: RoomWalkChrome | undefined }) {
  const t = useTranslations('creationCanvas.surface.room.mode');
  const tWorld = useTranslations('creationCanvas.surface.world');
  const designable = !!useCanvasBoardBridge()?.edits;
  const modes: RoomMode[] = designable ? ['look', 'walk', 'design'] : ['look', 'walk'];

  return (
    <div className={styles.modeBar} role="toolbar" aria-label={t('label')}>
      <div className={styles.modeGroup} role="group">
        {modes.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.modeButton}
            aria-pressed={mode === id}
            data-testid={`room-mode-${id}`}
            title={t(`${id}Hint`)}
            onClick={() => onMode(id)}
          >
            {t(id)}
          </button>
        ))}
      </div>
      {mode === 'walk' && walk && (
        <div className={styles.modeGroup} role="group">
          <button type="button" className={styles.modeButton} onClick={walk.onToggleCamera} title={walk.cameraView === 'first' ? tWorld('switchToThird') : tWorld('switchToFirst')}>
            {walk.cameraView === 'first' ? tWorld('cameraThird') : tWorld('cameraFirst')}
          </button>
          <button type="button" className={styles.modeButton} onClick={walk.onRespawn}>{t('toDoor')}</button>
        </div>
      )}
    </div>
  );
}
