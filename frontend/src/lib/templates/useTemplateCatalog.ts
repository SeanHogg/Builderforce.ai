'use client';

/**
 * The one hook every starting-point surface reads.
 *
 * The prompt picker, the canvas's template browser and the templates gallery
 * all previously built their own list, their own search and their own category
 * labels. They now share this: the merge, the ordering and the localization are
 * decided once, and a surface differs only by which entries it chooses to show.
 *
 * The installable half is fetched lazily and never blocks a render; everything
 * else is available synchronously from the message catalogs and the pack
 * registry. The fetch runs for a SIGNED-OUT visitor too: `GET /api/templates`
 * answers a guest with the public catalogue (built-ins plus what publishers
 * listed), because what you can start from is the menu of the product and a
 * visitor who is 401'd out of it cannot tell what this is. Installing is what
 * needs an account, and `GuidedSetupPanel` is where that wall lands.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { templatesApi, type TemplateSummary } from './api';
import { mergeTemplates, orderTemplates, packEntries, promptEntries, workspaceEntries } from './catalog';
import type { TemplateEntry } from './contract';

export interface TemplateCatalogOptions {
  /** Fetch the installable templates. False for surfaces with no workspace. */
  includeWorkspace?: boolean;
  /** Drop the prompt/pack halves — the gallery shows installables only. */
  workspaceOnly?: boolean;
}

/**
 * Cached through the shared client read-through, KEYED BY TENANT — the same
 * shape `usePsychometricCatalog` uses, and for the same reason. The answer is
 * per-workspace (a workspace's own saved templates, and how much of each is
 * connected), so a module-level `let` shared across tenants would have shown a
 * visitor who just signed in the catalogue they saw as a guest until the next
 * hard reload.
 */
const CACHE_PREFIX = 'template-catalog:';

/** The installable half for one workspace ('none' for a signed-out visitor). */
export function loadTemplateCatalog(tenantKey: string): Promise<TemplateSummary[]> {
  return getOrSetClientCached(`${CACHE_PREFIX}${tenantKey}`, async () => (await templatesApi.list()).templates);
}

export function useTemplateCatalog(options: TemplateCatalogOptions = {}): TemplateEntry[] {
  const { includeWorkspace = true, workspaceOnly = false } = options;
  const t = useTranslations('promptUseCases');
  const tCanvas = useTranslations('creationCanvas');
  const tTemplates = useTranslations('templates');
  const { tenant } = useAuth();
  const tenantKey = tenant?.id ?? 'none';
  const [workspace, setWorkspace] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    if (!includeWorkspace) return;
    let cancelled = false;
    loadTemplateCatalog(tenantKey)
      .then((templates) => { if (!cancelled) setWorkspace(templates); })
      // A catalogue that could not be fetched is not an error worth surfacing —
      // the rest of the list is still the answer to "what can I make?".
      .catch(() => {});
    return () => { cancelled = true; };
  }, [includeWorkspace, tenantKey]);

  return useMemo(() => {
    const installable = workspaceEntries(workspace, tTemplates as unknown as (k: string) => string);
    if (workspaceOnly) return orderTemplates(installable);
    return orderTemplates(mergeTemplates(
      promptEntries(
        t as unknown as (k: string) => string,
        (key: string) => (typeof t.raw === 'function' ? t.raw(key) : []),
      ),
      installable,
      packEntries(tCanvas as unknown as (k: string) => string),
    ));
  }, [workspace, workspaceOnly, t, tCanvas, tTemplates]);
}
