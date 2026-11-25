/**
 * Opening the board and keeping what is on screen the board the store holds.
 *
 * ONE path (studio-local-first design §2): the board opens from the device's replica at once, and
 * when it has a server behind it the same open reconciles with that server in the background — the
 * replica is what is rendered, so a server that is down or a network that is gone never shows
 * "load failed" over a board the device holds. The reads and writes themselves are `boardOpen`,
 * `boardSession` and `boardCommit`; this hook only puts their results into React state.
 */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRef } from './useLatestRef';
import { normalizeChatMode } from '@/lib/brain';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { type CreationSessionDetail, creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { rejectedObjectKinds } from '../canvasBoardLoad';
import { faultText } from '@/lib/apiClient';
import { boardSignature } from '@/domains/canvas/application/PersistCanvas';
import { useBoardOnScreen } from '@/lib/canvas/BoardOnScreenContext';
import type { CanvasBoard } from '@/domains/canvas/domain/canvasBoard';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import { timelineFromLocal } from '../localTimeline';
import { drainSessionBoardWrites } from '../sessionBoardWriters';
import { mergeTimelineTail } from './canvasTimelineTail';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { getStudioRuntime, studioDestination, type StudioRuntime } from '@/lib/localFirst/studioRuntime';
import { hydrateBoardMedia } from '@/domains/canvas/infrastructure/localFirst/boardMediaUrls';
import { captureBoardConflicts, listBoardConflicts } from '@/domains/canvas/infrastructure/localFirst/boardConflicts';
import { reconcileBoard, type BoardOpenOptions, type ReconcileOutcome } from '@/domains/canvas/infrastructure/localFirst/boardOpen';
import { readBoard, type BoardReplica } from '@/domains/canvas/infrastructure/localFirst/boardReplica';
import { isBoardAccepted } from '@/domains/canvas/infrastructure/localFirst/boardSyncOutcome';
import { openBoardSession, setOnScreenBoard, onScreenBoardId, type BoardSession, type BoardState } from '@/domains/canvas/infrastructure/localFirst/boardSession';
import { createRestBoardSource } from '@/domains/canvas/infrastructure/localFirst/restBoardSource';
import { storedTimelineOf } from '@/domains/canvas/infrastructure/localFirst/studioBoards';
import { awaitBoardCreated, updateLocalCreationSession, writeLocalCreationSession } from '@/lib/pendingWork';
import type { useTranslations } from 'next-intl';

export interface UseBoardOpenDeps {
  commitRevision: (revision: number) => void;
  currentGraphRef: RefObject<string>;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  hydratedRef: RefObject<boolean>;
  lastSavedGraphRef: RefObject<string>;
  noteSaveState: () => void;
  /** Told ONCE, with the board as it loaded (local snapshot or server copy) — never on later edits.
   *  The loader is the one place that knows when "the board" stops meaning the starter. */
  onBoardLoaded: (nodes: readonly CanvasObject[]) => void;
  pendingViewportRef: RefObject<{ x: number; y: number; zoom: number; } | null>;
  persistence: 'local' | 'server';
  sessionId: string;
  sessionOpenCorrelationRef: RefObject<string>;
  setAllMembers: Dispatch<SetStateAction<{ userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[]>>;
  setBranchParentId: Dispatch<SetStateAction<string | null>>;
  setCurrentUserId: Dispatch<SetStateAction<string | null>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
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
  viewportRef: RefObject<{ x: number; y: number; zoom: number; }>;
}

export function useBoardOpen({ commitRevision, currentGraphRef, flowRef, hydratedRef, lastSavedGraphRef, noteSaveState, onBoardLoaded, pendingViewportRef, persistence, sessionId, sessionOpenCorrelationRef, setAllMembers, setBranchParentId, setCurrentUserId, setEdges, setLoadingSession, setMembers, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setSelectedIds, setSessionMode_, setSessionRole, setTimeline, setTitle, t, viewportRef }: UseBoardOpenDeps) {
  /**
   * The board AS LOADED is on screen — STATE, not `hydratedRef`, because something has to
   * re-render on it: the entry app (`useCanvasEntryApp`) may only decide "this board has no
   * app" about the loaded board, never about the starter seed that precedes it. Set in the
   * same commit as the loaded nodes, so the first render that sees `true` sees them too.
   */
  const [boardLoaded, setBoardLoaded] = useState(false);
  /** The server has this board (it was seeded from it, or has accepted it): server-only calls may be made. */
  const [serverReady, setServerReady] = useState(false);
  /** This tab's open board (`boardSession`): what autosave commits through. */
  const boardSessionRef = useRef<BoardSession | null>(null);
  /**
   * A turn that outlived an earlier instance of this board wrote while no board was on
   * screen (`sessionBoardWriters`). Replayed only once the load has COMMITTED, so it lands
   * on top of the loaded board instead of being overwritten by it, and the next autosave
   * keeps it.
   */
  useEffect(() => { if (boardLoaded) drainSessionBoardWrites(sessionId); }, [boardLoaded, sessionId]);

  // Media added through a bare `File` (`storeCanvasMedia`) belongs to the board the person is looking at.
  const onScreen = useBoardOnScreen();
  useEffect(() => {
    if (!onScreen) return undefined;
    setOnScreenBoard(sessionId);
    return () => { if (onScreenBoardId() === sessionId) setOnScreenBoard(null); };
  }, [onScreen, sessionId]);

  /** The server's facts about this SESSION (role, roster, personal camera) — not board records. */
  const applyServerDetail = useCallback((detail: CreationSessionDetail, placeViewport: boolean) => {
    setBranchParentId(detail.session.branchParentSessionId ?? null);
    setPersistedObjectIds(new Set(detail.objects.map((object) => object.id)));
    setMembers(detail.members);
    setAllMembers(detail.members);
    setCurrentUserId(detail.currentUserId || null);
    const known = new Set(detail.objects.map((object) => object.id));
    const personalSelection = detail.members.find((member) => member.userId === detail.currentUserId)?.selection?.filter((id) => known.has(id)) ?? [];
    setSelectedIds(personalSelection);
    setSelectedId(personalSelection.length === 1 ? personalSelection[0]! : null);
    setSessionRole(detail.role);
    // Kept with the replica: a viewer who opens this board offline must not be offered an editor's board.
    void updateLocalCreationSession(sessionId, { role: detail.role }).catch((error: unknown) => reportLocalFirstFailure('useBoardOpen.role', error));
    const camera = detail.personalViewport;
    if (placeViewport && camera && typeof camera.x === 'number' && typeof camera.y === 'number' && typeof camera.zoom === 'number') {
      const restored = { x: camera.x, y: camera.y, zoom: camera.zoom };
      viewportRef.current = restored;
      pendingViewportRef.current = restored;
      void flowRef.current?.setViewport(restored);
    }
    commitRevision(detail.session.canvasRevision ?? detail.session.revision ?? 1);
  }, [commitRevision, flowRef, pendingViewportRef, setAllMembers, setBranchParentId, setCurrentUserId, setMembers, setPersistedObjectIds, setSelectedId, setSelectedIds, setSessionRole, sessionId, viewportRef]);
  const applyServerDetailRef = useLatestRef(applyServerDetail);

  /** The page's own copy of a board: `media:<id>` → the object URL of its bytes. */
  const renderable = useCallback((runtime: StudioRuntime, board: CanvasBoard): Promise<CanvasBoard> => hydrateBoardMedia(runtime.blobs, board), []);

  /** The server, when this board has one and it is reachable — a board the server has never heard of has nothing to reconcile with. */
  const reconcileOptions = useCallback(async (runtime: StudioRuntime, replica: BoardReplica | undefined, placeViewport: boolean): Promise<BoardOpenOptions> => {
    const destination = studioDestination();
    const serverBacked = persistence === 'server' && (!replica || (destination.kind === 'bound' && await isBoardAccepted(runtime.store, sessionId, destination)));
    setServerReady(serverBacked);
    return {
      store: runtime.store,
      destination,
      ...(serverBacked ? { source: createRestBoardSource({
        onDetail: (detail) => applyServerDetailRef.current(detail, placeViewport),
        onSnapshot: (snapshot) => captureBoardConflicts(runtime.store, snapshot),
      }) } : {}),
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    };
  }, [applyServerDetailRef, persistence, sessionId]);

  /** Put a replica's board on screen — the whole of it, title and mode and transcript included. */
  const showReplica = useCallback((replica: BoardReplica, board: CanvasBoard): CanvasBoard => {
    const header = replica.header.payload;
    setTitle(header.title);
    setNodes(board.nodes);
    setEdges(board.edges);
    setTimeline((current) => mergeTimelineTail(current, timelineFromLocal(storedTimelineOf(replica))));
    // The mode a person armed (a guest in the homepage composer) rides on the board itself.
    setSessionMode_(normalizeChatMode(header.mode));
    if (header.role) setSessionRole(header.role);
    if (header.branchParentId) setBranchParentId(header.branchParentId);
    if (replica.rejected.length) setNotice(t('objectsRejected', { count: replica.rejected.length, kinds: rejectedObjectKinds(replica.rejected) }));
    if (replica.serverRevision !== undefined) commitRevision(replica.serverRevision);
    lastSavedGraphRef.current = boardSignature(board);
    currentGraphRef.current = lastSavedGraphRef.current;
    return board;
  }, [commitRevision, currentGraphRef, lastSavedGraphRef, setBranchParentId, setEdges, setNodes, setNotice, setSessionMode_, setSessionRole, setTimeline, setTitle, t]);

  /** What a reconcile brought: the server's board (this device's unsent edits laid over it) replaces what is shown. */
  const applyOutcome = useCallback(async (runtime: StudioRuntime, outcome: ReconcileOutcome, notice: string | null): Promise<boolean> => {
    if (outcome.kind === 'offline' || outcome.kind === 'current') return false;
    // Two writers touched the same object: the person's own value stays on screen until they choose.
    if ((await listBoardConflicts(runtime.store, sessionId)).length > 0) return false;
    const shown = await renderable(runtime, outcome.rebased ?? outcome.replica.board);
    // The session diffs from what the STORE holds; the screen shows `shown`, and the next autosave writes any difference.
    boardSessionRef.current?.rebase(outcome.replica);
    const stored = await renderable(runtime, outcome.replica.board);
    showReplica(outcome.replica, shown);
    lastSavedGraphRef.current = boardSignature(stored);
    if (notice && outcome.rejected.length === 0) setNotice(notice);
    return true;
  }, [lastSavedGraphRef, renderable, sessionId, setNotice, showReplica]);

  useEffect(() => {
    let cancelled = false;
    const openedAt = performance.now();
    // Telemetry about the SERVER's answer: only when the server was asked and the network is up — an
    // offline open is not an outage worth a request, or a report, per board.
    const record = (phase: 'succeeded' | 'failed') => {
      if (persistence !== 'server' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelationRef.current, action: 'session.open', phase, durationMs: performance.now() - openedAt })
        .catch((error: unknown) => reportLocalFirstFailure('useCanvasSession.recordOutcome', error));
    };
    void (async () => {
      const runtime = await getStudioRuntime();
      if (cancelled) return;
      if (!runtime) {
        // Durable or visible, never fake: nothing on screen may claim to be saved where it is not.
        setNotice(t('noticeStorageUnavailable'));
        setLoadingSession(false);
        return;
      }
      await awaitBoardCreated(sessionId);
      const replica = await readBoard(runtime.store, sessionId);
      if (cancelled) return;
      let hadViewport = false;
      if (replica) {
        // One synchronous block: the board, its title and the loaded flags land in the SAME render.
        const board = showReplica(replica, await renderable(runtime, replica.board));
        if (cancelled) return;
        const viewport = replica.header.payload.viewport;
        if (viewport) { hadViewport = true; viewportRef.current = viewport; pendingViewportRef.current = viewport; void flowRef.current?.setViewport(viewport); }
        boardSessionRef.current?.dispose();
        boardSessionRef.current = openBoardSession(runtime.ctx, replica);
        onBoardLoaded(board.nodes);
        setBoardLoaded(true);
        hydratedRef.current = true;
        setLoadingSession(false);
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: canvasSurface(), persistence } });
        noteSaveState();
      }
      const outcome = await reconcileBoard(await reconcileOptions(runtime, replica, !hadViewport), sessionId, replica);
      if (cancelled) return;
      if (replica) {
        await applyOutcome(runtime, outcome, null);
        if (outcome.kind !== 'offline') record('succeeded');
        return;
      }
      if (outcome.kind === 'seeded') {
        // First open of a server board on this device: it is seeded into the store, then shown.
        const seeded = await readBoard(runtime.store, sessionId);
        if (cancelled || !seeded) return;
        const board = showReplica(seeded, await renderable(runtime, seeded.board));
        boardSessionRef.current?.dispose();
        boardSessionRef.current = openBoardSession(runtime.ctx, seeded);
        onBoardLoaded(board.nodes);
        setBoardLoaded(true);
        hydratedRef.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [...new Set(board.nodes.map((node) => node.data.kind))] } });
        record('succeeded');
        noteSaveState();
      } else if (persistence === 'local') {
        // A guest's board nobody has written yet (an id typed or bookmarked): the starter board stays.
        onBoardLoaded([]);
        setBoardLoaded(true);
        hydratedRef.current = true;
      } else {
        record('failed');
        // Never opened on this device and the server is out of reach: say so; nothing is on screen to lose.
        setNotice(faultText(outcome.kind === 'offline' && outcome.error ? new Error(outcome.error) : new Error('load'), t('noticeLoadSessionFailed')));
      }
      setLoadingSession(false);
    })().catch((error: unknown) => {
      reportLocalFirstFailure('useCanvasSession.open', error);
      record('failed');
      setNotice(faultText(error, t('noticeLoadSessionFailed')));
      setLoadingSession(false);
    });
    return () => { cancelled = true; boardSessionRef.current?.dispose(); boardSessionRef.current = null; };
  // The open runs once per board: its callbacks are read through refs or are stable setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /**
   * The server has a newer board than the one on screen (the presence poll or the live room said
   * so): reconcile the replica with it and show the result. A refusal is silent on purpose — "your
   * unsent edits kept a newer board out" is not something to interrupt someone with: unsent edits are
   * rebased over the server's board, never refused.
   */
  const refreshFromServer = useCallback(async (notice: string): Promise<void> => {
    const runtime = await getStudioRuntime();
    if (!runtime) return;
    const replica = await readBoard(runtime.store, sessionId);
    if (!replica) return;
    const outcome = await reconcileBoard(await reconcileOptions(runtime, replica, false), sessionId, replica);
    await applyOutcome(runtime, outcome, notice);
  }, [applyOutcome, reconcileOptions, sessionId]);

  /**
   * Another TAB of this browser changed this board (or the upload queue rewrote a url): the store is
   * the truth, so what is on screen follows it — but never over edits this tab has not written yet.
   */
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    let timer: number | undefined;
    void getStudioRuntime().then((runtime) => {
      if (cancelled || !runtime) return;
      unsubscribe = runtime.store.subscribe(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          // The server accepting the board is what makes its server-only calls (presence, live room) worth making.
          const destination = studioDestination();
          if (persistence === 'server' && destination.kind === 'bound') {
            void isBoardAccepted(runtime.store, sessionId, destination).then((accepted) => { if (accepted && !cancelled) setServerReady(true); })
              .catch((error: unknown) => reportLocalFirstFailure('useBoardOpen.accepted', error));
          }
          const session = boardSessionRef.current;
          if (!session || session.busy() || currentGraphRef.current !== lastSavedGraphRef.current) return;
          void readBoard(runtime.store, sessionId).then(async (replica) => {
            if (cancelled || !replica || !session.changedExternally(replica)) return;
            if ((await listBoardConflicts(runtime.store, sessionId)).length > 0) return;
            session.rebase(replica);
            showReplica(replica, await renderable(runtime, replica.board));
          }).catch((error: unknown) => reportLocalFirstFailure('useCanvasSession.follow', error));
        }, 150);
      });
    });
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [currentGraphRef, lastSavedGraphRef, persistence, renderable, sessionId, showReplica]);

  /**
   * The board this tab has open but the device does not hold yet — a create that failed, a room joiner's
   * first board, a link whose import failed. The first commit CREATES it (the old store wrote a board
   * whole on its first save), then the session takes over; a create that fails again is the caller's
   * to tell the person about.
   */
  const ensureBoardSession = useCallback(async (state: BoardState): Promise<BoardSession> => {
    const existing = boardSessionRef.current;
    if (existing) return existing;
    const runtime = await getStudioRuntime();
    if (!runtime) throw new Error('studio_storage_unavailable');
    await writeLocalCreationSession(sessionId, { nodes: state.board.nodes, edges: state.board.edges, timeline: state.timeline, ...(state.viewport ? { viewport: state.viewport } : {}) });
    const replica = await readBoard(runtime.store, sessionId);
    if (!replica) throw new Error('board_not_created');
    const session = boardSessionRef.current ?? openBoardSession(runtime.ctx, replica);
    boardSessionRef.current = session;
    return session;
  }, [sessionId]);

  return { boardLoaded, boardSessionRef, ensureBoardSession, refreshFromServer, serverReady };
}
