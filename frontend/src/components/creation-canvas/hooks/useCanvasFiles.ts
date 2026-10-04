/** The session's files, the walkthrough stops, and downloading a file. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo, useRef } from 'react';
import { type CanvasFile, canvasFiles } from '@/lib/canvasDocuments';
import { canvasWalkthroughStops } from '@/lib/canvasWalkthrough';
import type { CanvasWalkthroughHandle } from '../CanvasWalkthrough';
import { navigableArtifactUrl } from '@/lib/creationDeliverables';
import { type CanvasExportAction, defaultExportAction } from '@/lib/canvasExports';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { useTranslations } from 'next-intl';

export interface UseCanvasFilesDeps {
  edges: Edge[];
  exportArtifact: (nodeId: string, action: CanvasExportAction) => Promise<string>;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  nodes: CanvasObject[];
  revealObjectRef: RefObject<(objectId: string) => void>;
  setInspectorFocus: Dispatch<SetStateAction<'knowledge' | 'test' | 'evaluation' | 'delivery' | null>>;
  setNotice: (text: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setSurface: (next: CanvasSurfaceId, targetId?: string | null, origin?: CanvasSurfaceId | null) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasFiles({ edges, exportArtifact, flowRef, nodes, revealObjectRef, setInspectorFocus, setNotice, setSelectedId, setSelectedIds, setSurface, t }: UseCanvasFilesDeps) {
  /** Every file this session holds, derived from the objects themselves so a new
   * document, deck, diagram, or sheet appears in the library the moment Brain
   * authors it — no separate registration step to forget. */
  const sessionFiles = useMemo(() => canvasFiles(nodes), [nodes]);

  /**
   * Put the reader in front of one object, from wherever they are.
   *
   * Selecting a node, clearing the inspector and flying the viewport to it were three
   * calls spelled out inline by the Files library; the app surface's "open the card"
   * needs the identical four, plus the one the library did not need — HANDING THE BOARD
   * BACK. A surface that has taken the centre is the one place where selecting a node
   * changes nothing you can see, so "reveal" has to include leaving.
   */
  const revealObject = useCallback((nodeId: string) => {
    setSurface('graph');
    setInspectorFocus(null);
    setSelectedId(nodeId);
    setSelectedIds([nodeId]);
    void flowRef.current?.fitView({ nodes: [{ id: nodeId }], padding: .35, maxZoom: 1.1, duration: 320 });
  }, [setSurface]);
  revealObjectRef.current = revealObject;

  /**
   * WHAT THIS BOARD IS, as a walk. Derived from the board's own objects and
   * connections by `canvasWalkthroughStops` — one stop per kind, in dependency
   * order — so the running order is never a hand-maintained list that a new
   * object kind quietly falls out of.
   *
   * Memoised on the board: it is otherwise recomputed on every object edit, and
   * the grouping walks the graph. An empty result means there is nothing worth
   * walking, and that one fact answers BOTH whether the offer appears and whether
   * the command bar draws the button — see the `walkthrough` handler.
   */
  const walkthroughStops = useMemo(
    () => canvasWalkthroughStops(nodes, edges.map((edge) => ({ source: edge.source, target: edge.target }))),
    [edges, nodes],
  );
  const walkthroughRef = useRef<CanvasWalkthroughHandle>(null);

  /** A file the library offers: a delivered artifact opens, an authored object
   * exports through the path above. */
  const downloadCanvasFile = useCallback((file: CanvasFile) => {
    if (file.url) {
      const navigable = navigableArtifactUrl(file.url);
      const anchor = document.createElement('a');
      anchor.href = navigable;
      anchor.download = file.name;
      anchor.click();
      if (navigable !== file.url) window.setTimeout(() => URL.revokeObjectURL(navigable), 60_000);
      setNotice(t('downloadReady'));
      return;
    }
    const target = nodes.find((node) => node.id === file.nodeId);
    if (target) void exportArtifact(file.nodeId, defaultExportAction(target.data.kind)).then(setNotice);
  }, [exportArtifact, nodes, t]);
  return { revealObject, walkthroughRef, walkthroughStops, sessionFiles, downloadCanvasFile };
}
