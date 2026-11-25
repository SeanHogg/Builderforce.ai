/** Adopting the room's board, the snapshot the room speaks, and the live Evermind badges — the board's open is `useBoardOpen`. */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo } from 'react';
import { useLatestRef } from './useLatestRef';
import { localCreationSnapshotFrom, type LocalCreationSnapshot } from '@/domains/canvas/domain/boardSnapshot';
import { boardSignature } from '@/domains/canvas/application/PersistCanvas';
import { usePolledResource } from '@/hooks/usePolledResource';
import { useBoardOnScreen } from '@/lib/canvas/BoardOnScreenContext';
import { getProjectEvermindContributions, getProjectEvermindHead, type ProjectEvermindContributions, type ProjectEvermindHead } from '@/lib/projectEvermindApi';
import { projectEvermindNodePatch } from '../canvasProjectSync';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import { timelineFromLocal, timelineToLocal } from '../localTimeline';
import type { CreationNodeData } from '../types';
import { dehydrateBoardMedia } from '@/domains/canvas/infrastructure/localFirst/boardMediaUrls';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { writeLocalCreationSession } from '@/lib/pendingWork';
import { useBoardOpen, type UseBoardOpenDeps } from './useBoardOpen';

export interface UseCanvasSessionDeps extends UseBoardOpenDeps {
  edges: Edge[];
  nodes: CanvasObject[];
  setEvermindLiveByNodeId: Dispatch<SetStateAction<Record<string, Partial<CreationNodeData>>>>;
  timeline: CanvasTimelineMessage[];
  title: string;
}

export function useCanvasSession({ commitRevision, currentGraphRef, flowRef, hydratedRef, lastSavedGraphRef, noteSaveState, onBoardLoaded, pendingViewportRef, persistence, sessionId, sessionOpenCorrelationRef, setAllMembers, setBranchParentId, setCurrentUserId, setEdges, setLoadingSession, setMembers, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setSelectedIds, setSessionMode_, setSessionRole, setTimeline, setTitle, t, viewportRef, edges, nodes, timeline, title, setEvermindLiveByNodeId }: UseCanvasSessionDeps) {
  const { boardLoaded, ensureBoardSession, refreshFromServer, serverReady } = useBoardOpen({ commitRevision, currentGraphRef, flowRef, hydratedRef, lastSavedGraphRef, noteSaveState, onBoardLoaded, pendingViewportRef, persistence, sessionId, sessionOpenCorrelationRef, setAllMembers, setBranchParentId, setCurrentUserId, setEdges, setLoadingSession, setMembers, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setSelectedIds, setSessionMode_, setSessionRole, setTimeline, setTitle, t, viewportRef });
  const onScreen = useBoardOnScreen();
  /**
   * Adopt the room's board — a guest room's host or a peer moved something.
   *
   * Recording the board as SAVED before the state lands is the whole trick: the save debounce
   * compares against it and bails, so applying a peer's board cannot be mistaken for a local edit
   * and pushed straight back — which is how a two-person session turns into an infinite sync loop.
   * The echo half of that belongs to `ShareCanvasSession`, where it is tested.
   */
  const applyRoomSnapshot = useCallback((snapshot: LocalCreationSnapshot) => {
    lastSavedGraphRef.current = boardSignature(snapshot);
    setTitle(snapshot.title);
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setTimeline(timelineFromLocal(snapshot.timeline));
    // The viewport is personal — following someone else's pan mid-edit is disorienting, and
    // each participant keeps their own place on the board.
    hydratedRef.current = true;
    // The adopted board is kept on this device too: the autosave will not write it (it was recorded as saved above).
    // A peer's object URL means nothing on this device and must not be stored as if it did.
    if (JSON.stringify(snapshot.nodes).includes('"blob:')) return;
    void writeLocalCreationSession(sessionId, { ...snapshot, viewport: undefined }).catch((error: unknown) => reportLocalFirstFailure('useCanvasSession.adoptRoom', error));
  }, [hydratedRef, lastSavedGraphRef, sessionId, setEdges, setNodes, setTimeline, setTitle]);

  /**
   * The board as it stands, in the snapshot shape the room and the checkpoints speak.
   *
   * ONE builder. It was written out three times — the autosave debounce, the viewport write and
   * the moment sharing starts — and a fourth caller copying whichever one it happened to sit next
   * to is how a field starts being carried by two of the three. It carries content only: a rename
   * happens in the session rail and goes straight to the board's header, so a card moved after a
   * rail rename can never write the old name back.
   */
  // Object URLs of local bytes are this page's: what leaves for a room is `media:<id>`, never a `blob:`.
  const currentSnapshot = useCallback((viewport = viewportRef.current) => {
    const board = dehydrateBoardMedia({ nodes, edges });
    return localCreationSnapshotFrom(null, { title, timeline: timelineToLocal(timeline), nodes: board.nodes, edges: board.edges, viewport });
  }, [edges, nodes, timeline, title, viewportRef]);
  const currentSnapshotRef = useLatestRef(currentSnapshot);

  // Both are read by the hook through a ref, so its pull effect is driven by the
  // ROOM changing rather than by this component re-rendering — which would
  // re-pull the shared board on every keystroke.
  const applyRoomSnapshotRef = useLatestRef(applyRoomSnapshot);

  const evermindBindingKey = useMemo(() => JSON.stringify(nodes.flatMap((node) => {
    const match = node.data.kind === 'evermind' && typeof node.data.resourceId === 'string'
      ? /^evermind:(\d+)$/.exec(node.data.resourceId)
      : null;
    return match ? [{ nodeId: node.id, projectId: Number(match[1]) }] : [];
  }).sort((a, b) => a.nodeId.localeCompare(b.nodeId))), [nodes]);

  const evermindLiveEnabled = persistence === 'server' && evermindBindingKey !== '[]';
  useEffect(() => {
    if (!evermindLiveEnabled) setEvermindLiveByNodeId({});
  }, [evermindLiveEnabled, setEvermindLiveByNodeId]);
  // Live Evermind badges are for the board a person is looking at; a kept board
  // keeps its last values and refreshes on return to the stage.
  usePolledResource(async (signal) => {
      const bindings = JSON.parse(evermindBindingKey) as Array<{ nodeId: string; projectId: number }>;
      const byProject = new Map<number, Promise<[ProjectEvermindHead, ProjectEvermindContributions]>>();
      for (const binding of bindings) {
        if (!byProject.has(binding.projectId)) byProject.set(binding.projectId, Promise.all([getProjectEvermindHead(binding.projectId), getProjectEvermindContributions(binding.projectId)]));
      }
      const settled = await Promise.all(bindings.map(async (binding) => {
        try {
          const [head, activity] = await byProject.get(binding.projectId)!;
          return [binding.nodeId, projectEvermindNodePatch(head, activity)] as const;
        } catch { return null; }
      }));
      if (signal.aborted) return;
      const activeNodeIds = new Set(bindings.map((binding) => binding.nodeId));
      setEvermindLiveByNodeId((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([nodeId]) => activeNodeIds.has(nodeId)));
        for (const entry of settled) {
          if (entry) next[entry[0]] = entry[1];
        }
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
  }, { intervalMs: 20_000, enabled: evermindLiveEnabled && onScreen, restartKey: evermindBindingKey });
  return { applyRoomSnapshotRef, currentSnapshotRef, currentSnapshot, refreshFromServer, ensureBoardSession, serverReady, boardLoaded };
}
