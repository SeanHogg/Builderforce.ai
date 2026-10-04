import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { MoreActionsIcon } from '@/components/canvas/CanvasCommands';
import { CanvasMenuSheet } from '../CanvasMenuSheet';
import { CanvasBoardMenuBody, type CanvasBoardMenuBodyProps, type CanvasDockPanel } from '../CanvasBoardMenuBody';
import type { CanvasGesture } from '../canvasPointerMode';
import styles from '../CreationCanvas.module.css';

export interface CanvasBoardMenuProps {
  open: boolean;
  /** Opens or closes the sheet, closing the invite sheet and Make it real. */
  onToggle: () => void;
  onClose: () => void;
  /** A phone hosts this in its app bar, where the sheet is full width. */
  phoneViewport: boolean;
  showsBoard: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onArrange: () => void;
  minimapOpen: boolean;
  setMinimapOpen: Dispatch<SetStateAction<boolean>>;
  gesture: CanvasGesture;
  setGesture: Dispatch<SetStateAction<CanvasGesture>>;
  threeD: CanvasBoardMenuBodyProps['view']['threeD'];
  dockPanel: CanvasDockPanel | null;
  toggleDockPanel: (panel: CanvasDockPanel) => void;
  allowPanel: (source: string) => boolean;
  onTemplates: () => void;
  setConversationOpen: Dispatch<SetStateAction<boolean>>;
  onHistory: () => void;
  onTutorial: () => void;
  showHidden: boolean;
  setShowHidden: Dispatch<SetStateAction<boolean>>;
  onBranch: () => void;
  /** Absent on a board that is not a branch. */
  onMerge?: () => void;
  connectors: CanvasBoardMenuBodyProps['connectors'];
  /** The template browser, which anchors against this same group. */
  children?: ReactNode;
}

/**
 * THE BOARD MENU — the ••• trigger and its sheet, wherever that sheet is hosted.
 *
 * Everything in it is done to the BOARD rather than to the work: how you are looking
 * at it, what it is made of, where its history went. That is why the group it hangs
 * under on the desktop bar has a caption of its own instead of a stage's — a control
 * that answers no stage's question must not be given a stage's name, which is how the
 * old `Tools` shelf formed. The body itself, and the reasoning for what is in it, is
 * `CanvasBoardMenuBody`.
 *
 * ── ONE HOST AT A TIME ──────────────────────────────────────────────────────────
 * On a desktop it is contributed to the command bar's `Board` group. A phone does not
 * draw that bar, so this whole node is handed to the canvas app bar instead. Passed to
 * exactly one of the two (`phoneViewport`), never rendered in both and hidden in one:
 * `display:none` would leave two ••• buttons and two sheets in one document.
 */
export function CanvasBoardMenu({
  open, onToggle, onClose, phoneViewport, showsBoard, onZoomIn, onZoomOut, onFit, onArrange, minimapOpen, setMinimapOpen,
  gesture, setGesture, threeD, dockPanel, toggleDockPanel, allowPanel, onTemplates, setConversationOpen, onHistory, onTutorial,
  showHidden, setShowHidden, onBranch, onMerge, connectors, children,
}: CanvasBoardMenuProps) {
  const t = useTranslations('creationCanvas');
  return (
      <span className={styles.handoffGroup} data-testid="canvas-board-menu">
          <button type="button" className={styles.sessionActionButton} aria-expanded={open} aria-haspopup="menu" aria-label={t('moreActions')} title={t('moreActions')} onClick={onToggle}><MoreActionsIcon /></button>
          {/* NO SAVE BUTTON HERE: a guest board is kept by taking an account, and the
              header's CTA already becomes "Keep your work" the moment this browser holds
              a local board. The pill SAYS where the board lives; saying it is not the
              same as offering it twice. */}
          {open && <CanvasMenuSheet
            title={t('moreActions')}
            testId="canvas-more-menu"
            // The SAME node, two hosts: anchored above the command bar's ••• on a
            // desktop, and a full-width sheet under the canvas app bar on a phone —
            // where "above the button that opened me" would be off the top of the
            // screen, because that button is in the top bar rather than the bottom one.
            placement={phoneViewport ? 'sheet' : 'popover'}
            onClose={onClose}
          >
            {/* ONE body, two hosts — `CanvasBoardMenuBody`. Its phone-only session-action
                section is gone: it carried what a 360px command bar could not fit, and
                that bar is not drawn at this width any more. */}
            <CanvasBoardMenuBody
              showsBoard={showsBoard}
              view={{
                onZoomIn,
                onZoomOut,
                onFit,
                onArrange,
                minimapOpen,
                onToggleMinimap: () => setMinimapOpen((value) => !value),
                marquee: gesture === 'select',
                onToggleGesture: () => setGesture((current) => (current === 'select' ? 'pan' : 'select')),
                threeD,
              }}
              panels={{ open: dockPanel, onToggle: toggleDockPanel, allow: allowPanel }}
              create={{
                onTemplates,
                onConversation: () => setConversationOpen((value) => !value),
              }}
              session={{
                onHistory,
                onTutorial,
                hiddenShown: showHidden,
                onToggleHidden: () => setShowHidden((value) => !value),
                onBranch,
                ...(onMerge ? { onMerge } : {}),
              }}
              connectors={connectors}
              onDismiss={onClose}
            />
          </CanvasMenuSheet>}
          {children}
      </span>
  );
}
