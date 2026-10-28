/**
 * The web's feed into THE ONE catalog → labels mapper (`@builderforce/knowledge-browser`
 * `knowledgeGraphLabels`, which Rovr feeds from the same catalogs): next-intl's `t.raw`
 * over the `knowledgeGraph` namespace. The VS Code webview compiles this same file.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { KNOWLEDGE_GRAPH_NAMESPACE, knowledgeGraphLabels } from '@builderforce/knowledge-browser';
import type { KnowledgeGraphLabels } from '@builderforce/knowledge-graph-view';

export { KNOWLEDGE_GRAPH_NAMESPACE, knowledgeGraphLabels };

export function useKnowledgeGraphLabels(): KnowledgeGraphLabels {
  const t = useTranslations(KNOWLEDGE_GRAPH_NAMESPACE);
  return useMemo(() => knowledgeGraphLabels((key) => {
    try {
      return t.raw(key);
    } catch {
      return undefined;
    }
  }), [t]);
}
