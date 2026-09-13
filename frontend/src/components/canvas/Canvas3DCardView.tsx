'use client';

import { memo, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { canvas3dTranslate, type Canvas3DCard, type Canvas3DNode, type Canvas3DOrbit } from '@/lib/canvas/canvas3d';
import styles from './Canvas3DView.module.css';

export interface Canvas3DCardViewProps {
  card: Canvas3DCard;
  /**
   * The object as its own canvas draws it. Given, the card IS that component at
   * the size the board measured it; absent, the card summarises the object from
   * its descriptor (a canvas with no component of its own to offer).
   */
  face?: ReactNode;
  /** A mesh redrawn from the camera, when the object exported geometry. */
  solid?: string | undefined;
  /** The camera, which a standing mesh turns against so it faces the viewer. */
  orbit: Pick<Canvas3DOrbit, 'yaw' | 'pitch'>;
  selected: boolean;
  movable: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

/**
 * One object in the 3D space.
 *
 * Either way it is a button — focusable, named, the handle every gesture picks
 * up. With a face, the button is laid over the object's own component, which is
 * `inert`: the face is there to be recognised at a distance, and its controls
 * belong to the board, where they can be reached.
 */
export function Canvas3DCardView({ card, face, solid, orbit, selected, movable, onPointerDown, onKeyDown, onClick }: Canvas3DCardViewProps) {
  const t = useTranslations('canvasCommands');
  const placed = {
    transform: canvas3dTranslate(card),
    ...(card.accent ? { ['--canvas-3d-accent' as string]: card.accent } : {}),
  };
  const handle = {
    type: 'button' as const,
    'aria-pressed': selected,
    'data-selected': selected,
    'data-movable': movable,
    onPointerDown,
    onKeyDown,
    onClick,
  };
  // A mesh is drawn from the camera, so it has to face the camera: the card lies
  // flat in the space, and undoing the stage rotation stands the object up on it
  // instead of painting a picture of it onto the floor.
  const standing = solid ? { transform: `rotateY(${-orbit.yaw}deg) rotateX(${-orbit.pitch}deg)` } : undefined;
  const previewAlt = t('threeD.previewAlt', { label: card.label });

  if (face !== undefined) return <div
    className={styles.faceCard}
    style={{ width: card.width, height: card.height, ...placed }}
    data-testid="canvas-3d-face"
  >
    <div className={styles.face} inert>{face}</div>
    {solid && <img className={styles.faceSolid} style={standing} src={solid} alt={previewAlt} width={320} height={190} draggable={false} />}
    <button {...handle} className={styles.faceHandle} aria-label={card.label} />
  </div>;

  return <button {...handle} className={styles.card} style={{ width: card.width, minHeight: card.height, ...placed }}>
    <span className={styles.cardHead}>
      {card.icon && <i aria-hidden><Icon source={card.icon} size={18} /></i>}
      <b>{card.label}</b>
    </span>
    {(solid ?? card.preview) && <img
      className={styles.cardPreview}
      data-solid={!!solid}
      {...(standing ? { style: standing } : {})}
      src={solid ?? card.preview}
      alt={previewAlt}
      width={320}
      height={190}
      loading="lazy"
      draggable={false}
    />}
    {card.sublabel && <span className={styles.cardSub}>{card.sublabel}</span>}
    <span className={styles.cardGroup}>{card.group}</span>
  </button>;
}

interface Canvas3DFaceProps<T extends Canvas3DNode> {
  node: T;
  render: (node: T) => ReactNode;
}

function Canvas3DFaceView<T extends Canvas3DNode>({ node, render }: Canvas3DFaceProps<T>) {
  return <>{render(node)}</>;
}

/**
 * One object's face, redrawn only when that object (or how faces are drawn)
 * changes. The space re-renders on every frame of a turn; a board of full cards —
 * a website's page among them — redrawn sixty times a second would spend the
 * frame on content that has not moved relative to its own card.
 */
export const Canvas3DFace = memo(Canvas3DFaceView) as typeof Canvas3DFaceView;
