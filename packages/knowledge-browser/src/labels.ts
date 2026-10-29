/**
 * THE ONE adapter from the `knowledgeGraph.*` catalogs to `KnowledgeGraphLabels`, for
 * every host: the web feeds it next-intl's `t.raw` (`frontend/src/lib/knowledge/labels.ts`),
 * Rovr feeds it the same five web catalogs, trimmed to the namespace by its build.
 *
 * The catalog mirrors the label object key for key (`knowledgeGraph.fix.cloneGroup` is
 * `labels.fix.cloneGroup`, and is also the `requestKey` memory stamps on a clone-group
 * finding), so the adapter WALKS the package's English defaults and reads each leaf
 * raw — `{placeholders}` stay for the view to fill from a finding's own params. A key a
 * catalog lacks keeps the English default rather than rendering its path.
 */

import { DEFAULT_KNOWLEDGE_GRAPH_LABELS, type KnowledgeGraphLabels } from '@builderforce/knowledge-graph-view';

export const KNOWLEDGE_GRAPH_NAMESPACE = 'knowledgeGraph';

type Tree = { [key: string]: string | Tree };

/**
 * A catalog value, or undefined when the host handed back a FALLBACK instead: use-intl's
 * `namespace.key`, or a bare `key` / last segment (a `getMessageFallback` returning the key,
 * as the VS Code webview's does) — those keep the English default, never render a key.
 */
function translated(got: unknown, key: string, name: string): string | undefined {
  if (typeof got !== 'string' || got.length === 0) return undefined;
  if (got === `${KNOWLEDGE_GRAPH_NAMESPACE}.${key}` || got === key || got === name) return undefined;
  return got;
}

/** `raw(key)` reads one catalog leaf under `knowledgeGraph.` (undefined when absent). */
export function knowledgeGraphLabels(raw: (key: string) => unknown): KnowledgeGraphLabels {
  const walk = (defaults: Tree, prefix: string): Tree => {
    const out: Tree = {};
    for (const [name, fallback] of Object.entries(defaults)) {
      const key = prefix ? `${prefix}.${name}` : name;
      if (typeof fallback === 'string') {
        out[name] = translated(raw(key), key, name) ?? fallback;
      } else {
        out[name] = walk(fallback, key);
      }
    }
    return out;
  };
  return walk(DEFAULT_KNOWLEDGE_GRAPH_LABELS as unknown as Tree, '') as unknown as KnowledgeGraphLabels;
}

/** A `raw` reader over one catalog's `knowledgeGraph` subtree (a dotted key walks it). */
export function catalogReader(namespace: unknown): (key: string) => unknown {
  return (key) => key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    namespace,
  );
}
