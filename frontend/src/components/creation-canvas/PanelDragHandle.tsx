// No 'use client' directive: this component is only ever imported from `CreationCanvas.tsx`
// and `CanvasCommandBar.tsx`, both already inside that client boundary — see the same
// reasoning in `useChromeSpace.ts` and `CanvasCommandBar.tsx`'s own header.
import type { ButtonHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';

export interface PanelDragHandleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this panel currently sits away from the position its own layout would give
   *  it, so the handle's label can name the double-click/double-tap that puts it back. */
  isMoved: boolean;
}

/**
 * The grip a floating chrome card renders so a reader can drag it off its computed
 * position — one markup, one label, shared by every card that offers it (`usePanelDrag
 * Offset`) rather than re-typed per card, where the aria-label would drift out of the
 * catalogs for only some of them. Pass the hook's `handleProps` straight through.
 */
export function PanelDragHandle({ isMoved, className, ...buttonProps }: PanelDragHandleProps) {
  const t = useTranslations('creationCanvas');
  const label = isMoved ? t('dragHandleMoved') : t('dragHandle');
  return (
    <button
      type="button"
      data-testid="canvas-panel-drag-handle"
      className={className ? `${styles.dragHandle} ${className}` : styles.dragHandle}
      aria-label={label}
      title={label}
      {...buttonProps}
    >
      <Icon name="drag-handle" size={14} />
    </button>
  );
}
