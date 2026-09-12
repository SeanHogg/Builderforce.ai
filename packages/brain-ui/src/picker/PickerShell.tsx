import React from 'react';
import { usePopover } from '../popover/usePopover';

/**
 * The composer's "who" pill — the shared shell of the recipient ("To") and persona
 * ("Acting as") pickers: an eyebrow, a leading mark, the current name, and a popover
 * of choices that reuses the `/` menu's rows.
 *
 * The leading mark sits OUTSIDE the trigger button so a host can make it interactive
 * in its own right — the web wraps the recipient's avatar in a personality hovercard —
 * without nesting one control inside another.
 */
export function PickerShell({
  eyebrow,
  leading,
  name,
  title,
  active = false,
  disabled = false,
  children,
}: {
  eyebrow: string;
  leading?: React.ReactNode;
  name: string;
  /** Names the control (tooltip, accessible name, popover heading). */
  title: string;
  /** The pill is set to something other than its default. */
  active?: boolean;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const { open, toggle, close, rootRef } = usePopover<HTMLDivElement>();
  return (
    <div ref={rootRef} className={`bf-picker${active ? ' is-active' : ''}${open ? ' is-open' : ''}`}>
      <span className="bf-picker__eyebrow" aria-hidden="true">{eyebrow}</span>
      {leading != null && <span className="bf-picker__lead">{leading}</span>}
      <button
        type="button"
        className="bf-picker__btn"
        disabled={disabled}
        title={title}
        aria-label={`${title}: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="bf-picker__name">{name}</span>
        <span className="bf-picker__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="bf-pmenu__pop" role="menu" aria-label={title}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** One radio row in a picker popover — the `/` menu's row metrics. */
export function PickerItem({ icon, label, hint, active = false, onClick }: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`bf-pmenu__item${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <span className="bf-pmenu__ico" aria-hidden="true">{icon}</span>
      <span className="bf-pmenu__lbl">{label}</span>
      {hint != null && <span className="bf-pmenu__hint">{hint}</span>}
      <span className="bf-pmenu__check" aria-hidden="true">{active ? '✓' : ''}</span>
    </button>
  );
}

/** The BRAIN's mark — "runs it". Inline SVG so it inherits the text colour in any theme. */
export const IconBolt = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.2 1 3.4 8.6h3.4L6 15l6.2-8.1H8.6L9.2 1z" /></svg>
);
