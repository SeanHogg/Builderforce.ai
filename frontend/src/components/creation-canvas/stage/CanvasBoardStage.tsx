import type { DragEvent, PointerEvent, ReactNode, RefObject } from 'react';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { BrainDockSide } from '../brainDockPreferences';
import styles from '../CreationCanvas.module.css';

export interface CanvasBoardStageProps {
  boardRef: RefObject<HTMLDivElement | null>;
  /** The edge the Brain dock takes from the board, or `none`. */
  brainSide: BrainDockSide | 'none';
  /** The docked Brain panel is drawn at all. */
  brainOpen: boolean;
  surface: CanvasSurfaceId;
  drawingMode: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onDragEnter: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  children: ReactNode;
}

/** The board's box: what is drawn over it, the board itself and every runtime that takes its centre. */
export function CanvasBoardStage({ boardRef, brainSide, brainOpen, surface, drawingMode, onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onDragEnter, onDragLeave, onDrop, children }: CanvasBoardStageProps) {
  return <div
        ref={boardRef}
        className={styles.flowWrap}
        data-tour="creation-board"
        data-brain-side={brainSide}
        // A phone renders the DOCKED placement as one bottom sheet, so what the board
        // loses there is the bottom edge — not a side. The phone layout moves the
        // board controls off that edge from this, not from the side. An inline Brain
        // is an Object on the board and takes no edge, so it must not set this.
        //
        // It is the SAME condition that decides whether the dock is drawn at all
        // (`brainDockDrawn`), which it was not before: a surface that IS the conversation
        // stands the dock down, and the attribute still claimed the edge — so on a phone
        // the board's rail moved up to `top:56px` to clear a sheet that was not there,
        // and landed on the conversation's own header.
        data-brain-open={brainOpen ? 'true' : 'false'}
        // The active surface, published to the stylesheet. It keys on "not the board"
        // rather than on any single id, so a new runtime suppresses the flat viewport,
        // the palette and the remote cursors without a new rule being written for it.
        data-view={surface}
        data-cursor-mode={drawingMode ? 'draw' : 'pan'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
    {children}
  </div>;
}
