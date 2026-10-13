/**
 * THE Insights panel (PRD 33 D16): ONE `SlideOutPanel` holding a stack of
 * levels. The top level is drawn from its `INSIGHT_PANEL_KINDS` row — title,
 * tabs, body — and every level beneath it is a breadcrumb that pops back to it.
 *
 * Addressable: `?panel=<kind>:<id>[:<tab>]` (+ `&t=`, `&follow=1`) opens it on
 * load, and the URL follows the top level so the address bar is always a
 * shareable link. Esc closes (SlideOutPanel owns the key).
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { INSIGHT_PANEL_KINDS, TAB_REQUIREMENTS, panelKindDef, type InsightPanelKind, type InsightPanelLevel } from './panelKinds';
import { parsePanelParams, withPanelParams } from './panelUrl';
import { usePanel } from './usePanel';

export interface InsightsPanelProps {
  siteId: string;
  /** Which edge the panel docks to — opposite the Brain on the canvas. */
  side?: 'left' | 'right';
}

const KNOWN_KINDS = new Set<string>(INSIGHT_PANEL_KINDS.map((row) => row.kind));

function factKey(requirement: string, level: InsightPanelLevel): string {
  return `${requirement}:${level.kind}:${level.id}`;
}

export function InsightsPanel({ siteId, side = 'right' }: InsightsPanelProps) {
  const t = useTranslations('insights');
  const { levels, push, pop, close, replace, setTab } = usePanel();
  const hydrated = useRef(false);
  const [facts, setFacts] = useState<Record<string, boolean>>({});

  // Open from the address on mount.
  useEffect(() => {
    const parsed = parsePanelParams(window.location.search);
    if (parsed && KNOWN_KINDS.has(parsed.kind)) {
      replace([{
        kind: parsed.kind as InsightPanelKind,
        id: parsed.id,
        ...(parsed.tab ? { tab: parsed.tab } : {}),
        ...(parsed.t != null ? { t: parsed.t } : {}),
        ...(parsed.follow ? { follow: true } : {}),
      }]);
    }
    hydrated.current = true;
  }, [replace]);

  const top = levels.length > 0 ? levels[levels.length - 1]! : null;
  const def = top ? panelKindDef(top.kind) : undefined;

  // Keep the address on the top level (after the mount read, so it is not erased first).
  useEffect(() => {
    if (!hydrated.current) return;
    const next = withPanelParams(new URLSearchParams(window.location.search), top);
    const query = next.toString();
    const href = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', href);
    }
  }, [top]);

  // Resolve the facts the top level's tabs require, once per (requirement, level).
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!top || !def) return;
    for (const tab of def.tabs) {
      if (!tab.requires) continue;
      const key = factKey(tab.requires, top);
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      TAB_REQUIREMENTS[tab.requires](siteId, top.id)
        .then((ok) => setFacts((current) => ({ ...current, [key]: ok })))
        .catch((error: unknown) => {
          void error;
          setFacts((current) => ({ ...current, [key]: false }));
        });
    }
  }, [top, def, siteId]);

  if (!top || !def) return null;

  const tabs = def.tabs.filter((tab) => !tab.requires || facts[factKey(tab.requires, top)] === true);
  const active = tabs.find((tab) => tab.id === top.tab) ?? tabs[0];
  if (!active) return null;
  const Body = active.Component;

  const crumb = levels.length > 1 ? (
    <nav aria-label={t('panel.crumbAria')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center' }}>
      {levels.slice(0, -1).map((level, index) => {
        const label = t(panelKindDef(level.kind)?.labelKey ?? 'panel.crumbRoot');
        return (
          <span key={`${level.kind}:${level.id}:${index}`} style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => pop(index + 1)}
              aria-label={t('panel.backTo', { label })}
              style={{ border: 'none', background: 'none', padding: 0, color: 'inherit', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
            >
              {label}
            </button>
            <span aria-hidden="true">/</span>
          </span>
        );
      })}
    </nav>
  ) : t('panel.crumbRoot');

  return (
    <SlideOutPanel
      open
      onClose={close}
      title={t(def.labelKey)}
      crumb={crumb}
      width="wide"
      widthStorageKey="insights-panel"
      side={side}
      tabs={tabs.length > 1 ? tabs.map((tab) => ({ id: tab.id, label: t(tab.labelKey) })) : undefined}
      activeTabId={active.id}
      onTabChange={setTab}
    >
      <Body
        key={`${top.kind}:${top.id}:${active.id}`}
        siteId={siteId}
        id={top.id}
        tab={active.id}
        t={top.t}
        follow={top.follow}
        push={push}
      />
    </SlideOutPanel>
  );
}
