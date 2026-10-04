/** The board model — live refs, the proposal stage, and the primitive writes every surface goes through. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef, useState } from 'react';
import type { CreationFlowNode } from '../CreationNode';
import type { Edge } from '@xyflow/react';
import { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import { createDefaultCreationData } from '../creationObjectRegistry';
import { canvasNodeDimensions, nextCanvasObjectPosition } from '../creationCanvasLayout';
import type { CreationNodeData } from '../types';
import { withFrameCollapsed } from '@/domains/canvas/application/ExpandFramesOnPlacement';
import { SERVER_OWNED_CAMPAIGN_FIELDS } from '../canvasSocialCampaignFields';
import { moveDeal as moveDealOnBoard } from '@/lib/founderOpsApi';
import { pipelineFieldsFrom } from '@/lib/canvasFounderOpsTools';
import { faultText } from '@/lib/apiClient';
import { creationSessionsApi, type CreationTimelineMessage } from '@/lib/builderforceApi';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { CanvasLayoutViewport } from '@/lib/canvasGridFit';
import type { useTranslations } from 'next-intl';
import { useLatestRef } from './useLatestRef';

export interface UseCanvasBoardModelDeps {
  canEdit: boolean;
  canvasTextRef: RefObject<CanvasTextTranslator>;
  cardsEditable: boolean;
  edges: Edge[];
  layoutViewportRef: RefObject<() => CanvasLayoutViewport>;
  lockBlocked: boolean;
  nodes: CanvasObject[];
  noteSaveState: () => void;
  persistence: 'local' | 'server';
  sessionId: string;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setTimeline: Dispatch<SetStateAction<CanvasTimelineMessage[]>>;
  syncSocialCampaign: (campaignId: number, nodeId: string, patch: Partial<CreationNodeData>) => Promise<void>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

/**
 * The proposal stage over the live board. Module-level so the board is read through the
 * refs when a tool RUNS — the stage is built once, during the first render, and never
 * reads them then.
 */
function createBoardStage(
  nodesRef: RefObject<CreationFlowNode[]>,
  edgesRef: RefObject<Edge[]>,
  canvasTextRef: RefObject<CanvasTextTranslator>,
  layoutViewportRef: RefObject<() => CanvasLayoutViewport>,
): CanvasProposalStage {
  return new CanvasProposalStage(
    { nodes: () => nodesRef.current, edges: () => edgesRef.current },
    { defaults: (kind) => createDefaultCreationData(kind, canvasTextRef.current), position: nextCanvasObjectPosition, viewport: () => layoutViewportRef.current() },
  );
}

/** Built once and never replaced, so the tools registered against it keep one identity. */
function useBoardStage(
  nodesRef: RefObject<CreationFlowNode[]>,
  edgesRef: RefObject<Edge[]>,
  canvasTextRef: RefObject<CanvasTextTranslator>,
  layoutViewportRef: RefObject<() => CanvasLayoutViewport>,
): CanvasProposalStage {
  const [stage] = useState(() => createBoardStage(nodesRef, edgesRef, canvasTextRef, layoutViewportRef));
  return stage;
}

export function useCanvasBoardModel({ canEdit, canvasTextRef, cardsEditable, edges, layoutViewportRef, lockBlocked, nodes, noteSaveState, persistence, sessionId, setNodes, setNotice, setTimeline, syncSocialCampaign, t }: UseCanvasBoardModelDeps) {
  /**
   * The board, read WITHOUT depending on it.
   *
   * `updateNodeData` is handed to every card through the `nodeTypes` memo, and `nodes`
   * changes identity on every board event — a selection, a drag, a re-measure, each
   * streamed Brain token writing the transcript back onto the chat Object. Listing it
   * as a dependency therefore gave React Flow a new `nodeTypes` object continuously and
   * REMOUNTED every Object on the board, destroying the local state a card holds: the
   * dashboard's open editor, a document's caret, a data grid's edited cell.
   *
   * Reported as "Edit dashboard does nothing", and that is precisely what it did: the
   * remount lands between the mousedown that SELECTS a card and the click on a control
   * inside it, so the first press hit an element that no longer existed and never
   * reached a handler. Locked by `CreationCanvas.realFlow.test.tsx`, which needs the
   * real store — a mocked XYFlow cannot see a remount.
   *
   * Same ref treatment, for the same reason, as `exportFromNode` and
   * `runWorkflowFromNode` below: stable identity, newest closure. `nodesRef` is the ONE
   * such ref — the build tools and the object vocabulary read the board through it too.
   */
  const nodesRef = useLatestRef<CreationFlowNode[]>(nodes);
  /**
   * The framed reading of the board — who is inside which frame — as a ref.
   *
   * Same treatment, for the same reason, as `nodesRef` above: the drag handler needs
   * the newest containment and must keep a stable identity, and the containment is
   * derived far below it (`useFramedBoard`, which reads the fully decorated nodes). A
   * dependency instead of a ref would either reorder the whole component or hand React
   * Flow a new handler on every board edit.
   */
  const framedBoardRef = useRef<{ memberIdsOf: (frameId: string) => string[] }>({ memberIdsOf: () => [] });
  /** The connections, on the same terms as `nodesRef` — what a compile reads. */
  const edgesRef = useLatestRef<Edge[]>(edges);

  /**
   * What THIS Brain turn intends the board to become, before a human has agreed
   * to any of it.
   *
   * Reading it through {@link CanvasProposalStage} rather than a raw array is the
   * reason a tool can no longer forget that its view of the board must include
   * what the tools before it staged: `stage.nodes()` is the union and there is no
   * accessor that is not. That question used to be re-answered by hand at 58 call
   * sites — three of which spelled the local differently and one of which left the
   * staged EDGES out — and getting it wrong placed objects on top of each other.
   *
   * Constructed once and never replaced, so the tools registered in `canvasActions`
   * keep one identity across renders; it reads `nodesRef`/`edgesRef` so it always
   * sees the CURRENT board rather than whichever one the memo captured.
   */
  const stage = useBoardStage(nodesRef, edgesRef, canvasTextRef, layoutViewportRef);

  const updateNodeData = useCallback((nodeId: string, patch: Partial<CreationNodeData>) => {
    if (!cardsEditable) return;
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      const data = { ...node.data, ...patch };
      // A frame putting itself away is not only a fact ABOUT the frame — it is a
      // different-sized object on the board, and size lives on the node, not in its
      // data. Handled here rather than through a second callback so that every route
      // that collapses a frame (the card, Brain, a keyboard shortcut) resizes it, and
      // so `frameExpandedWidth/Height` is written by exactly one piece of code.
      if (node.data.kind === 'frame' && 'frameCollapsed' in patch) {
        return withFrameCollapsed(
          { ...node, data },
          patch.frameCollapsed === true,
          { id: node.id, kind: 'frame', position: node.position, size: canvasNodeDimensions(node), data: node.data as unknown as Record<string, unknown> },
        );
      }
      return { ...node, data };
    }));
    noteSaveState();
    const target = nodesRef.current.find((node) => node.id === nodeId);
    const campaignId = Number(target?.data.campaignId);
    if (target?.data.kind === 'socialCampaign'
      && Number.isInteger(campaignId)
      && SERVER_OWNED_CAMPAIGN_FIELDS.some((field) => field in patch)) {
      void syncSocialCampaign(campaignId, nodeId, patch);
    }
  }, [cardsEditable, nodesRef, noteSaveState, setNodes, syncSocialCampaign]);

  /**
   * A deal dragged into another stage, on the card.
   *
   * The gesture FO-F1 named itself after and could not perform: every piece was in
   * place — each projected card carries its `dealId`, and ONE call both moves the
   * deal and returns the redrawn board — and the renderer had no drag handler, so
   * the move was reachable through the MODEL and not through a pointer.
   *
   * Deliberately NOT `updateNodeData`: this is not a patch to the card, it is a
   * write to the DEAL followed by a redraw from that same response. Which is also
   * why there is no optimistic reorder — the board that comes back is the board,
   * and painting a guess first would reintroduce, for a few hundred milliseconds,
   * exactly the "the card says one thing and the CRM says another" the projection
   * exists to remove. A refusal (a stage the tenant retired, a deal somebody else
   * closed) leaves the card where it was and says why.
   */
  const moveDealFromNode = useCallback((nodeId: string, dealId: number, stage: string) => {
    if (!cardsEditable) return;
    noteSaveState();
    void moveDealOnBoard(dealId, stage)
      .then((pipeline) => {
        setNodes((current) => current.map((node) => node.id === nodeId
          ? { ...node, data: { ...node.data, ...pipelineFieldsFrom(pipeline) } }
          : node));
        setNotice(t('noticeDealMoved', { stage }));
      })
      .catch((error: unknown) => {
        setNotice(faultText(error, t('noticeDealNotMoved')));
      });
  }, [cardsEditable, noteSaveState, setNodes, setNotice, t]);

  /* Takes the node it resizes rather than reading the selection: the panel that offers
     this is anchored to ONE card, and "whichever card is selected" is exactly the
     ambiguity anchoring the panel removed. */
  const updateWebsiteViewport = useCallback((nodeId: string, viewport: 'desktop' | 'tablet' | 'mobile') => {
    if (!canEdit || lockBlocked) return;
    const preset = viewport === 'mobile' ? { width: 340, height: 620 } : viewport === 'tablet' ? { width: 520, height: 560 } : { width: 720, height: 460 };
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, style: { ...node.style, ...preset }, data: { ...node.data, viewport } } : node));
    setNotice(t('noticeViewportChanged', { viewport }));
  }, [canEdit, lockBlocked, setNodes, setNotice, t]);

  // `clientMessageId` is annotated rather than inferred from the default:
  // `crypto.randomUUID()` is typed as the template literal `${string}-${string}…`
  // in the DOM lib, which would narrow the PARAMETER to that shape and reject
  // the ids callers legitimately pass through (a resumed message's own id).
  const appendTimeline = useCallback((role: 'user' | 'assistant' | 'system', body: string, metadata: CreationTimelineMessage['metadata'] = {}, clientMessageId: string = crypto.randomUUID()) => {
    const message: CanvasTimelineMessage = { clientMessageId, messageRole: role, body, metadata, createdAt: new Date().toISOString() };
    setTimeline((current) => current.some((item) => item.clientMessageId === clientMessageId) ? current : [...current, message]);
    if (persistence === 'server') void creationSessionsApi.timeline.append(sessionId, { clientMessageId, role, body, metadata }).then((saved) => {
      setTimeline((current) => current.map((item) => item.clientMessageId === clientMessageId ? saved : item));
    }).catch((error) => setNotice(error instanceof Error ? t('noticeConversationSaveFailedReason', { reason: error.message }) : t('noticeConversationSaveFailed')));
    return clientMessageId;
  }, [persistence, sessionId, setNotice, setTimeline, t]);
  return { nodesRef, framedBoardRef, stage, appendTimeline, edgesRef, updateNodeData, moveDealFromNode, updateWebsiteViewport };
}
