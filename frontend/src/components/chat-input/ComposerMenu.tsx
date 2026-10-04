import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { iconButtonStyle, menuPopStyle } from './composerStyles';

/**
 * A popover menu anchored to a composer icon button. Opens upward (the composer
 * sits at the bottom of the panel). Closes on outside click or Escape. Shared by
 * the `+` (add) and `/` (options) affordances — DRY.
 */
export function ComposerMenu({ trigger, title, disabled, children }: {
  trigger: ReactNode;
  title: string;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const base = iconButtonStyle(disabled);
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ ...base, background: open ? 'var(--surface-interactive, var(--bg-elevated))' : base.background }}
      >
        {trigger}
      </button>
      {open && <div role="menu" style={menuPopStyle}>{children(close)}</div>}
    </div>
  );
}

/** One row in a {@link ComposerMenu}: icon + label, optional hint/active check. */
export function MenuRow({ icon, label, hint, active, onClick }: {
  icon: ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    padding: '8px 9px',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    background: hover ? 'var(--surface-interactive, var(--bg-base))' : 'transparent',
    color: 'var(--text-primary)',
    fontSize: 'var(--font-size-small)',
    textAlign: 'left',
    cursor: 'pointer',
    textDecoration: 'none',
  };
  const body = (
    <>
      <span aria-hidden style={{ width: 18, textAlign: 'center', flexShrink: 0 }}><Icon source={icon} size={18} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {hint != null && <span style={{ fontSize: 'var(--font-size-field-label)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{hint}</span>}
      {active && <span aria-hidden style={{ color: 'var(--coral-bright)', width: 12 }}><Icon name="check" size={14} /></span>}
    </>
  );
  const shared = { style, role: 'menuitem' as const, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };
  return <button type="button" onClick={onClick} {...shared}>{body}</button>;
}
