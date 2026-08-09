'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * The session bar's dropdown chrome — one surface, one item shape, one divider.
 *
 * The scope switcher and the canvas switcher sit next to each other in the top
 * bar, so any drift between their popups is visible at a glance. Colours come
 * from theme tokens only, so both read correctly in light and dark, and the
 * surface is width-capped and scroll-bounded so a long workspace or canvas name
 * cannot push it off a narrow viewport.
 */

export function MenuSurface({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="menu"
      aria-label={label}
      style={{
        position: 'absolute',
        right: 0,
        top: 'calc(100% + 6px)',
        minWidth: 220,
        // Never wider than the viewport it drops into — a 360px phone still gets
        // a menu with margin on both sides.
        maxWidth: 'min(320px, calc(100vw - 24px))',
        background: 'var(--panel-drawer-bg, var(--bg-elevated))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 6px 20px var(--shadow-color, rgba(0, 0, 0, 0.35))',
        zIndex: 100000,
        padding: 6,
      }}
    >
      {children}
    </div>
  );
}

export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '4px 10px 2px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}

export function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 4px' }} aria-hidden="true" />;
}

/** A scroll-bounded region for the variable-length part of a menu. */
export function MenuScroll({ children }: { children: ReactNode }) {
  return <div style={{ maxHeight: 260, overflowY: 'auto' }}>{children}</div>;
}

export function menuItemStyle(active: boolean): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '7px 10px',
    fontSize: 13,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    background: active ? 'var(--surface-coral-soft)' : 'transparent',
    fontWeight: active ? 600 : 400,
    textDecoration: 'none',
  };
}

/** Secondary line under a menu item's label (timestamp, status, hint). */
export function MenuItemMeta({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 1 }}>
      {children}
    </span>
  );
}
