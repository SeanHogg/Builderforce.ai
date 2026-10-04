/** Keeping the session in sync — saving, realtime, polled members and invitations. */
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from 'react';
import { boardSignature, persistBoard, saveAttemptKey } from '@/domains/canvas/application/PersistCanvas';
import { canvasSessionGateway } from '@/domains/canvas/infrastructure/canvasSessionGateway';
import { rejectedObjectKinds } from '../canvasBoardLoad';
import { type LocalCreationSnapshot, readLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { usePolledResource } from '@/hooks/usePolledResource';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { adoptRemoteBoard, type AdoptRemoteBoardDecision, type LocalBoardState } from '@/domains/canvas/application/AdoptRemoteBoard';
import { BRAIN_RUN_HEARTBEAT_MS } from '@/lib/canvas/livePresence';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { PresenceRelay } from '@/domains/canvas/application/PresenceRelay';
import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';

export interface UseCanvasSessionSyncDeps {
  activeMemberIds: RefObject<Set<string>>;
  activePresenceInitialized: RefObject<boolean>;
  applyRemoteBoard: (decision: AdoptRemoteBoardDecision, notice: string) => void;
  brainRunStartedAt: number | null;
  canEdit: boolean;
  clearPresence: () => void;
  currentGraph: RefObject<string>;
  currentSnapshot: (viewport?: { x: number; y: number; zoom: number; }) => LocalCreationSnapshot;
  currentUserId: string | null;
  cursorRef: RefObject<{ x: number; y: number; } | null>;
  edges: Edge[];
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  followingUserId: string | null;
  hydrated: RefObject<boolean>;
  initialBuildOpen: boolean;
  initialBuildOpened: RefObject<boolean>;
  initialFocusId: string | null | undefined;
  isComposingPrompt: boolean;
  joinedCollaborator: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; } | null;
  lastSavedGraph: RefObject<string>;
  liveSocketRef: RefObject<WebSocket | null>;
  loadingSession: boolean;
  localBoardState: () => LocalBoardState;
  mobileViewportFitted: RefObject<boolean>;
  nodes: CanvasObject[];
  noteSaveState: () => void;
  pendingSave: RefObject<{ signature: string; key: string; } | null>;
  persistSnapshot: (snapshot: LocalCreationSnapshot) => void;
  persistence: 'local' | 'server';
  presenceLive: boolean;
  presenceRef: RefObject<PresenceRelay | null>;
  receivePresence: (frame: unknown) => void;
  revision: RefObject<number>;
  saveInFlight: RefObject<boolean>;
  selectedIds: string[];
  sendPresence: (state: CanvasPresenceState) => void;
  sessionId: string;
  openApp: (nodeId: string) => void;
  setCurrentUserId: Dispatch<SetStateAction<string | null>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setJoinedCollaborator: Dispatch<SetStateAction<{ userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; } | null>>;
  setMembers: Dispatch<SetStateAction<{ userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPersistedObjectIds: Dispatch<SetStateAction<Set<string>>>;
  setRealtimeState: Dispatch<SetStateAction<'local' | 'connecting' | 'online' | 'reconnecting' | 'offline'>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setTimeline: Dispatch<SetStateAction<CanvasTimelineMessage[]>>;
  storageKey: string;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  thinking: boolean;
  timeline: CanvasTimelineMessage[];
  title: string;
  viewportRef: RefObject<{ x: number; y: number; zoom: number; }>;
}

export function useCanvasSessionSync({ activeMemberIds, activePresenceInitialized, applyRemoteBoard, brainRunStartedAt, canEdit, clearPresence, currentGraph, currentSnapshot, currentUserId, cursorRef, edges, flowRef, followingUserId, hydrated, initialBuildOpen, initialBuildOpened, initialFocusId, isComposingPrompt, joinedCollaborator, lastSavedGraph, liveSocketRef, loadingSession, localBoardState, mobileViewportFitted, nodes, noteSaveState, pendingSave, persistSnapshot, persistence, presenceLive, presenceRef, receivePresence, revision, saveInFlight, selectedIds, sendPresence, sessionId, openApp, setCurrentUserId, setEdges, setJoinedCollaborator, setMembers, setNodes, setNotice, setPersistedObjectIds, setRealtimeState, setSelectedId, setTimeline, storageKey, t, thinking, timeline, title, viewportRef }: UseCanvasSessionSyncDeps) {
  useEffect(() => { currentGraph.current = JSON.stringify({ nodes, edges }); }, [edges, nodes]);

  // A persisted viewport is expressed in screen pixels, so restoring a camera
  // saved on desktop can put the useful part of the graph beyond a phone's
  // narrow viewport. Reframe once after hydration; subsequent pans and zooms
  // remain entirely under the user's control.
  useEffect(() => {
    if (loadingSession || mobileViewportFitted.current || !nodes.length || typeof window === 'undefined' || window.innerWidth > 760) return;
    const handle = window.setTimeout(() => {
      if (!flowRef.current) return;
      mobileViewportFitted.current = true;
      // A full desktop graph can otherwise shrink to an illegible thumbnail on
      // a phone. Keep objects readable and let the user pan to off-screen work.
      void flowRef.current.fitView({ padding: 0.18, minZoom: 0.62, maxZoom: 0.82, duration: 280 });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [loadingSession, nodes]);

  useEffect(() => {
    if (!initialFocusId || !nodes.some((node) => node.id === initialFocusId)) return;
    setSelectedId(initialFocusId);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [{ id: initialFocusId }], padding: 0.45, duration: 350 }), 0);
  }, [initialFocusId, nodes]);

  useEffect(() => {
    if (!initialBuildOpen || initialBuildOpened.current || !initialFocusId) return;
    const target = nodes.find((node) => node.id === initialFocusId && node.data.kind === 'build');
    if (!target) return;
    initialBuildOpened.current = true;
    openApp(target.id);
  }, [initialBuildOpen, initialFocusId, nodes, openApp]);

  /**
   * AUTOSAVE. Debounced 300ms behind the edit that triggered it.
   *
   * What is left here is the SCHEDULING and the React state the result lands in.
   * Everything that decides anything — has the board changed, is this retry the
   * same write, is `Session changed` a failure or a collaborator having saved
   * first — is `persistBoard` in `application/PersistCanvas.ts`, which is why the
   * conflict merge finally has a test that does not mount a canvas.
   */
  useEffect(() => {
    if (!hydrated.current || !canEdit) return;
    const handle = window.setTimeout(() => {
      const board = { nodes, edges };
      const signature = boardSignature(board);
      if (signature === lastSavedGraph.current) return;
      if (persistence === 'local') {
        const snapshot = currentSnapshot();
        persistSnapshot(snapshot);
        lastSavedGraph.current = signature;
        noteSaveState();
        return;
      }
      noteSaveState();
      saveInFlight.current = true;
      // STABLE across retries of the same board, NEW for a different one — so a
      // retry after a timeout is the same write and an edit made during it is not.
      pendingSave.current = saveAttemptKey(pendingSave.current, signature);
      const attempt = pendingSave.current;
      void persistBoard(
        { sessionId, board, viewport: viewportRef.current, expectedRevision: revision.current, idempotencyKey: attempt.key, signature },
        canvasSessionGateway,
        t,
      ).then((result) => {
        if (result.outcome === 'failed') { setNotice(result.notice); return; }
        revision.current = result.revision;
        lastSavedGraph.current = result.signature;
        setPersistedObjectIds(new Set(result.objectIds));
        if (pendingSave.current?.key === attempt.key) pendingSave.current = null;
        if (result.outcome === 'saved') { noteSaveState(); return; }
        setNodes(result.board.nodes);
        setEdges(result.board.edges);
        // A collaborator's board can carry a kind this build does not declare, and
        // the merge is the moment it arrives. Saying so here is the same promise
        // the initial load makes rather than a second, quieter rule for the same event.
        if (result.rejected.length) setNotice(t('objectsRejected', { count: result.rejected.length, kinds: rejectedObjectKinds(result.rejected) }));
        else setNotice(result.notice);
      }).finally(() => { saveInFlight.current = false; });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [canEdit, edges, nodes, noteSaveState, persistSnapshot, persistence, sessionId, setEdges, setNodes, setNotice, storageKey, t, timeline, title, viewportRef]);

  useEffect(() => {
    if (persistence !== 'local' || !hydrated.current) return;
    const handle = window.setTimeout(() => {
      const prior = readLocalCreationSession(sessionId); if (!prior) return;
      // `...prior` carries prior.title forward untouched — a rename now happens in
      // the session rail, not here, so this write must not overwrite it with the
      // stale copy this component hydrated `title` from.
      const snapshot: LocalCreationSnapshot = { ...prior, nodes, edges, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), viewport: viewportRef.current, updatedAt: new Date().toISOString() };
      persistSnapshot(snapshot);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [edges, nodes, persistence, sessionId, storageKey, timeline]);

  // The board-reconcile poll. Its load reads the CURRENT selection, composer state
  // and follow target at call time (the hook holds the latest closure), so a click
  // or a keystroke no longer tears the timer down and fires a round-trip.
  usePolledResource(async (signal) => {
      try {
        // The cursor is STILL written here, on purpose. The relay is what makes a
        // pointer live; this row is what makes it survive a client with no socket at
        // all (a blocked WebSocket behind a corporate proxy) — such a client is both
        // seen by everyone and able to see everyone, exactly as before, because the
        // merge simply has no live entry to prefer. And it costs nothing: this tick
        // already UPDATEs the row for `lastSeenAt`, which is what makes a member
        // count as active, so dropping one column out of a write that happens anyway
        // would have bought staleness rather than saved a write.
        const relayed = liveSocketRef.current?.readyState === WebSocket.OPEN;
        const presence = await creationSessionsApi.presence(sessionId, { revision: revision.current, viewport: viewportRef.current, cursor: cursorRef.current, selection: selectedIds, typing: isComposingPrompt, followingUserId });
        if (signal.aborted) return;
        const nextActiveIds = new Set(presence.members.map((member) => member.userId));
        if (activePresenceInitialized.current) {
          const joined = presence.members.find((member) => member.userId !== (presence.currentUserId || currentUserId) && !activeMemberIds.current.has(member.userId));
          if (joined) setJoinedCollaborator(joined);
        } else activePresenceInitialized.current = true;
        activeMemberIds.current = nextActiveIds;
        setMembers(presence.members);
        // Following is driven by the relay when it is up (see the follow effect);
        // this is the same move at poll speed for a client with no socket.
        const followed = relayed ? undefined : presence.members.find((member) => member.userId === followingUserId && member.viewport && typeof member.viewport.x === 'number' && typeof member.viewport.y === 'number' && typeof member.viewport.zoom === 'number');
        if (followed?.viewport) void flowRef.current?.setViewport({ x: Number(followed.viewport.x), y: Number(followed.viewport.y), zoom: Number(followed.viewport.zoom) }, { duration: 350 });
        if (presence.currentUserId) setCurrentUserId(presence.currentUserId);
        // The poll's own revision is the cheap probe; whether the board may
        // actually be replaced — and what happens to the objects this build
        // cannot render — belongs to `AdoptRemoteBoard`.
        if (presence.revision <= revision.current) return;
        const decision = await adoptRemoteBoard(sessionId, localBoardState(), canvasSessionGateway);
        if (signal.aborted) return;
        applyRemoteBoard(decision, t('noticeUpdatedByCollaborator'));
      } catch { /* Presence and polling are best-effort; local edits continue. */ }
  }, { intervalMs: 8_000, enabled: persistence === 'server', restartKey: sessionId });

  useEffect(() => {
    if (!joinedCollaborator) return;
    const timer = window.setTimeout(() => setJoinedCollaborator(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [joinedCollaborator]);

  useEffect(() => {
    if (persistence !== 'server') return;
    const liveUrl = creationSessionsApi.liveUrl(sessionId);
    if (!liveUrl) { setRealtimeState('offline'); return; }
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryMs = 1_000;
    const syncRevision = async (hint?: number) => {
      if (stopped) return;
      try {
        // `events` is this channel's cheap probe, exactly as the poll's payload is
        // the other channel's. Everything after it is the same act, and lives in
        // one place so the two doors cannot answer differently.
        const caughtUp = await creationSessionsApi.events(sessionId, revision.current);
        if (Math.max(Number(hint || 0), Number(caughtUp.revision || 0)) <= revision.current) return;
        const decision = await adoptRemoteBoard(sessionId, localBoardState(), canvasSessionGateway);
        if (stopped) return;
        applyRemoteBoard(decision, t('noticeUpdatedLive'));
      } catch { /* The presence reconciliation remains a durable fallback. */ }
    };
    const connect = () => {
      if (stopped) return;
      setRealtimeState(retryMs > 1_000 ? 'reconnecting' : 'connecting');
      try { socket = new WebSocket(liveUrl); } catch { socket = null; }
      if (!socket) {
        setRealtimeState('reconnecting');
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(15_000, retryMs * 2);
        return;
      }
      socket.onopen = () => {
        setRealtimeState('online');
        retryMs = 1_000;
        // Publishing the socket is what arms `sendPresence`; until this runs, the
        // pointer keeps riding the presence poll.
        liveSocketRef.current = socket;
        void syncRevision();
      };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as { type?: string; revision?: number; lastId?: number; action?: string; peer?: { id?: string } };
          if (frame.type === 'canvas.changed') void syncRevision(frame.revision);
          if (frame.type === 'timeline.changed') void creationSessionsApi.timeline.list(sessionId).then((result) => setTimeline(result.messages)).catch(() => undefined);
          // A peer's pointer at pointer speed, and the `leave` that retires it. Relayed
          // frames are attributed by the SERVER (`userId`), never by the sender — see
          // `SessionRoomDO`; the folding is `useLivePresence`'s, shared with the guest room.
          receivePresence(frame);
        } catch { /* Ignore malformed relay frames. */ }
      };
      socket.onclose = () => {
        if (liveSocketRef.current === socket) liveSocketRef.current = null;
        socket = null;
        // Nobody's pointer is live while this client is deaf; the poll takes over.
        clearPresence();
        if (!stopped) {
          setRealtimeState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting');
          retryTimer = window.setTimeout(connect, retryMs);
          retryMs = Math.min(15_000, retryMs * 2);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      liveSocketRef.current = null;
      // Drop the pending flush with the socket it was going to be written to.
      presenceRef.current?.dispose();
      socket?.close();
    };
  }, [clearPresence, persistence, receivePresence, sessionId, setEdges, setNodes]);

  /**
   * Composing a prompt is presence too — the cursor label says so. It changes at
   * human speed, so it is sent on the state change rather than throttled per frame.
   */
  useEffect(() => {
    if (!presenceLive) return;
    sendPresence({ typing: isComposingPrompt });
  }, [isComposingPrompt, presenceLive, sendPresence]);

  /**
   * A Brain turn in flight is presence too. The run executes in THIS browser, so
   * without announcing it everyone else on the board saw an idle Brain for the
   * minutes a long turn takes. Re-sent on a heartbeat because a still requester
   * sends nothing else and would otherwise expire off their screens mid-run — the
   * same beat also reaches a collaborator who joins after the turn began.
   */
  useEffect(() => {
    if (!presenceLive) return;
    const brainRun = thinking && brainRunStartedAt != null ? { startedAt: brainRunStartedAt } : null;
    sendPresence({ brainRun });
    if (!brainRun) return;
    const timer = window.setInterval(() => sendPresence({ brainRun }), BRAIN_RUN_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [brainRunStartedAt, presenceLive, sendPresence, thinking]);
}
