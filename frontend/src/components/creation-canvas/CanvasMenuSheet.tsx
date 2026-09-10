'use client';

import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';

/**
 * A BAR SHEET — the popover the bottom bar opens, and the ONE way out of it.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * The bar's sheets could trap you. Both were dismissed only by pressing the
 * button that opened them again or by choosing a row that happened to close
 * them — and the ••• board sheet is mostly rows that deliberately do NOT close:
 * the view trough is a set you press repeatedly (a menu that shuts under the
 * second zoom is a menu you cannot zoom with), and the four connector controls
 * are `<select>`s you come back to. So a person who opened the sheet to change a
 * line style had nothing in front of them that said "done", and the button that
 * would have closed it was underneath the sheet they were looking at.
 *
 * A sheet is responsible for being closable. That is why the close control lives
 * HERE and not in either caller: two sheets on one bar cannot end up with two
 * different ideas of how you leave, and a third sheet gets the behaviour by
 * being a sheet rather than by remembering to add it.
 *
 * ── WHAT IT OWNS ──────────────────────────────────────────────────────────────
 * Its own header, its own close button, and its own Escape. The Escape listener
 * is registered on `document` in the CAPTURE phase, so it runs ahead of the
 * board's own `window` keydown handler and stops there: without that, one press
 * would close the sheet AND clear the board's selection, which is two undos for
 * one keystroke. It is registered only while the sheet is mounted, so a board
 * with no sheet open keeps Escape's ordinary meaning.
 *
 * It takes the sheet's NAME rather than a close label: the accessible name of
 * the button is derived from it, so a caller cannot ship a sheet whose close
 * button says something other than what it closes.
 *
 * ── WHY NOT `PanelCloseButton` ────────────────────────────────────────────────
 * That primitive is the one way out of a SLIDE-OUT PANEL, and it is right there:
 * same corner, same job. It is not reused here because it is drawn in the
 * SHELL's palette (`--bg-base`, `--border-subtle`, `--text-secondary`) at 36px,
 * and this sheet is on the board, which declares its own `--canvas-*` family and
 * sets its rows in 11px. Borrowing it would put a control the shell's colour and
 * half again the height of everything around it inside a 250px sheet — the same
 * mismatch the canvas palette exists to prevent. The convention it carries is
 * the part worth keeping, and this honours it: dismiss lives at the top right,
 * in one place, for every sheet.
 */
export interface CanvasMenuSheetProps {
  /** Accessible name of the sheet, and the noun its close button is built from. */
  title: string;
  testId: string;
  onClose: () => void;
  /** `menu` where every child is a command; omitted where the sheet holds controls. */
  role?: 'menu';
  children: ReactNode;
}

export function CanvasMenuSheet({ title, testId, onClose, role, children }: CanvasMenuSheetProps) {
  const t = useTranslations('creationCanvas');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Capture phase + stopPropagation: the board clears its selection on Escape
      // from a window listener, and closing a sheet must not also do that.
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div className={styles.moreMenu} data-testid={testId} aria-label={title} {...(role ? { role } : {})}>
      <div className={styles.moreMenuSheetHeader}>
        <span className={styles.moreMenuSheetTitle}>{title}</span>
        <button
          type="button"
          data-testid={`${testId}-close`}
          onClick={onClose}
          aria-label={t('closeMenu', { name: title })}
          title={t('closeMenu', { name: title })}
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      {children}
    </div>
  );
}
