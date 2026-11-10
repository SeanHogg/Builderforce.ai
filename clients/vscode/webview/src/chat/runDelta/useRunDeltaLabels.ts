/**
 * The run delta card's words in the editor: the web's `runDelta.*` catalog (all five locales),
 * which the chat already has in context — `CanvasScreenProviders` wraps every chat in the
 * `use-intl` provider with the trimmed web catalogs — read through the view's ONE catalog walker
 * (`runDeltaLabels`), exactly as the Knowledge view reads `knowledgeGraph.*`.
 *
 * The namespace is a LITERAL on purpose: the catalog trimmer (`collectCanvasNamespaces`, wired for
 * this file in `vite.config.ts`) only ships namespaces it can see as `useTranslations('…')`.
 */

import { useMemo } from 'react';
import { useTranslations } from 'use-intl';
import { runDeltaLabels, type RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';

export function useRunDeltaLabels(): RunDeltaLabels {
  const t = useTranslations('runDelta');
  return useMemo(() => runDeltaLabels((key) => {
    try {
      return t.raw(key);
    } catch {
      return undefined;
    }
  }), [t]);
}
