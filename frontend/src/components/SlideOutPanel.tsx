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

export interface SlideOutPanelTab {
  id: string;
  label: string;
}

/**
 * The three widths, and only three (PRD 21 §2.4 / §3.4).
 *
 *   sheet (440) — settings, profile, ⌘K, short forms
 *   wide  (660) — index + detail, e.g. Workforce's fourteen sub-views
 *   full  (94%) — dashboards that need the room; the board is one Esc away
 *
 * A bespoke `min(560px, 96vw)` at a call site is what produced twenty distinct
 * panel widths, so the named widths resolve to tokens and a raw CSS length is
 * accepted only for the surfaces that predate this and have not been ported.
 */
export type PanelWidth = 'sheet' | 'wide' | 'full';

const PANEL_WIDTH: Record<PanelWidth, string> = {
  sheet: 'var(--panel-width-sheet)',
  wide: 'var(--panel-width-wide)',
  full: 'var(--panel-width-full)',
};

const resolveWidth = (width: PanelWidth | string): string =>
  (width in PANEL_WIDTH ? PANEL_WIDTH[width as PanelWidth] : width);

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
  /** Header actions (e.g. buttons) rendered after title. */
  headerActions?: React.ReactNode;
  /** Main content. */
  children: React.ReactNode;
  /** One of the three named widths, or a raw CSS length for an unported surface. */
  width?: PanelWidth | string;
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
  headerActions,
  children,
  width = 'sheet',
  side = 'right',
  zIndex = 9998,
}: SlideOutPanelProps) {
  const tCommon = useTranslations('common');
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
          width: resolveWidth(width),
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
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              flexWrap: 'wrap',
            }}
          >
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
                borderRadius: 8,
                background: 'var(--bg-base)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {(title != null || crumb != null) && (
              <div style={{ flex: 1, minWidth: 0 }}>
                {crumb != null && (
                  <div className="ui-eyebrow" style={{ color: 'var(--text-muted)' }}>{crumb}</div>
                )}
                {title != null && (
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{title}</div>
                )}
              </div>
            )}
            {headerActions}
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
                  fontSize: '0.875rem',
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
            fit down the left edge; a horizontal bar cannot hold them. */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, alignItems: 'stretch' }}>
          {index != null && (
            <div
              style={{
                flexShrink: 0,
                overflowY: 'auto',
                borderRight: '1px solid var(--border-subtle)',
                background: 'var(--surface-sunken)',
                padding: 'var(--space-3)',
              }}
            >
              {index}
            </div>
          )}
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
            {children}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
