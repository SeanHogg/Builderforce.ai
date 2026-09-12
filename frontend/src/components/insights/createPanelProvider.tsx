'use client';

/**
 * THE insights drill-down controller, built once.
 *
 * The AI, Delivery, DevEx and Finance hubs each mount a provider near the app root (see
 * ConditionalAppShell) so ANY surface — the hub dashboard, or the Brain via its
 * `show_*_insight` tool — can open one of the hub's lenses in a slide-out without owning
 * the drawer. Those four providers were ~85 lines each and ~15 of them differed: the
 * registry, the i18n namespace, the width-storage key and the hook names. This factory
 * holds the other seventy, so a fifth hub is one call, and a fix to the drawer (tabs,
 * RoleGate, the description line) lands in every hub at once.
 *
 * Each panel gates its own content with `<RoleGate>`, so a caller never computes
 * visibility; the tab strip lets the user pivot across the hub's lenses in place.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import type { Capability } from '@/lib/rbac';

/** What the factory needs from one registry row — every hub's def already carries it. */
export interface PanelDefinition<Id extends string> {
  id: Id;
  /** i18n key (inside the hub's namespace) for the drawer title + tab label. */
  titleKey: string;
  /** i18n key for the one-line description above the lens. */
  descKey: string;
  /** RBAC capability that gates the lens. */
  capability: Capability;
  /** Drawer width; falls back to the factory's `defaultWidth`. */
  width?: string;
  /** The full lens rendered inside the drawer. */
  render: () => ReactNode;
}

export interface PanelApi<Id extends string> {
  /** Open the slide-out on a panel. */
  open: (id: Id) => void;
  close: () => void;
  /** Currently-open panel id, or null when closed. */
  active: Id | null;
}

export interface PanelProviderConfig<Id extends string> {
  /** Names the provider in error messages and React DevTools, e.g. `'DevexPanel'`. */
  name: string;
  /** next-intl namespace the title/desc keys resolve in. */
  namespace: string;
  /** The hub's registry, in tab order. */
  panels: readonly PanelDefinition<Id>[];
  /** SlideOutPanel `widthStorageKey` — the user's drag-resized width, per hub. */
  widthStorageKey: string;
  /** Width for panels that declare none. */
  defaultWidth?: string;
}

export interface PanelProviderKit<Id extends string> {
  Provider: ComponentType<{ children: ReactNode }>;
  /** Throws outside the provider (it is mounted app-wide, so only a wiring mistake trips it). */
  usePanel: () => PanelApi<Id>;
  /** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
  useOptionalPanel: () => PanelApi<Id> | null;
}

export function createPanelProvider<Id extends string>(config: PanelProviderConfig<Id>): PanelProviderKit<Id> {
  const { name, namespace, panels, widthStorageKey, defaultWidth } = config;
  const byId = new Map<string, PanelDefinition<Id>>(panels.map((panel) => [panel.id, panel]));
  const Context = createContext<PanelApi<Id> | null>(null);
  Context.displayName = `${name}Context`;

  function Provider({ children }: { children: ReactNode }) {
    const t = useTranslations(namespace);
    const [active, setActive] = useState<Id | null>(null);

    const open = useCallback((id: Id) => setActive(id), []);
    const close = useCallback(() => setActive(null), []);
    const api = useMemo<PanelApi<Id>>(() => ({ open, close, active }), [open, close, active]);

    const def = active ? byId.get(active) ?? null : null;
    const tabs = panels.map((panel) => ({ id: panel.id, label: t(panel.titleKey) }));

    return (
      <Context.Provider value={api}>
        {children}
        <SlideOutPanel
          open={def != null}
          onClose={close}
          width={def?.width ?? defaultWidth}
          widthStorageKey={widthStorageKey}
          title={def ? t(def.titleKey) : undefined}
          tabs={tabs}
          activeTabId={active ?? undefined}
          onTabChange={(id) => { if (byId.has(id)) setActive(id as Id); }}
        >
          {def && (
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', margin: '0 0 18px' }}>{t(def.descKey)}</p>
              <RoleGate capability={def.capability} variant="block">
                {def.render()}
              </RoleGate>
            </div>
          )}
        </SlideOutPanel>
      </Context.Provider>
    );
  }
  Provider.displayName = `${name}Provider`;

  function usePanel(): PanelApi<Id> {
    const ctx = useContext(Context);
    if (!ctx) throw new Error(`use${name} must be used within a ${name}Provider`);
    return ctx;
  }

  function useOptionalPanel(): PanelApi<Id> | null {
    return useContext(Context);
  }

  return { Provider, usePanel, useOptionalPanel };
}
