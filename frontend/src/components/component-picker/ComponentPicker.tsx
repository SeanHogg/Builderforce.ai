'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useComponentCatalog, useComponentLabel } from '@/lib/components/useComponentCatalog';
import type { ComponentDef, ComponentMount } from '@/lib/components/types';

/**
 * THE COMPONENT CATALOGUE — browse everything the registry offers at one mount.
 *
 * ── ONE PANEL, TWO ERRANDS ───────────────────────────────────────────────────
 * The dashboard browses this to PIN a tile; the canvas browses it to MOUNT a
 * surface on a board. Those are different errands and the same panel: the same
 * grouping, the same search, the same "shown but not offered" treatment for a
 * component the reader is not entitled to.
 *
 * The errand arrives as `action` — a render prop — and never as a branch inside
 * this file. That is the difference between a picker a third surface can reuse
 * and a picker that grows an `if (mode === …)` every time somebody needs one.
 * This component therefore knows nothing about pins, nothing about canvas nodes,
 * and nothing about permissions: an action self-gates, because only the action
 * knows what it is asking permission FOR. Pinning a tile and mounting it on a
 * board are not the same grant.
 *
 * ── WHY THE SEARCH STATE LIVES HERE AND THE CATALOGUE DOES NOT ───────────────
 * The query is panel state — it resets when the panel closes and belongs to
 * nothing else. Turning a query into a grouped, labelled, mount-filtered result
 * is a question two surfaces ask, so it lives in `useComponentCatalog` where
 * both get the same answer.
 */
export function ComponentPicker({
  open,
  onClose,
  mount,
  title,
  action,
}: {
  open: boolean;
  onClose: () => void;
  /** Which mount's components to offer. Never filtered by the caller — see the
   *  note in `useComponentCatalog`. */
  mount: ComponentMount;
  /** Panel heading. Supplied by the caller because the two errands are named
   *  differently to a reader ("Add a widget" / "Add a component"). */
  title: string;
  /** What a row offers. Rendered per component; self-gating. */
  action: (def: ComponentDef) => ReactNode;
}) {
  const t = useTranslations('components');
  const [q, setQ] = useState('');
  const groups = useComponentCatalog(mount, q);

  return (
    <SlideOutPanel open={open} onClose={onClose} title={title} width="wide" widthStorageKey="component-picker">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          style={{
            padding: '9px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
          }}
        />
        {groups.length === 0
          ? <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noMatches')}</p>
          : groups.map((g) => (
            <section key={g.group}>
              <h4
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  color: 'var(--text-muted)',
                  margin: '0 0 8px',
                }}
              >
                {g.groupLabel}
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {g.components.map((def) => <ComponentPickerRow key={def.id} def={def} action={action} />)}
              </div>
            </section>
          ))}
      </div>
    </SlideOutPanel>
  );
}

/** One row: the component's name, and whatever the surface offers to do with it. */
function ComponentPickerRow({ def, action }: { def: ComponentDef; action: (def: ComponentDef) => ReactNode }) {
  const label = useComponentLabel();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        // Wraps rather than overflowing: a long label beside an action button is
        // the shape that breaks first on a narrow phone.
        flexWrap: 'wrap',
        padding: '8px 10px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>{label(def)}</span>
      {action(def)}
    </div>
  );
}
