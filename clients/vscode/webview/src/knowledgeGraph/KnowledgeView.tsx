/**
 * The Visualization panel's KNOWLEDGE view (PRD 38 §4.7, VS Code row): the ONE
 * `KnowledgeGraphView`, mounted with the host's source and the web's catalog labels. It
 * holds no logic of its own — the view is the package's, the source is the host's
 * (`hostKnowledgeGraphSource.ts`). A new focus (Open in graph) remounts the view on it.
 */

import { KnowledgeGraphView, type KnowledgeGraphLabels, type KnowledgeGraphSource } from '@builderforce/knowledge-graph-view';

export interface KnowledgeViewProps {
  source: KnowledgeGraphSource;
  labels: Partial<KnowledgeGraphLabels>;
  /** Refs to open focused on (`src:<root>::<path>`). */
  focus?: readonly string[] | null;
  /** Moves whenever a focus is asked for again, so the same refs re-focus. */
  focusKey?: number;
  /** Fix with agent → the ONE composer. */
  onCompose?(text: string): void;
}

export function KnowledgeView({ source, labels, focus, focusKey = 0, onCompose }: KnowledgeViewProps) {
  return (
    <div className="bf-viz__knowledge" data-testid="viz-knowledge">
      <KnowledgeGraphView
        key={focusKey}
        source={source}
        labels={labels}
        {...(focus && focus.length > 0 ? { initialFocus: [...focus] } : {})}
        {...(onCompose ? { onCompose } : {})}
      />
    </div>
  );
}
