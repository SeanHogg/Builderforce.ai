'use client';

import { useRef, useState, type ReactNode } from 'react';
import { AnchoredPopover } from './AnchoredPopover';
import { Button, type ButtonSize, type ButtonVariant } from './Button';

/**
 * Primary action + a caret that opens a small menu — one control, not two
 * buttons a caller wires up by hand. Extracted after "Add agent" (Workforce)
 * and "New canvas" (the session sidebar) both needed exactly this and had
 * started to disagree on it; `WorkforceAgents.tsx` now uses this too instead
 * of its own inline split-button styles.
 *
 * The menu is an {@link AnchoredPopover} — a portal, not `position:absolute`
 * inside the caller — so it still opens correctly from a narrow, scrollable
 * rail like the sidebar.
 */
export interface SplitButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  primaryLabel: ReactNode;
  onPrimary: () => void;
  menuAriaLabel: string;
  /** Menu content; receives `close` so an item can dismiss the menu once it acts. */
  renderMenu: (close: () => void) => ReactNode;
  /**
   * Wrap ONLY the primary button — e.g. `(button) => <RoleGate capability="x">{button}</RoleGate>`.
   * The caret and its menu stay outside this wrapper deliberately: a role gate that
   * disables the primary create action should not also swallow clicks on an
   * unrelated "manage/organize" menu next to it.
   */
  primaryWrapper?: (button: ReactNode) => ReactNode;
}

export function SplitButton({
  variant = 'primary',
  size,
  block = false,
  loading = false,
  disabled = false,
  primaryLabel,
  onPrimary,
  menuAriaLabel,
  renderMenu,
  primaryWrapper = (button) => button,
}: SplitButtonProps) {
  const caretRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const caretClass = ['ui-button', `ui-button--${variant}`, size && size !== 'md' ? `ui-button--${size}` : '', 'ui-button-group__caret']
    .filter(Boolean).join(' ');

  return (
    <div className={`ui-button-group${block ? ' ui-button-group--block' : ''}`}>
      {primaryWrapper(
        <Button
          type="button"
          variant={variant}
          size={size}
          loading={loading}
          disabled={disabled}
          className="ui-button-group__main"
          onClick={onPrimary}
        >
          {primaryLabel}
        </Button>,
      )}
      <button
        ref={caretRef}
        type="button"
        className={caretClass}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-label={menuAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {/* No wrapper div here on purpose: some menus are a plain item list (opt
          into the shared `.ui-button-group__menu` chrome class themselves),
          others are a self-chromed popover with its own role — SplitButton
          imposes neither. */}
      <AnchoredPopover open={open} anchorRef={caretRef} onDismiss={close} placement="below" align="end" gap={6}>
        {renderMenu(close)}
      </AnchoredPopover>
    </div>
  );
}
