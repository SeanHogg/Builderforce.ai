import { useMemo, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { BrainDockSide } from '../brainDockPreferences';
import { CanvasPhaseProvider, type CanvasPhaseProviderProps } from '../phase/CanvasPhaseContext';
import { CanvasDockInsetsContext } from './canvasDockInsets';
import styles from '../CreationCanvas.module.css';

export interface CanvasShellProps {
  shellRef: RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  /** An embedding host (VS Code) supplies surfaces — keep the desktop chrome at any width. */
  hosted: boolean;
  brainDockSide: BrainDockSide;
  /** Width the Brain dock takes from its edge, in px; zero while it takes none. */
  brainDockReserved: number;
  /** The canvas's phase, published to everything inside the shell (`CanvasPhaseContext`)
   *  and to the stylesheet (`data-phase`). */
  phase: Omit<CanvasPhaseProviderProps, 'children'>;
  children: ReactNode;
}

/** The canvas's outermost box — every floating piece of chrome and the board are its children. */
export function CanvasShell({ shellRef, fullscreen, hosted, brainDockSide, brainDockReserved, phase, children }: CanvasShellProps) {
  // THE SHELL PUBLISHES THE PHASE, twice: to the stylesheet as `data-phase` (the lens ring,
  // the ghost card and the path card read `--canvas-phase-hue` off it) and to every piece of
  // chrome and surface inside it as `CanvasPhaseContext` — so nothing threads it as a prop.
  const left = brainDockSide === 'left' ? brainDockReserved : 0;
  const right = brainDockSide === 'right' ? brainDockReserved : 0;
  const insets = useMemo(() => ({ left, right }), [left, right]);
  return <CanvasPhaseProvider {...phase}><CanvasDockInsetsContext.Provider value={insets}><div
      ref={shellRef}
      className={`${styles.canvasShell} app-full-height`}
      data-fullscreen={fullscreen ? 'true' : 'false'}
      data-host={hosted ? 'editor' : undefined}
      data-phase={phase.phase}
      style={{
        // The dock owns one edge of the board; every other floating panel is pushed in
        // by exactly its width so nothing can ever sit underneath it.
        //
        // Declared on the SHELL rather than on the board, which is where it used to live:
        // the chrome now floats as a sibling of the board rather than inside it, so a
        // reservation that only the board could see would have let the session pill and
        // the command bar be the two things that DO sit underneath the dock.
        // The same two numbers reach flow-placed pieces as `CanvasDockInsetsContext`.
        '--brain-dock-left': `${left}px`,
        '--brain-dock-right': `${right}px`,
      } as CSSProperties}
    >{children}</div></CanvasDockInsetsContext.Provider></CanvasPhaseProvider>;
}
