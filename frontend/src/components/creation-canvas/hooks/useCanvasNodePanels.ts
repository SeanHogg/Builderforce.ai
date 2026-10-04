/** The per-node panel and the object picker — where they open and what they are anchored to. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useLayoutEffect, useState } from 'react';
import type { CanvasNodePanelId } from '@/lib/canvasNodeAffordances';
import type { CreationObjectGroup } from '../creationObjectRegistry';

export interface UseCanvasNodePanelsDeps {
  /** The board's element — the cards a panel is anchored to are drawn inside it. */
  boardRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  setInspectorFocus: Dispatch<SetStateAction<'knowledge' | 'test' | 'evaluation' | 'delivery' | null>>;
}

export function useCanvasNodePanels({ boardRef, selectedId, setInspectorFocus }: UseCanvasNodePanelsDeps) {
  /**
   * THE ANCHORED PANEL AND THE PICKER — two overlays, one rule.
   *
   * Both are positioned from a SCREEN rect handed up by whichever control opened them,
   * never from a board coordinate. The alternative is projecting a node's flow position
   * through the viewport transform on every pan and zoom, which is a second copy of React
   * Flow's own maths and drifts the moment either changes. A fixed overlay anchored to
   * where the button actually is cannot drift, and both close on click-away anyway.
   */
  /**
   * THE ONE PANEL, and how it is placed.
   *
   * `box` is the card's own screen rectangle, not a resolved anchor: the panel has two
   * widths and the clamp that keeps it on screen depends on which one is showing, so the
   * position is derived at render from the box rather than frozen when it opened.
   * A `null` box means "read it off the card's element" — the board actions that open an
   * object's inspector have a node id and no event to take a rectangle from.
   *
   * `panel` may be null for the same reason: an action that opens an object's whole
   * inspector has no opinion about which SHORT panel it narrows back to, so the kind's
   * own settings panel is chosen at render.
   */
  const [nodePanel, setNodePanel] = useState<{ nodeId: string; panel: CanvasNodePanelId | null; box: { top: number; right: number } | null; expanded: boolean } | null>(null);
  const [objectPicker, setObjectPicker] = useState<{ anchor: { x: number; y: number }; group?: CreationObjectGroup; fromNodeId?: string } | null>(null);
  /**
   * "The add-to-canvas picker is up, opened from a DOOR rather than a node's own
   * `+`" — the one condition every entry point that offers a pressed/open state
   * (the command bar's circles, the board's own toggle) reads, so the two can never
   * disagree about whether the picker is "the add flow" being open.
   */
  const objectPickerOpen = objectPicker !== null && !objectPicker.fromNodeId;

  /** Beside the badge, clamped so a card at the right edge does not open a panel off it. */
  const anchorFrom = (rect: { top: number; right: number }, width: number) => ({
    x: Math.min(Math.max(12, rect.right + 12), Math.max(12, window.innerWidth - width - 12)),
    y: Math.min(Math.max(12, rect.top - 8), Math.max(12, window.innerHeight - 220)),
  });

  const boxOf = (rect: DOMRect) => ({ top: rect.top, right: rect.right });

  /**
   * Opens the object picker with no group filter — the command bar's own "add to
   * canvas" button reaches it directly by anchoring on its own rect; this is for the
   * doors that have no card or circle of their own to anchor beside (the composer's
   * "add context" row, the large-canvas notice's "Frame" button, the guided tour), so
   * they open at a fixed, sensible corner instead.
   */
  const openObjectPicker = useCallback(() => {
    setNodePanel(null);
    setObjectPicker({ anchor: { x: 54, y: 54 } });
  }, []);

  /**
   * Fills in the box for a panel that was opened without one — the card's box on screen,
   * found through the card itself.
   *
   * The board actions that open an object's inspector — visualize a dataset, compare
   * projects, expand a pipeline — have a node id and no event. A node's FLOW position
   * would have to be projected through the viewport transform to become a screen box,
   * which is a second copy of React Flow's own maths; its rendered element (inside the
   * board's element) already is one.
   *
   * A LAYOUT effect and not a read during render: the card is often created in the same
   * tick as the panel that describes it, so the element does not exist yet when the panel
   * first renders. Measuring after layout is the only point at which the answer exists, and
   * doing it here — rather than calling `getBoundingClientRect` from the render body —
   * keeps the render a pure function of state. Until the card has painted, the panel draws
   * at the fallback position below.
   */
  useLayoutEffect(() => {
    if (!nodePanel || nodePanel.box) return;
    const element = boardRef.current?.querySelector(`[data-node-id="${nodePanel.nodeId}"]`);
    if (!(element instanceof Element)) return;
    const box = boxOf(element.getBoundingClientRect());
    setNodePanel((current) => (current && current.nodeId === nodePanel.nodeId && !current.box ? { ...current, box } : current));
  }, [boardRef, nodePanel]);

  const openNodePanel = useCallback((nodeId: string, panel: CanvasNodePanelId, rect: DOMRect) => {
    setObjectPicker(null);
    setNodePanel({ nodeId, panel, box: boxOf(rect), expanded: false });
  }, []);

  /**
   * "Show me everything about this object" — the same anchored panel, opened WIDE.
   *
   * This replaced `setInspectorNodeId`, which opened a separate full-height rail on the
   * far side of the board. Every one of the eighteen board actions that used to reach for
   * that rail lands here instead, so an object's values, its settings and its activity are
   * always read beside the card they belong to.
   */
  const openNodeInspector = useCallback((nodeId: string, focus: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null = null, rect?: DOMRect) => {
    setObjectPicker(null);
    setInspectorFocus(focus);
    setNodePanel({ nodeId, panel: null, box: rect ? boxOf(rect) : null, expanded: true });
  }, [setInspectorFocus]);

  /**
   * While the WIDE panel is open, it FOLLOWS selection rather than being left behind.
   *
   * Dozens of the inspector's own actions — deliver a mockup, visualize a dataset,
   * compare projects, build a website with code, expand an Evermind pipeline — create
   * a NEW object and select it, exactly the "just made something, look at it" moment
   * the wide reading exists for. Requiring every one of those call sites to remember to
   * retarget the panel is the kind of thing one of them eventually forgets; this is the
   * single place that keeps the rule instead. It does nothing while the panel is COMPACT:
   * a plain click on a different card opens that card's own short panel, which
   * `onNodeClick` has already done by the time this runs.
   */
  // Adjusted while rendering, on the render the selection changed in — not an effect that
  // commits the stale panel first and then renders again to move it.
  const [followedSelectedId, setFollowedSelectedId] = useState(selectedId);
  if (followedSelectedId !== selectedId) {
    setFollowedSelectedId(selectedId);
    if (selectedId) {
      setNodePanel((current) => (current && current.expanded && current.nodeId !== selectedId
        ? { ...current, nodeId: selectedId, panel: null, box: null }
        : current));
    }
  }

  const openInsertPicker = useCallback((nodeId: string, rect: DOMRect) => {
    setNodePanel(null);
    setObjectPicker({ anchor: anchorFrom(boxOf(rect), 400), fromNodeId: nodeId });
  }, []);
  return { openObjectPicker, setNodePanel, openNodeInspector, openNodePanel, setObjectPicker, openInsertPicker, nodePanel, anchorFrom, objectPicker, objectPickerOpen };
}
