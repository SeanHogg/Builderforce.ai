/**
 * The Visualization panel's view switch (AC5): Knowledge | Canvas | Changes as the visualizer toolbar's icon segment (`Seg`, the knowledge-graph-view
 * package's own primitive, so it matches the header exactly): one icon per view and only the ACTIVE view shows its word. Every button's accessible
 * name is its label and its title the view's hint. Always mounted, in every view, never disabled.
 */
import { cameraGlyph, chromeGlyph, Seg, type SegItem } from '@builderforce/knowledge-graph-view';

import type { VisualizationView } from './visualizationViewState';

/** The views, in the switch's order. `action` is the reducer action the pick dispatches. */
const VIEWS: ReadonlyArray<{
  id: VisualizationView;
  action: 'showKnowledge' | 'showCanvas' | 'showChanges';
  label: [string, string];
  hint: [string, string];
  glyph: () => SegItem['glyph'];
}> = [
  { id: 'knowledge', action: 'showKnowledge', label: ['viz.button.knowledge', 'Knowledge'], hint: ['viz.showKnowledge', 'Show what this workspace knows: its knowledge graph'], glyph: () => cameraGlyph('graph') },
  { id: 'canvas', action: 'showCanvas', label: ['viz.button.canvas', 'Canvas'], hint: ['viz.showCanvas', 'Back to the Creation Canvas'], glyph: () => chromeGlyph('canvas') },
  { id: 'changes', action: 'showChanges', label: ['viz.button.changes', 'Changes'], hint: ['viz.showChanges', 'Show the code changes this run made'], glyph: () => chromeGlyph('diff') },
];

export interface ViewSwitchProps {
  view: VisualizationView;
  /** Whether the Knowledge view is offered. */
  hasKnowledge: boolean;
  t(key: string, fallback: string): string;
  onPick(action: (typeof VIEWS)[number]['action']): void;
}

export function ViewSwitch({ view, hasKnowledge, t, onPick }: ViewSwitchProps) {
  const shown = hasKnowledge ? VIEWS : VIEWS.filter((v) => v.id !== 'knowledge');
  const items: SegItem[] = shown.map((v) => ({ id: v.id, label: t(v.label[0], v.label[1]), title: t(v.hint[0], v.hint[1]), glyph: v.glyph(), testId: `viz-view-${v.id}` }));
  return (
    <Seg
      label={t('viz.views', 'Visualization views')}
      items={items}
      value={view}
      onPick={(id) => { const v = shown.find((x) => x.id === id); if (v) onPick(v.action); }}
    />
  );
}
