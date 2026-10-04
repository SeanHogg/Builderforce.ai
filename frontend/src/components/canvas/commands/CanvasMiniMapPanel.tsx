import { MiniMap, type Node } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import { useCallback, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import styles from '../CanvasCommands.module.css';

/**
 * The dismissible mini map, pinned bottom-right. It is a map OF the flat board, so
 * it stands down while the canvas is read in 3D — the scene is the map then.
 */
export function CanvasMiniMapPanel({ minimapOpen, setMinimapOpen, threeDActive, nodeColor, maskColor, style }: {
  minimapOpen: boolean;
  setMinimapOpen: Dispatch<SetStateAction<boolean>>;
  threeDActive: boolean;
  nodeColor?: string | ((node: Node) => string);
  maskColor?: string;
  style?: CSSProperties;
}) {
  const t = useTranslations('canvasCommands');
  const close = useCallback(() => setMinimapOpen(false), [setMinimapOpen]);
  if (!minimapOpen || threeDActive) return null;
  return <>
    <MiniMap
      position="bottom-right"
      className={styles.boardChrome}
      pannable
      zoomable
      nodeColor={nodeColor}
      maskColor={maskColor}
      style={style}
    />
    <button type="button" className={styles.minimapClose} onClick={close} aria-label={t('closeMiniMap')} title={t('closeMiniMap')}>×</button>
  </>;
}
