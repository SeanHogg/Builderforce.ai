'use client';

/**
 * SlideOutPanel — the canonical overlay for the app.
 *
 * CONVENTION (app-wide): a centered modal dialog is reserved for TERMINAL /
 * DESTRUCTIVE approvals only — irreversible confirmations like "Delete", "Remove",
 * "Disconnect", "Cancel subscription". EVERYTHING ELSE (forms, editors, detail
 * views, creation flows, settings, pickers) uses this slide-out side panel: it
 * adapts to mobile far better than a modal, doesn't trap the viewport, and keeps
 * the underlying context visible. When you reach for a modal, ask "is this a
 * terminal destructive approval?" — if not, use SlideOutPanel.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  PanelWidthControl,
  resolvePanelWidth as resolveWidth,
  usePanelWidth,
  type PanelWidth,
} from './panelWidthControl';

export type { PanelWidth };

export interface SlideOutPanelTab {
  id: string;
  label: string;
}

export interface SlideOutPanelProps {
  open: boolean;
  onClose: () => void;
  /** Panel title (optional). */
  title?: React.ReactNode;
  /**
   * Where this panel sits — rendered above the title in mono, small, muted.
   * A panel over a board has no page breadcrumb of its own, so it carries one.
   */
  crumb?: React.ReactNode;
  /**
   * The panel's INDEX COLUMN (§3.4). A destination's sub-views become a vertical
   * list down the panel's left edge rather than a horizontal tab bar — fourteen
   * items fit vertically and a tab bar cannot hold them.
   */
  index?: React.ReactNode;
  /** Optional tabs; when provided, activeTabId and onTabChange control which tab is active. */
  tabs?: SlideOutPanelTab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  /**
   * Rendered between the title block and `headerActions`, taking the header's
   * remaining width — e.g. the founder's-journey stage switcher. The title
   * block stops stretching to fill the header when this is present, so the
   * two share the row instead of the switcher being squeezed to its content.
   */
  headerCenter?: React.ReactNode;
  /** Header actions (e.g. buttons) rendered after title. */
  headerActions?: React.ReactNode;
  /** Main content. */
  children: React.ReactNode;
  /** One of the three named widths, or a raw CSS length for an unported surface. */
  width?: PanelWidth | string;
  /**
   * Turns on the reader's width control and names where the choice is kept.
   * Omit it and the panel keeps exactly the width the caller asked for — which
   * is right for a short confirmation sheet, and wrong for a destination.
   */
  widthStorageKey?: string;
  /**
   * A CSS custom-property NAME (e.g. `--seat-security`) to tint this panel with.
   *
   * The panel's owner is a fact the panel already has and the reader does not:
   * a rule along the header in the owning seat's hue is how "this is Security's
   * page" is said without a sentence. A variable name rather than a colour so a
   * call site cannot introduce a twelfth hue — `lib/seats.ts` owns the palette.
   */
  accentVar?: string;
  /** Which edge the drawer docks to. Default 'right'. Use 'left' when the Brain
   *  (which is right-docked) needs a companion work panel on the opposite side. */
  side?: 'left' | 'right';
  /**
   * Base stacking order (the overlay sits here, the drawer one above). Default 9998
   * clears the app chrome. Raise it only to stack a panel ABOVE another overlay that
   * already claims a higher layer — e.g. the board's ticket drawer sits at 10002/3,
   * so a panel opened from inside it would otherwise render underneath.
   */
  zIndex?: number;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
};

export function SlideOutPanel({
  open,
  onClose,
  title,
  crumb,
  index,
  tabs,
  activeTabId,
  onTabChange,
  headerCenter,
  headerActions,
  children,
  width = 'sheet',
  widthStorageKey,
  accentVar,
  side = 'right',
  zIndex = 9998,
}: SlideOutPanelProps) {
  const tCommon = useTranslations('common');
  const { effectiveWidth, showControl: showWidthControl, chooseWidth } = usePanelWidth(widthStorageKey, width);
  // Portal to <body> so the fixed drawer escapes ancestor stacking contexts
  // (e.g. the app `.shell` has `position: relative; z-index: 1`, which would
  // otherwise trap the drawer below the fixed footer regardless of its z-index).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // §2.5: "Closes on `Esc` and on scrim click." The scrim was always here; Esc
  // was not, so a keyboard user could open a panel they could not dismiss.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div
        className="slide-panel-overlay"
        role="presentation"
        onClick={onClose}
        style={{ ...overlayStyle, zIndex }}
        aria-hidden
      />
      <div
        className="slide-panel-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : tCommon('panel')}
        style={{
          position: 'fixed',
          top: 0,
          ...(side === 'left' ? { left: 0 } : { right: 0 }),
          bottom: 0,
          width: resolveWidth(effectiveWidth),
          maxWidth: '100%',
          ...(side === 'left'
            ? { borderRight: '1px solid var(--border-subtle)', boxShadow: '8px 0 24px rgba(0,0,0,0.2)' }
            : { borderLeft: '1px solid var(--border-subtle)', boxShadow: '-8px 0 24px rgba(0,0,0,0.2)' }),
          zIndex: zIndex + 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {(title != null || headerActions != null) && (
          <div
            className="slide-panel-header"
            style={{
              borderBottom: '1px solid var(--border-subtle)',
              // The owning seat's hue as a rule along the top of the header —
              // the one place a panel can say WHOSE page this is without
              // spending a line of copy on it.
              ...(accentVar ? { borderTop: `2px solid var(${accentVar})` } : null),
              flexShrink: 0,
            }}
          >
            <div className="slide-panel-header__row">
              <div className="slide-panel-header__lead">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={tCommon('closePanel')}
                  style={{
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-base)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                {(title != null || crumb != null) && (
                  <div style={{ minWidth: 0 }}>
                    {crumb != null && (
                      <div className="ui-eyebrow" style={{ color: accentVar ? `var(${accentVar})` : 'var(--text-muted)' }}>{crumb}</div>
                    )}
                    {title != null && (
                      <div style={{ fontWeight: 700, fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>{title}</div>
                    )}
                  </div>
                )}
              </div>
              {/* The founder's-journey stage switcher (or any page's own
                  header-center control) — centered in the header row via the
                  grid's equal `1fr` lead/trail tracks, at every panel width
                  down to `slide-panel-header`'s own narrow breakpoint, where
                  it drops to its own centered row instead (globals.css). */}
              {headerCenter != null && (
                <div className="slide-panel-header__center">{headerCenter}</div>
              )}
              <div className="slide-panel-header__trail">
                {/* Before the width control: an action (e.g. the project
                    switcher) is something to use, the resize control is
                    chrome around the panel itself — chrome sits outermost,
                    nearest the edge. */}
                {headerActions}
                {/* The reader's escape hatch — the thing a full-screen page
                    used to be. Widening never navigates and never remounts
                    the stage. */}
                {showWidthControl && (
                  <PanelWidthControl value={effectiveWidth as PanelWidth} onChange={chooseWidth} />
                )}
              </div>
            </div>
          </div>
        )}
        {tabs != null && tabs.length > 0 && (
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              overflowX: 'auto',
            }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange?.(t.id)}
                style={{
                  padding: '10px 16px',
                  fontSize: 'var(--font-size-small)',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: `2px solid ${activeTabId === t.id ? 'var(--coral-bright)' : 'transparent'}`,
                  color: activeTabId === t.id ? 'var(--coral-bright)' : 'var(--text-muted)',
                  fontWeight: activeTabId === t.id ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {/* Index column beside the body, not above it — §3.4. Fourteen sub-views
            fit down the left edge; a horizontal bar cannot hold them. That holds
            at `wide`/`full`, but `sheet` (or any width on a phone) narrows this
            row below the point a fixed-width column and a body can coexist —
            the row measures the DRAWER's `slide-panel` container (not the
            viewport, same reasoning as `.ui-panel-body`) and flips to a top
            strip the index scrolls horizontally instead, in globals.css. */}
        <div className="slide-panel-body-row">
          {index != null && (
            <div className="slide-panel-index">
              {index}
            </div>
          )}
          {/* `.ui-panel-body` carries the size container (§3.4): a destination
              in here measures the PANEL, not the viewport, which is the only
              breakpoint that means anything inside a viewport-relative panel. */}
          <div className="ui-panel-body">
            {children}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
