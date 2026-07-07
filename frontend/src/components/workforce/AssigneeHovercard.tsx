'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import PersonalitySummary from '@/components/PersonalitySummary';
import { useAssigneeProfile } from './AssigneeProfilesContext';

/**
 * Wraps an assignee's name with a personality hovercard. Looks the profile up by the
 * SAME encoded select-value the picker uses (`u:<userId>` / `c:<agentRef>`) from the
 * shared {@link AssigneeProfilesProvider} — one cached fetch per board, no per-hover
 * N+1. When the assignee has no personality on file it renders the trigger untouched,
 * so callers can wrap EVERY assignee unconditionally.
 *
 * The popover is portalled to <body> so it is never clipped by a scrollable board
 * column, and positioned (below the trigger, flipping above / clamping horizontally
 * near the viewport edge) against the live trigger rect. Works on hover, keyboard
 * focus, and tap.
 */
const POPOVER_WIDTH = 280;
const GAP = 6;
const CLOSE_DELAY_MS = 120;

export default function AssigneeHovercard({
  selectValue,
  children,
}: {
  selectValue: string | null | undefined;
  children: ReactNode;
}) {
  const t = useTranslations('assigneeHovercard');
  const profile = useAssigneeProfile(selectValue);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'below' | 'above' } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  useEffect(() => { setMounted(true); }, []);

  const position = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer below; flip above when the lower half is too short (rough 220px card).
    const spaceBelow = vh - r.bottom;
    const placement: 'below' | 'above' = spaceBelow < 240 && r.top > spaceBelow ? 'above' : 'below';
    const left = Math.max(8, Math.min(r.left, vw - POPOVER_WIDTH - 8));
    const top = placement === 'below' ? r.bottom + GAP : r.top - GAP;
    setCoords({ top, left, placement });
  }, []);

  const show = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    position();
    setOpen(true);
  }, [position]);

  const hide = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);

  // Keep the popover glued to the trigger while open (scroll / resize).
  useEffect(() => {
    if (!open) return;
    const onMove = () => position();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, position]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // No personality → render the trigger exactly as given, nothing else.
  if (!profile) return <>{children}</>;

  const popoverStyle: CSSProperties = {
    position: 'fixed',
    top: coords?.top ?? -9999,
    left: coords?.left ?? -9999,
    transform: coords?.placement === 'above' ? 'translateY(-100%)' : undefined,
    zIndex: 2000,
    width: POPOVER_WIDTH,
    maxWidth: 'calc(100vw - 16px)',
    filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.18))',
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (open ? setOpen(false) : show()); }
    else if (e.key === 'Escape') setOpen(false);
  };

  // A span (role=button) rather than a <button> so it can wrap chips/avatars/links
  // without nesting interactive elements.
  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        aria-label={t('trigger', { name: profile.name })}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={onKeyDown}
        onClick={(e) => { e.stopPropagation(); (open ? setOpen(false) : show()); }}
        style={{
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
          gap: 4, maxWidth: '100%',
        }}
      >
        {children}
        <span aria-hidden style={{ fontSize: 10, opacity: 0.65, flexShrink: 0 }}>🧠</span>
      </span>

      {mounted && open && coords && createPortal(
        <div
          id={panelId}
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hide}
          style={popoverStyle}
        >
          <div
            style={{
              fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4,
              padding: '0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {t('subtitle', { name: profile.name })}
          </div>
          <PersonalitySummary profile={profile.psychometric} />
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Inline (non-hover) variant for surfaces that have room to show the personality
 * outright — e.g. the task drawer, where the assignee name is a click-to-edit control
 * that a hovercard can't wrap. Reads the SAME shared provider map by select-value and
 * self-hides when the assignee has no personality on file.
 */
export function AssigneePersonalityInline({ selectValue }: { selectValue: string | null | undefined }) {
  const profile = useAssigneeProfile(selectValue);
  if (!profile) return null;
  return <PersonalitySummary profile={profile.psychometric} />;
}
