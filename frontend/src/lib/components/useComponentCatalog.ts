'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { listComponentGroups } from './registry';
import type { ComponentDef, ComponentMount } from './types';

/**
 * BROWSING THE COMPONENT REGISTRY — grouped, searched, and labelled, once.
 *
 * ── WHY THIS IS A HOOK AND NOT PART OF THE PANEL ─────────────────────────────
 * Two surfaces browse the same registry for two different reasons: the dashboard
 * picks a tile to pin, and the canvas picks a surface to mount on a board. What
 * they share is not the panel — it is the QUESTION: which components are there,
 * under which headings, and which ones match what the reader typed.
 *
 * Left inside the panel, that question gets answered twice the moment a second
 * surface needs it, and the two answers drift in the way that matters most: the
 * search. One would match on the raw `titleKey` and one on the rendered label, so
 * typing "roadmap" would find a component on one surface and not the other, and
 * nobody would ever file that as a bug. Matching on the LABEL — the words the
 * reader can actually see — is the whole reason this needs the translator, and it
 * is why the logic and the translator have to live together.
 *
 * ── WHY THE MOUNT IS AN ARGUMENT AND NOT A FILTER THE CALLER APPLIES ─────────
 * A caller that filtered afterwards could forget, and a dashboard tile offered as
 * a board card renders something never designed for one. Asking for the mount up
 * front makes the correct thing the only available thing.
 */

export interface ComponentCatalogGroup {
  /** The registry's group key — stable, for React keys and tests. */
  group: string;
  /** The heading a reader sees. Resolved here so no caller re-derives it. */
  groupLabel: string;
  components: ComponentDef[];
}

/**
 * The components available at `mount`, grouped and narrowed by `query`.
 *
 * Empty groups are dropped rather than rendered as bare headings, so a search
 * that matches three things shows three things instead of forty headings and
 * three rows. An empty query returns everything.
 */
export function useComponentCatalog(mount: ComponentMount, query: string): ComponentCatalogGroup[] {
  const t = useTranslations('components');
  const groups = useMemo(() => listComponentGroups(mount), [mount]);
  const needle = query.trim().toLowerCase();

  return useMemo(() => {
    const out: ComponentCatalogGroup[] = [];
    for (const g of groups) {
      const groupLabel = t(`group.${g.group}` as 'group');
      const components = needle
        ? g.components.filter((c) => {
          const label = t(`title.${c.titleKey}` as 'title').toLowerCase();
          // The id is matched too: it is what a board card stores and what
          // `/embed/<id>` uses, so somebody who knows the id should be able to
          // find the thing it names.
          return label.includes(needle) || c.id.toLowerCase().includes(needle);
        })
        : g.components;
      if (components.length > 0) out.push({ group: g.group, groupLabel, components });
    }
    return out;
    // `t` is stable for a given locale; listing it would rebuild the catalogue on
    // every render of every consumer for no change in output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, needle]);
}

/**
 * One component's visible label.
 *
 * Exported because a row's ACTION sometimes needs the name too — a confirmation,
 * an aria-label — and reaching for `t('title.' + key)` at each call site is how a
 * label ends up resolved from the wrong namespace on one of them.
 */
export function useComponentLabel(): (def: Pick<ComponentDef, 'titleKey'>) => string {
  const t = useTranslations('components');
  // STABLE per locale, and that is not a micro-optimisation. This function is a
  // dependency of consumers' `useMemo` — `WidgetBrainBridge` builds its Brain
  // action array from it — so a fresh identity on every render rebuilt that
  // array on every render, which re-registered the widget tools, which bumped
  // the Brain registry, which re-rendered the bridge. The app never stopped
  // re-rendering, React never reached an idle frame, and every `next/link`
  // navigation on the site (a transition) was starved: no link anywhere
  // navigated. Fixed 2026-08-22 together with the registry seam itself.
  return useCallback((def: Pick<ComponentDef, 'titleKey'>) => t(`title.${def.titleKey}` as 'title'), [t]);
}
