import { useCallback, useState } from 'react';
import type { CanvasDockPanel } from '../CanvasBoardMenuBody';

/**
 * The left dock, which holds ONE panel at a time. Six booleans used to stack panels
 * invisibly at the same coordinates; one value cannot express that, so exclusivity is the
 * data model, not a rule each toggle remembers.
 *
 * `outlineHighlightIds` is the board half of the outline panel's search: while a query is
 * active, everything NOT in its result set dims, so the query reads as a map rather than
 * only a list. Gated on the open panel by its readers rather than cleared on unmount.
 */
export function useCanvasDockPanel() {
  const [dockPanel, setDockPanel] = useState<CanvasDockPanel | null>(null);
  const [outlineHighlightIds, setOutlineHighlightIds] = useState<ReadonlySet<string> | null>(null);
  const toggleDockPanel = useCallback((panel: CanvasDockPanel) => setDockPanel((current) => (current === panel ? null : panel)), []);
  const closeDockPanel = useCallback(() => setDockPanel(null), []);
  return { dockPanel, setDockPanel, outlineHighlightIds, setOutlineHighlightIds, toggleDockPanel, closeDockPanel };
}
