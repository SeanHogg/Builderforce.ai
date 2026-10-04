import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { BrainDockSide } from '../brainDockPreferences';
import styles from '../CreationCanvas.module.css';

export interface CanvasShellProps {
  shellRef: RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  /** An embedding host (VS Code) supplies surfaces — keep the desktop chrome at any width. */
  hosted: boolean;
  brainDockSide: BrainDockSide;
  /** Width the Brain dock takes from its edge, in px; zero while it takes none. */
  brainDockReserved: number;
  children: ReactNode;
}

/** The canvas's outermost box — every floating piece of chrome and the board are its children. */
export function CanvasShell({ shellRef, fullscreen, hosted, brainDockSide, brainDockReserved, children }: CanvasShellProps) {
  return <div
      ref={shellRef}
      className={`${styles.canvasShell} app-full-height`}
      data-fullscreen={fullscreen ? 'true' : 'false'}
      data-host={hosted ? 'editor' : undefined}
      style={{
        // The dock owns one edge of the board; every other floating panel is pushed in
        // by exactly its width so nothing can ever sit underneath it.
        //
        // Declared on the SHELL rather than on the board, which is where it used to live:
        // the chrome now floats as a sibling of the board rather than inside it, so a
        // reservation that only the board could see would have let the session pill and
        // the command bar be the two things that DO sit underneath the dock.
        '--brain-dock-left': `${brainDockSide === 'left' ? brainDockReserved : 0}px`,
        '--brain-dock-right': `${brainDockSide === 'right' ? brainDockReserved : 0}px`,
      } as CSSProperties}
    >{children}</div>;
}
