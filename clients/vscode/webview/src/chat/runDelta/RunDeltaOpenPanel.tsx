/**
 * The chat's open run delta (PRD 41 §C11.2, §C11.3): `RunDeltaPanel` as a side sheet over the chat, with the repository's
 * run history and trend under its body — passed through the panel's own `renderPanel` slot (`footerPanel`), so the panel
 * itself stays host-agnostic. `useRunDeltaCards` renders exactly this when a card's "Open details" is pressed.
 */

import { useMemo } from 'react';
import { RunDeltaPanel, type RunDeltaCodeTarget, type RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';
import { footerPanel, RUN_DELTA_PANEL_WIDTH } from '@builderforce/knowledge-graph-view/delta/history';
import { RunDeltaHistorySection } from '../runDeltaHistory/RunDeltaHistorySection';
import type { ComputedCard } from './runDeltaCards';

export interface RunDeltaOpenPanelProps {
  card: Pick<ComputedCard, 'repo' | 'delta' | 'overrides'>;
  labels: RunDeltaLabels;
  compact: boolean;
  onClose(): void;
  onOpenCode?: ((target: RunDeltaCodeTarget) => void) | undefined;
}

export function RunDeltaOpenPanel({ card, labels, compact, onClose, onOpenCode }: RunDeltaOpenPanelProps) {
  const repo = card.repo;
  const renderPanel = useMemo(
    () => footerPanel(<RunDeltaHistorySection repo={repo} labels={labels} />, { closeLabel: labels.close, compact, width: RUN_DELTA_PANEL_WIDTH }),
    [repo, labels, compact],
  );
  return (
    // A fixed layer the size of the chat that lets clicks through: the sheet docks to its edge, the transcript stays usable.
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>
        <RunDeltaPanel
          open
          delta={card.delta}
          overrides={card.overrides}
          labels={labels}
          onClose={onClose}
          onOpenCode={onOpenCode}
          compact={compact}
          renderPanel={renderPanel}
        />
      </div>
    </div>
  );
}
