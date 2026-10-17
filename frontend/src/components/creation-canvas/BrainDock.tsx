import type { CSSProperties, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePointerResize } from '@/lib/usePointerResize';
import { SurfaceHeader } from '@seanhogg/builderforce-brain-ui';
import styles from './CreationCanvas.module.css';
import { BrainSurface, type BrainSurfaceBodyProps } from './BrainSurface';
import { BrainSurfaceActions } from './BrainSurfaceActions';
import { BrainSurfaceViewProvider } from './brainSurfaceView';
import {
  BRAIN_DOCK_MAX_WIDTH,
  BRAIN_DOCK_MIN_WIDTH,
  clampBrainDockWidth,
  type BrainDockMode,
  type BrainDockSide,
  type BrainDockSize,
} from './brainDockPreferences';

/**
 * The EDGE placement of the ONE Brain surface on the Canvas (the body is `BrainSurface`).
 *
 * The Canvas used to show a transcript inside the Brain Object, a second transcript
 * in the details panel, and a floating prompt at the bottom; people could not tell
 * which one they were talking to. The conversation, what Brain is doing right now,
 * what the turn cost, and its connected work were consolidated into one surface.
 *
 * That surface has three placements, and all render the SAME body (`BrainSurface`):
 *   - docked  (`BrainDock`)  — a full-height panel on the left or right edge
 *   - inline  (the Brain Object on the graph, `BrainObjectBody`)
 *   - the Chat lens (`CanvasChatSurface`) — the conversation as the whole canvas
 *
 * There is no small floating card any more. A card hovering over a board that
 * already carries a Brain Object put two live transcripts of one conversation on
 * screen at once — the very confusion this consolidation exists to remove. When the
 * surface is small it is now simply the Object, where Brain's connections already are.
 *
 * The prompt is not OWNED here — it belongs to the canvas, which keeps it in the centre
 * of the page where every chat product people already use puts it. But it has a docked
 * placement (`lib/canvasPromptPlacement.ts`), and when the reader chooses that, this panel
 * RENDERS it as the last row of its own column: header, transcript, prompt.
 *
 * It used to be docked by being drawn as a separate floating card underneath this panel,
 * with the panel shortened by the card's measured height to make room. Two absolutely
 * positioned boxes claiming one edge is not a column — it read as a prompt that had fallen
 * out of the bottom of the chat, with its own header, its own border and its own copy of
 * the activity line the panel was already showing. Passing the node in costs one prop and
 * makes the docked placement what it says it is.
 *
 * The copyright/version/Terms/Privacy row (`LegalStrip`) lives ONLY in the sidebar rail
 * (`Sidebar`) now, on every route including a stage route — this panel used to carry its
 * own copy as a footer here, which put the same row in two places depending on whether the
 * reader was on a stage route. One row, one home.
 */

/** How far one arrow-key press resizes the surface. */
const RESIZE_STEP = 24;

export interface BrainDockProps extends BrainSurfaceBodyProps {
  /**
   * The canvas prompt, when the reader has docked it into this panel. Absent while it
   * floats over the board, is closed, or has nowhere else to be — the canvas decides,
   * and this panel only gives it the last row of the column.
   */
  composer?: ReactNode;
  /** Move the prompt back out onto the board. Passed only when the prompt is in here,
   *  which is the only state in which this panel is the one thing that can release it. */
  onUndockPrompt?: () => void;
  mode: BrainDockMode;
  side: BrainDockSide;
  size: BrainDockSize;
  /** Current rendered width in px, preset or dragged. */
  width: number;
  onModeChange: (mode: BrainDockMode) => void;
  onSideChange: (side: BrainDockSide) => void;
  onSizeChange: (size: BrainDockSize) => void;
  /** commit=false during a drag (live reflow only); true when the user settles. */
  onWidthChange: (width: number, commit: boolean) => void;
  onExecutionDetailChange: (show: boolean) => void;
  onClose: () => void;
}

/** The edge placement: a full-height panel the board reserves width for. */
export function BrainDock({
  mode, side, size, width, composer, onUndockPrompt,
  onModeChange, onSideChange, onSizeChange, onWidthChange, onExecutionDetailChange, onClose,
  ...conversation
}: BrainDockProps) {
  const t = useTranslations('creationCanvas');

  // Dragging the inner edge. The delta is inverted for a right-hand surface, where
  // pulling left makes it wider. Only the settled width is persisted, so a drag
  // does not write localStorage (or a preference signal) on every pointer move.
  const resize = usePointerResize({
    axis: 'x',
    value: width,
    step: RESIZE_STEP,
    invert: side === 'right',
    clamp: clampBrainDockWidth,
    onChange: onWidthChange,
  });

  return (
    <BrainSurfaceViewProvider>
      {/* THE VEIL, and its limits. On a phone this panel is a SHEET over the surface, so
          something has to say the surface behind it is not the live thing — and tapping
          away has to dismiss, which is the gesture a bottom sheet already teaches.

          It stops at `--canvas-top-chrome-space` and at `--composer-space`, both measured:
          the canvas app bar, the surface strip and the composer stay LIVE underneath it,
          so a reader who opened the conversation can still leave the canvas, change
          surface or type without dismissing it first. `display:none` on a desktop, where
          this is a docked rail BESIDE the board and veils nothing. */}
      <button
        type="button"
        className={styles.canvasSheetVeil}
        data-testid="canvas-brain-veil"
        // NOT the header's "Close Brain chat". Three controls dismissing one sheet may
        // not share one accessible name — a screen-reader user tabbing the sheet would
        // hear the same button three times with nothing saying which is which.
        aria-label={t('brainSheet.veil')}
        onClick={onClose}
      />
      <aside
        className={styles.brainDock}
        data-mode={mode}
        data-side={side}
        data-size={size}
        style={{ '--brain-dock-size': `${width}px` } as CSSProperties}
        aria-label={t('brainDock')}
      >
      {/* The sheet's own grabber — 24px of ink in a 44px hit area, because the bar IS
          the affordance and the target has to be a thumb's. It closes: a phone sheet
          between two measured edges has one size, so there is nothing for a drag to
          resize and "pull it down" is the only thing the gesture can mean. */}
      <button
        type="button"
        className={styles.brainDockGrabber}
        data-testid="canvas-brain-grabber"
        aria-label={t('brainSheet.grabber')}
        title={t('brainSheet.grabber')}
        onClick={onClose}
      ><span aria-hidden /></button>
      <div
        className={styles.brainDockResizer}
        data-side={side}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resizeBrain')}
        aria-valuenow={width}
        aria-valuemin={BRAIN_DOCK_MIN_WIDTH}
        aria-valuemax={BRAIN_DOCK_MAX_WIDTH}
        tabIndex={0}
        {...resize}
      />
      {/* The ONE body. The prompt, when docked, is the footer's last row — in normal flow,
          so the transcript above it flexes to whatever is left and the panel can never
          paint over the box you type in. */}
      <BrainSurface
        {...conversation}
        header={<SurfaceHeader
          className={styles.brainDockHeader}
          title={t('brain')}
          running={conversation.running}
          actions={<BrainSurfaceActions
            mode={mode}
            side={side}
            size={size}
            showExecutionDetail={conversation.showExecutionDetail}
            onModeChange={onModeChange}
            onSideChange={onSideChange}
            onSizeChange={onSizeChange}
            onExecutionDetailChange={onExecutionDetailChange}
            onClose={onClose}
            {...(composer && onUndockPrompt ? { onUndockPrompt } : {})}
          />}
        />}
        composer={composer}
      />
      </aside>
    </BrainSurfaceViewProvider>
  );
}

