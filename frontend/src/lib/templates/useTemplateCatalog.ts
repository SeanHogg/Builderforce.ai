/**
 * The one hook every starting-point surface reads.
 *
 * The prompt picker, the canvas's template browser and the templates gallery
 * all previously built their own list, their own search and their own category
 * labels. They now share this: the merge, the ordering and the localization are
 * decided once, and a surface differs only by which entries it chooses to show.
 *
 * The workspace half is fetched lazily and never blocks a render. A signed-out
 * visitor on the landing canvas has no workspace to install into, so the fetch
 * is skipped entirely rather than allowed to 401 — and everything else is
 * available synchronously from the message catalogs and the pack registry.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { templatesApi, type TemplateSummary } from './api';
import { mergeTemplates, orderTemplates, packEntries, promptEntries, workspaceEntries } from './catalog';
import type { TemplateEntry } from './contract';

export interface TemplateCatalogOptions {
  /** Fetch the installable templates. False for surfaces with no workspace. */
  includeWorkspace?: boolean;
  /** Drop the prompt/pack halves — the gallery shows installables only. */
  workspaceOnly?: boolean;
}

/** Module-level cache so opening the picker a second time is instant and does
 *  not re-hit the API. Reset only by a reload, which is the same lifetime the
 *  server's own five-minute catalogue cache assumes. */
let workspaceCache: TemplateSummary[] | null = null;

export function useTemplateCatalog(options: TemplateCatalogOptions = {}): TemplateEntry[] {
  const { includeWorkspace = true, workspaceOnly = false } = options;
  const t = useTranslations('promptUseCases');
  const tCanvas = useTranslations('creationCanvas');
  const tTemplates = useTranslations('templates');
  const [workspace, setWorkspace] = useState<TemplateSummary[]>(workspaceCache ?? []);

  useEffect(() => {
    if (!includeWorkspace || workspaceCache) return;
    let cancelled = false;
    templatesApi
      .list()
      .then((res) => {
        workspaceCache = res.templates;
        if (!cancelled) setWorkspace(res.templates);
      })
      // A workspace the visitor does not have is not an error worth surfacing —
      // the rest of the catalogue is still the answer to "what can I make?".
      .catch(() => {});
    return () => { cancelled = true; };
  }, [includeWorkspace]);

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
