'use client';

import type { CSSProperties } from 'react';

export interface TabDef<T extends string = string> {
  id: T;
  label: string;
}

interface TabsProps<T extends string> {
  tabs: ReadonlyArray<TabDef<T>>;
  active: T;
  onChange: (id: T) => void;
  /** Optional style overrides for the tab-bar container. */
  style?: CSSProperties;
}

/**
 * Underlined tab bar shared across tabbed surfaces (Workforce, etc.). The bar
 * owns its own styling and active-state look; callers supply the tab list and
 * the active id, and handle the actual content switch. Keeping this in one place
 * means the tab look never drifts between pages.
 */
export function Tabs<T extends string>({ tabs, active, onChange, style }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: 20, overflowX: 'auto', ...style }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: '10px 16px',
            fontSize: 13,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            borderBottom: `2px solid ${active === t.id ? 'var(--coral-bright, #f4726e)' : 'transparent'}`,
            color: active === t.id ? 'var(--coral-bright, #f4726e)' : 'var(--text-muted)',
            fontWeight: active === t.id ? 600 : 400,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
