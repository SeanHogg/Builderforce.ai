'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';
import { BrainSurfaceActions, BrainSurfaceBody, type BrainSurfaceBodyProps } from './BrainDock';

/**
 * The conversation as the whole canvas — the zero-object case of the board.
 *
 * ── WHY THIS IS A SURFACE AND NOT A PAGE ─────────────────────────────────────────
 * Someone arriving with a question lands on a board offering ~95 object kinds, which is
 * a hostile first screen for "what does this error mean?". The obvious fix — a separate
 * /chat page — would fork the product: a second transcript, a second composer, a second
 * model control, and a conversation that can never become anything. So chat is the same
 * canvas with the board stood down. Nothing is duplicated, and the board is one press
 * away the moment the conversation produces something worth keeping.
 *
 * That is the whole point of the placement: the surface GRADUATES. Objects Brain
 * materialises during a chat land on the board behind it, and the footer says so with a
 * live count — so "just asking" turns into "I have a board" without a migration, an
 * import, or a decision made up front.
 *
 * ── WHAT IS DELIBERATELY NOT IN HERE ─────────────────────────────────────────────
 * The transcript is `BrainSurfaceBody`, verbatim — the SAME component the edge dock and
 * the inline Brain Object render. A third copy of the chat is the one thing this
 * placement must never become. The prompt is not in here either: it is the canvas
 * composer, centred and bottom-aligned at the board level, which is where it already
 * sits in every placement and where every chat product people know puts it.
 */

export interface CanvasChatSurfaceProps extends BrainSurfaceBodyProps {
  onExecutionDetailChange: (show: boolean) => void;
  /** Hand the board back. Also what the header's dismiss does — closing the
   *  conversation when it IS the page can only mean "show me the board". */
  onOpenBoard: () => void;
  /** Objects already on the board behind this conversation. */
  objectCount: number;
}

export function CanvasChatSurface({
  onExecutionDetailChange, onOpenBoard, objectCount, ...body
}: CanvasChatSurfaceProps) {
  const t = useTranslations('creationCanvas');

  return (
    <section className={styles.chatSurface} aria-label={t('surface.chat.label')} data-testid="canvas-chat-surface">
      <header className={styles.chatSurfaceHeader}>
        <span className={styles.brainDockMark} aria-hidden><Icon source="✦" size="1em" /></span>
        <strong>{t('brain')}</strong>
        {/* The shared controls decide for themselves which of them apply here, so this
            placement gets the execution-detail toggle and nothing else: the placement
            control reads the active surface and stands down (no board on screen to move
            into), and no `onClose` is supplied because dismissing a conversation that IS
            the page would leave nothing behind. The way out is the footer, and the
            surface switcher on the rail. */}
        <BrainSurfaceActions
          mode="docked"
          showExecutionDetail={body.showExecutionDetail}
          onModeChange={() => { /* placement is not offered while chat is the surface */ }}
          onExecutionDetailChange={onExecutionDetailChange}
        />
      </header>
      <div className={styles.chatSurfaceBody}>
        <BrainSurfaceBody {...body} />
      </div>
      <footer className={styles.chatSurfaceFooter}>
        <button type="button" onClick={onOpenBoard}>
          <span aria-hidden><Icon source="◰" size="1em" /></span>
          {t('surface.chat.openBoard', { count: objectCount })}
        </button>
      </footer>
    </section>
  );
}
