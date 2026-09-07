'use client';

/**
 * PanelCloseButton — the one way out of a slide-out panel.
 *
 * CONVENTION (app-wide): the dismiss control lives at the TOP RIGHT of a
 * panel header, outermost in the trailing group, nearest the edge the drawer
 * docks to. It is chrome around the panel rather than an action inside it, so
 * it sits after every header action; and a right-docked drawer's own edge is
 * where a reader's hand already is when they want out of it.
 *
 * Self-contained on purpose: it owns its label (`common.closePanel`), its icon
 * and its styling, so a panel adds a compliant escape hatch with one element
 * and no call site can drift the size, hue or wording. Pass `label` only when
 * a panel genuinely names what is being closed for a screen reader.
 */

import { useTranslations } from 'next-intl';

export function PanelCloseButton({ onClose, label }: { onClose: () => void; label?: string }) {
  const tCommon = useTranslations('common');
  return (
    <button
      type="button"
      className="panel-close-button"
      onClick={onClose}
      aria-label={label ?? tCommon('closePanel')}
    >
      <svg viewBox="0 0 24 24" aria-hidden focusable="false">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
