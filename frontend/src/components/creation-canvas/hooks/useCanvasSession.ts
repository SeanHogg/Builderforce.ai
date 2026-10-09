/** Loading the session and adopting remote/room board state into this one. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { useLatestRef } from './useLatestRef';
import { localCreationSnapshot, type LocalCreationSnapshot, readLocalCreationSession, writeLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { normalizeChatMode } from '@/lib/brain';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { type CreationSessionDetail, creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { flowFromSession, rejectedObjectKinds } from '../canvasBoardLoad';
import { faultText } from '@/lib/apiClient';
import type { AdoptRemoteBoardDecision, LocalBoardState } from '@/domains/canvas/application/AdoptRemoteBoard';
import { boardSignature } from '@/domains/canvas/application/PersistCanvas';
import { usePolledResource } from '@/hooks/usePolledResource';
import { getProjectEvermindContributions, getProjectEvermindHead, type ProjectEvermindContributions, type ProjectEvermindHead } from '@/lib/projectEvermindApi';
import { projectEvermindNodePatch } from '../canvasProjectSync';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';

export interface UseCanvasSessionDeps {
  commitRevision: (revision: number) => void;
  currentGraphRef: RefObject<string>;
  edges: Edge[];
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  hydratedRef: RefObject<boolean>;
  lastSavedGraphRef: RefObject<string>;
  nodes: CanvasObject[];
  noteSaveState: () => void;
  /** Told ONCE, with the board as it loaded (local snapshot or server copy) — never on later edits.
   *  The loader is the one place that knows when "the board" stops meaning the starter. */
  onBoardLoaded: (nodes: readonly CanvasObject[]) => void;
  pendingViewportRef: RefObject<{ x: number; y: number; zoom: number; } | null>;
  persistence: 'local' | 'server';
  revisionRef: RefObject<number>;
  saveInFlightRef: RefObject<boolean>;
  sessionId: string;
  sessionOpenCorrelationRef: RefObject<string>;
  setAllMembers: Dispatch<SetStateAction<{ userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[]>>;
  setBranchParentId: Dispatch<SetStateAction<string | null>>;
  setCurrentUserId: Dispatch<SetStateAction<string | null>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setEvermindLiveByNodeId: Dispatch<SetStateAction<Record<string, Partial<CreationNodeData>>>>;
  setLoadingSession: Dispatch<SetStateAction<boolean>>;
  setMembers: Dispatch<SetStateAction<{ userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPersistedObjectIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setSessionMode_: Dispatch<SetStateAction<'chat' | 'work'>>;
  setSessionRole: Dispatch<SetStateAction<'viewer' | 'commenter' | 'editor' | 'runner' | 'owner'>>;
  setTimeline: Dispatch<SetStateAction<CanvasTimelineMessage[]>>;
  setTitle: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  timeline: CanvasTimelineMessage[];
  title: string;
  viewportRef: RefObject<{ x: number; y: number; zoom: number; }>;
}

export function useCanvasSession({ commitRevision, currentGraphRef, edges, flowRef, hydratedRef, lastSavedGraphRef, nodes, noteSaveState, onBoardLoaded, pendingViewportRef, persistence, revisionRef, saveInFlightRef, sessionId, sessionOpenCorrelationRef, setAllMembers, setBranchParentId, setCurrentUserId, setEdges, setEvermindLiveByNodeId, setLoadingSession, setMembers, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setSelectedIds, setSessionMode_, setSessionRole, setTimeline, setTitle, t, timeline, title, viewportRef }: UseCanvasSessionDeps) {
  /**
   * The board AS LOADED is on screen — STATE, not `hydratedRef`, because something has to
   * re-render on it: the entry app (`useCanvasEntryApp`) may only decide "this board has no
   * app" about the loaded board, never about the starter seed that precedes it. Set in the
   * same commit as the loaded nodes, so the first render that sees `true` sees them too.
   */
  const [boardLoaded, setBoardLoaded] = useState(false);
  useEffect(() => {
    try {
      if (persistence === 'local') {
        const saved = readLocalCreationSession(sessionId);
        if (saved) {
          setTitle(saved.title);
          setNodes(saved.nodes);
          setEdges(saved.edges);
          setTimeline((saved.timeline ?? []).map((message) => ({ clientMessageId: message.clientMessageId, messageRole: message.role, body: message.body, metadata: message.metadata ?? {}, createdAt: message.createdAt })));
          // The mode a guest armed in the homepage composer, carried across the
          // hand-off — a local canvas has no server row, so the snapshot IS the store.
          setSessionMode_(normalizeChatMode(saved.mode));
          if (saved.viewport) { viewportRef.current = saved.viewport; pendingViewportRef.current = saved.viewport; void flowRef.current?.setViewport(saved.viewport); }
        }
        onBoardLoaded(saved?.nodes ?? []);
        // The local board is read synchronously, so its load signal lands in the effect;
        // `useCanvasEntryApp` needs it as STATE (a ref cannot re-render the decision).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBoardLoaded(true);
        hydratedRef.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: canvasSurface(), persistence: 'local' } });
        return;
      }
      const openedAt = performance.now();
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelationRef.current, action: 'session.open', phase: 'started' }).catch(() => undefined);
      void Promise.all([creationSessionsApi.get(sessionId), creationSessionsApi.timeline.list(sessionId)]).then(([detail, transcript]) => {
        const { nodes: loadedNodes, edges: loadedEdges, rejected } = flowFromSession(detail);
        // The `declaredKind` invariant, said out loud. An object this build cannot
        // name is dropped rather than drawn as a blank card, and the user is told
        // which kinds — without that sentence the board silently has fewer objects
        // than the person who saved it put on it, which is the worse failure.
        if (rejected.length) setNotice(t('objectsRejected', { count: rejected.length, kinds: rejectedObjectKinds(rejected) }));
        setTitle(detail.session.title);
        // Mode is a property of the SESSION (0409), so a collaborator opening this
        // board inherits the mode it is actually running in rather than the default.
        setSessionMode_(normalizeChatMode(detail.session.mode));
        setBranchParentId(detail.session.branchParentSessionId ?? null);
        setNodes(loadedNodes);
        onBoardLoaded(loadedNodes);
        setBoardLoaded(true);
        setEdges(loadedEdges);
        setPersistedObjectIds(new Set(loadedNodes.map((node) => node.id)));
        setMembers(detail.members);
        setAllMembers(detail.members);
        setCurrentUserId(detail.currentUserId || null);
        const personalSelection = detail.members.find((member) => member.userId === detail.currentUserId)?.selection?.filter((id) => loadedNodes.some((node) => node.id === id)) ?? [];
        setSelectedIds(personalSelection);
        setSelectedId(personalSelection.length === 1 ? personalSelection[0] : null);
        setSessionRole(detail.role);
        setTimeline(transcript.messages);
        const restoredViewport = detail.personalViewport && typeof detail.personalViewport.x === 'number' && typeof detail.personalViewport.y === 'number' && typeof detail.personalViewport.zoom === 'number'
          ? { x: detail.personalViewport.x, y: detail.personalViewport.y, zoom: detail.personalViewport.zoom }
          : null;
        if (restoredViewport) {
          viewportRef.current = restoredViewport;
          pendingViewportRef.current = restoredViewport;
          void flowRef.current?.setViewport(restoredViewport);
        }
        commitRevision(detail.session.canvasRevision ?? detail.session.revision ?? 1);
        lastSavedGraphRef.current = JSON.stringify({ nodes: loadedNodes, edges: loadedEdges });
        currentGraphRef.current = lastSavedGraphRef.current;
        hydratedRef.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [...new Set(loadedNodes.map((node) => node.data.kind))] } });
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelationRef.current, action: 'session.open', phase: 'succeeded', durationMs: performance.now() - openedAt }).catch(() => undefined);
        noteSaveState();
      }).catch((error) => {
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelationRef.current, action: 'session.open', phase: 'failed', durationMs: performance.now() - openedAt }).catch(() => undefined);
        setNotice(faultText(error, t('noticeLoadSessionFailed')));
      }).finally(() => setLoadingSession(false));
    } catch { hydratedRef.current = true; }
  }, [commitRevision, currentGraphRef, flowRef, hydratedRef, lastSavedGraphRef, noteSaveState, onBoardLoaded, pendingViewportRef, persistence, revisionRef, sessionId, sessionOpenCorrelationRef, setAllMembers, setBranchParentId, setCurrentUserId, setEdges, setLoadingSession, setMembers, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setSelectedIds, setSessionMode_, setSessionRole, setTimeline, setTitle, t, viewportRef]);

  /**
   * Adopt the room's board. Used for the first load in a shared session and for
   * every peer edit after it.
   *
   * Recording the board as EXCHANGED and as SAVED before the state lands is the
   * whole trick: both save debounces compare against those and bail, so applying a
   * peer's board cannot be mistaken for a local edit and pushed straight back —
   * which is how a two-person session turns into an infinite sync loop. The echo
   * half of that now belongs to `ShareCanvasSession`, which is where it is tested.
   */
  /**
   * What this browser is holding, for the use case that decides whether a
   * collaborator's board may replace it.
   *
   * A function rather than a value because the answer must be read at the MOMENT
   * of the decision: these are refs precisely so a poll firing eight seconds after
   * its effect closed over them still sees the board as it is now.
   */
  const localBoardState = useCallback((): LocalBoardState => ({
    saving: saveInFlightRef.current,
    signature: currentGraphRef.current,
    savedSignature: lastSavedGraphRef.current,
    revision: revisionRef.current,
  }), [currentGraphRef, lastSavedGraphRef, revisionRef, saveInFlightRef]);

  /**
   * Put an adopted board on screen. The ONE place a collaborator's board lands,
   * for both channels that can carry one.
   *
   * A refusal is silent on purpose: "your unsaved edits kept a newer board out"
   * is not something to interrupt someone with, and the next poll or frame will
   * carry it again once the save lands.
   */
  const applyRemoteBoard = useCallback((decision: AdoptRemoteBoardDecision, notice: string) => {
    if (!decision.adopt) return;
    setNodes(decision.board.nodes);
    setEdges(decision.board.edges);
    setPersistedObjectIds(new Set(decision.board.nodes.map((node) => node.id)));
    setTitle(decision.title);
    setAllMembers(decision.members as CreationSessionDetail['members']);
    commitRevision(decision.revision);
    lastSavedGraphRef.current = decision.signature;
    currentGraphRef.current = decision.signature;
    // A collaborator on a newer deployment can save a kind this build does not
    // declare. Both of these doors used to drop those objects in silence while
    // the initial load, three hundred lines away, said so.
    if (decision.rejected.length) setNotice(t('objectsRejected', { count: decision.rejected.length, kinds: rejectedObjectKinds(decision.rejected) }));
    else setNotice(notice);
  }, [commitRevision, currentGraphRef, lastSavedGraphRef, setAllMembers, setEdges, setNodes, setNotice, setPersistedObjectIds, setTitle, t]);

  const applyRoomSnapshot = useCallback((snapshot: LocalCreationSnapshot) => {
    // `noteExchanged` is NOT called here any more: the shared session moved into
    // `useSharedCanvasRoom`, and its `pull` records the exchange before it calls the
    // adopt callback — which is this function, and its only caller. Calling it here
    // would be the same fact written twice, and the binding no longer exists.
    lastSavedGraphRef.current = boardSignature(snapshot);
    setTitle(snapshot.title);
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setTimeline((snapshot.timeline ?? []).map((message) => ({
      clientMessageId: message.clientMessageId,
      messageRole: message.role,
      body: message.body,
      metadata: message.metadata ?? {},
      createdAt: message.createdAt,
    })));
    // The viewport is personal — following someone else's pan mid-edit is
    // disorienting, and each participant keeps their own place on the board.
    writeLocalCreationSession(sessionId, snapshot);
    // A joiner mounts on the starter board and this is the first real one it has
    // seen; the load gate opens here so the save debounce may start writing.
    hydratedRef.current = true;
  }, [hydratedRef, lastSavedGraphRef, sessionId, setEdges, setNodes, setTimeline, setTitle]);

  /**
   * The board as it stands, in the shape localStorage keeps it.
   *
   * ONE builder. It was written out three times — the autosave debounce, the
   * viewport write and the moment sharing starts — and a fourth caller copying
   * whichever one it happened to sit next to is how a field starts being carried
   * by two of the three.
   *
   * The title comes off the STORED snapshot, not this component's own `title`
   * state: renaming now happens in the session rail, not on the canvas, so this
   * board is no longer the one place a local session's name changes. Reading it
   * fresh off storage rather than baking in the closure's copy is what stops a
   * card move made after a rail rename from writing the OLD name back over it.
   */
  const currentSnapshot = useCallback((viewport = viewportRef.current) => localCreationSnapshot(sessionId, {
    title: readLocalCreationSession(sessionId)?.title ?? title,
    timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })),
    nodes,
    edges,
    viewport,
  }), [edges, nodes, sessionId, timeline, title, viewportRef]);
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
  }, { intervalMs: 20_000, enabled: evermindLiveEnabled, restartKey: evermindBindingKey });
  return { applyRoomSnapshotRef, currentSnapshotRef, currentSnapshot, localBoardState, applyRemoteBoard, boardLoaded };
}
