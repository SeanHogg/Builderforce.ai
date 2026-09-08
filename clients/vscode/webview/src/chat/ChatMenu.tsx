/**
 * The chat header's small chrome: its glyphs, and the popover menu pattern its
 * controls share.
 *
 * Extracted from the chat surface for the reason every presentational piece is: they
 * hold no conversation state, they are the same in every placement, and leaving them
 * inline meant a reader looking for the transcript's logic scrolled through 90 lines
 * of SVG paths first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/* Toolbar glyphs — inline SVG so they render crisply in the editor's light AND dark
   themes, inheriting the surrounding button's colour. */
export const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
export const IconMic = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="6" y="2" width="4" height="7.5" rx="2" fill="currentColor" /><path d="M3.75 8a4.25 4.25 0 0 0 8.5 0M8 12.25V14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
);
export const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3.75M4.25 7.5 8 3.75l3.75 3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconBolt = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.2 1 3.4 8.6h3.4L6 15l6.2-8.1H8.6L9.2 1z" /></svg>
);
/* Rename = pencil glyph for editing the selected chat's title. */
export const IconRename = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.75 2.25 13.75 5.25 6 13H3v-3l7.75-7.75zM9.5 3.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/**
 * A small popover menu (the `+` and `/` composer affordances). Closes on outside
 * click or Escape. `children` is a render prop given a `close()` so an item can
 * dismiss the menu after acting. Shared by both composer menus (DRY).
 */
export function PopoverMenu({
  trigger, title, align = 'left', triggerClassName, children,
}: {
  trigger: React.ReactNode;
  title: string;
  align?: 'left' | 'right';
  /** Override the trigger's class (defaults to the square icon button). */
  triggerClassName?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="bf-menu" ref={ref}>
      <button
        type="button"
        className={`${triggerClassName ?? 'bf-iconbtn'}${open ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        aria-label={title}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`bf-menu__pop bf-menu__pop--${align}`} role="menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * One row in a {@link PopoverMenu}. `active` shows a trailing check. `desc` adds a
 * second, muted line explaining what the row actually DOES — the Effort levels and
 * the Thinking toggle use it, because "Quick / Balanced / Thorough" on their own
 * told the user nothing about the real effect (answer budget, thinking budget).
 */
export function MenuItem({ icon, label, desc, hint, active, onClick }: {
  icon: React.ReactNode; label: string; desc?: string; hint?: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`bf-menu__item${active ? ' is-active' : ''}${desc ? ' bf-menu__item--stacked' : ''}`}
      onClick={onClick}
    >
      <span className="bf-menu__ico" aria-hidden="true">{icon}</span>
      <span className="bf-menu__lbl">
        {label}
        {desc != null && <span className="bf-menu__desc">{desc}</span>}
      </span>
      {hint != null && <span className="bf-menu__hint">{hint}</span>}
      <span className="bf-menu__check" aria-hidden="true">{active ? '✓' : ''}</span>
    </button>
  );
}
