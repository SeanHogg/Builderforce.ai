/** Keeping the session in sync — saving, realtime, polled members and invitations. */
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useMemo, useRef } from 'react';
import { boardSignature } from '@/domains/canvas/application/PersistCanvas';
import type { BoardSession, BoardState } from '@/domains/canvas/infrastructure/localFirst/boardSession';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { usePolledResource } from '@/hooks/usePolledResource';
import { createReconnector, openSocket } from '@/lib/polling/reconnectPolicy';
import { createCoalescedRefresh } from '@/lib/polling/coalescedRefresh';
import { useLatestRef } from './useLatestRef';
import { fetchTimelineTail, mergeTimelineTail, timelineCursor } from './canvasTimelineTail';
import { useBoardOnScreen } from '@/lib/canvas/BoardOnScreenContext';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { BRAIN_RUN_HEARTBEAT_MS } from '@/lib/canvas/livePresence';
import { createPresenceTracker } from '@/lib/canvas/presenceDelta';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import { timelineToLocal } from '../localTimeline';
import type { PresenceRelay } from '@/domains/canvas/application/PresenceRelay';
import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';

type PresenceMember = Awaited<ReturnType<typeof creationSessionsApi.presence>>['members'][number];

export interface UseCanvasSessionSyncDeps {
  activeMemberIdsRef: RefObject<Set<string>>;
  activePresenceInitializedRef: RefObject<boolean>;
  /** The open board's session (created on the first commit when the device holds no board yet): the ONE writer of this board from this tab. */
  ensureBoardSession: (state: BoardState) => Promise<BoardSession>;
  brainRunStartedAt: number | null;
  canEdit: boolean;
  clearPresence: () => void;
  currentGraphRef: RefObject<string>;
  currentUserId: string | null;
  cursorRef: RefObject<{ x: number; y: number; } | null>;
  edges: Edge[];
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  followingUserId: string | null;
  hydratedRef: RefObject<boolean>;
  /** The surface the entry asked for — with `app` and a focused Builder object, that build opens in the App surface. */
  initialSurface: CanvasSurfaceId | undefined;
  initialFocusId: string | null | undefined;
  isComposingPrompt: boolean;
  joinedCollaborator: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; } | null;
  lastSavedGraphRef: RefObject<string>;
  liveSocketRef: RefObject<WebSocket | null>;
  loadingSession: boolean;
  mobileViewportFittedRef: RefObject<boolean>;
  nodes: CanvasObject[];
  noteSaveState: () => void;
  persistence: 'local' | 'server';
  presenceLive: boolean;
  presenceRelay: PresenceRelay;
  receivePresence: (frame: unknown) => void;
  /** Reconcile the replica with the server's newer board and show the result. */
  refreshFromServer: (notice: string) => Promise<void>;
  revisionRef: RefObject<number>;
  /** The server has this board: its presence poll and live room are worth opening. */
  serverReady: boolean;
  selectedIds: string[];
  sendPresence: (state: CanvasPresenceState) => void;
  sessionId: string;
  openApp: (nodeId: string) => void;
  setCurrentUserId: Dispatch<SetStateAction<string | null>>;
  setJoinedCollaborator: Dispatch<SetStateAction<{ userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; } | null>>;
  setMembers: Dispatch<SetStateAction<{ userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[]>>;
  setNotice: (text: string) => void;
  setRealtimeState: Dispatch<SetStateAction<'local' | 'connecting' | 'online' | 'reconnecting' | 'offline'>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setTimeline: Dispatch<SetStateAction<CanvasTimelineMessage[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  thinking: boolean;
  timeline: CanvasTimelineMessage[];
  viewportRef: RefObject<{ x: number; y: number; zoom: number; }>;
}

export function useCanvasSessionSync({ activeMemberIdsRef, activePresenceInitializedRef, ensureBoardSession, brainRunStartedAt, canEdit, clearPresence, currentGraphRef, currentUserId, cursorRef, edges, flowRef, followingUserId, hydratedRef, initialSurface, initialFocusId, isComposingPrompt, joinedCollaborator, lastSavedGraphRef, liveSocketRef, loadingSession, mobileViewportFittedRef, nodes, noteSaveState, persistence, presenceLive, presenceRelay, receivePresence, refreshFromServer, revisionRef, selectedIds, serverReady, sendPresence, sessionId, openApp, setCurrentUserId, setJoinedCollaborator, setMembers, setNotice, setRealtimeState, setSelectedId, setTimeline, t, thinking, timeline, viewportRef }: UseCanvasSessionSyncDeps) {
  useEffect(() => { currentGraphRef.current = JSON.stringify({ nodes, edges }); }, [currentGraphRef, edges, nodes]);

  // A persisted viewport is expressed in screen pixels, so restoring a camera
  // saved on desktop can put the useful part of the graph beyond a phone's
  // narrow viewport. Reframe once after hydration; subsequent pans and zooms
  // remain entirely under the user's control.
  useEffect(() => {
    if (loadingSession || mobileViewportFittedRef.current || !nodes.length || typeof window === 'undefined' || window.innerWidth > 760) return;
    const handle = window.setTimeout(() => {
      if (!flowRef.current) return;
      mobileViewportFittedRef.current = true;
      // A full desktop graph can otherwise shrink to an illegible thumbnail on
      // a phone. Keep objects readable and let the user pan to off-screen work.
      void flowRef.current.fitView({ padding: 0.18, minZoom: 0.62, maxZoom: 0.82, duration: 280 });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [flowRef, loadingSession, mobileViewportFittedRef, nodes]);

  useEffect(() => {
    if (!initialFocusId || !nodes.some((node) => node.id === initialFocusId)) return;
    setSelectedId(initialFocusId);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [{ id: initialFocusId }], padding: 0.45, duration: 350 }), 0);
  }, [flowRef, initialFocusId, nodes, setSelectedId]);

  // An entry that asked for the App surface AND focused a Builder object opens THAT build
  // there, once (`?surface=app&focus=<id>`, and the legacy `?build=1`).
  const focusedAppOpenedRef = useRef(false);
  const openFocusedApp = initialSurface === 'app' ? initialFocusId : null;
  useEffect(() => {
    if (!openFocusedApp || focusedAppOpenedRef.current) return;
    const target = nodes.find((node) => node.id === openFocusedApp && node.data.kind === 'build');
    if (!target) return;
    focusedAppOpenedRef.current = true;
    openApp(target.id);
  }, [nodes, openApp, openFocusedApp]);

  /**
   * AUTOSAVE. Debounced 300ms behind the edit that triggered it.
   *
   * One path, whoever the person is and whatever the network is doing: the board is committed to the
   * store through the open `BoardSession` — a per-object diff and its journal events in ONE
   * transaction — and the sync driver sends it when it can. A server that is down or a network that
   * is gone is a held count in the sync indicator, never a failed save. What is left here is the
   * SCHEDULING and the React state the result lands in; what a diff is, which writes are journaled
   * and what a conflict is live in `boardSession` / `boardCommit`.
   */
  useEffect(() => {
    if (!hydratedRef.current || !canEdit) return;
    const handle = window.setTimeout(() => {
      const signature = boardSignature({ nodes, edges });
      noteSaveState();
      const state: BoardState = { board: { nodes, edges }, timeline: timelineToLocal(timeline), viewport: viewportRef.current };
      void ensureBoardSession(state)
        .then((session) => session.commit(state))
        .then((result) => {
          lastSavedGraphRef.current = signature;
          if (result.conflicts.length > 0) setNotice(t('noticeConflictsHeld', { count: result.conflicts.length }));
          noteSaveState();
        })
        .catch((error: unknown) => {
          reportLocalFirstFailure('canvasAutosave', error);
          setNotice(t('noticeSaveFailed'));
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [ensureBoardSession, canEdit, edges, hydratedRef, lastSavedGraphRef, nodes, noteSaveState, setNotice, t, timeline, viewportRef]);

  /**
   * TRANSCRIPT ROWS ARE KEPT AT ONCE. A turn's reply is the one thing a person cannot redo, and it must
   * not wait on the board's debounce — nor on `canEdit`: a commenter's chat turns are theirs to keep.
   */
  useEffect(() => {
    if (!hydratedRef.current || timeline.length === 0) return;
    const state: BoardState = { board: { nodes, edges }, timeline: timelineToLocal(timeline), viewport: viewportRef.current };
    void ensureBoardSession(state)
      .then((session) => session.appendMessages(state.timeline))
      .catch((error: unknown) => reportLocalFirstFailure('canvasTimelineAppend', error));
  // The board in `state` is only what `ensureBoardSession` creates a missing board from.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureBoardSession, hydratedRef, timeline]);

  // A kept board off stage (or the last board held behind a full-screen route) is
  // not being looked at: it must not announce presence, nor keep the API awake.
  // Coming back on screen restarts the poll with its immediate tick.
  const onScreen = useBoardOnScreen();
  // The roster between presence ticks: each answer carries only the members whose
  // drawn presence changed (`lib/canvas/presenceDelta`). One per board.
  const presenceTracker = useMemo(() => createPresenceTracker<PresenceMember>(), []);
  useEffect(() => { presenceTracker.reset(); }, [presenceTracker, sessionId]);

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
        const answer = await creationSessionsApi.presence(sessionId, { revision: revisionRef.current, viewport: viewportRef.current, cursor: cursorRef.current, selection: selectedIds, typing: isComposingPrompt, followingUserId, known: presenceTracker.known() });
        if (signal.aborted) return;
        const presence = { ...answer, members: presenceTracker.apply(answer) };
        const nextActiveIds = new Set(presence.members.map((member) => member.userId));
        if (activePresenceInitializedRef.current) {
          const joined = presence.members.find((member) => member.userId !== (presence.currentUserId || currentUserId) && !activeMemberIdsRef.current.has(member.userId));
          if (joined) setJoinedCollaborator(joined);
        } else activePresenceInitializedRef.current = true;
        activeMemberIdsRef.current = nextActiveIds;
        setMembers(presence.members);
        // Following is driven by the relay when it is up (see the follow effect);
        // this is the same move at poll speed for a client with no socket.
        const followed = relayed ? undefined : presence.members.find((member) => member.userId === followingUserId && member.viewport && typeof member.viewport.x === 'number' && typeof member.viewport.y === 'number' && typeof member.viewport.zoom === 'number');
        if (followed?.viewport) void flowRef.current?.setViewport({ x: Number(followed.viewport.x), y: Number(followed.viewport.y), zoom: Number(followed.viewport.zoom) }, { duration: 350 });
        if (presence.currentUserId) setCurrentUserId(presence.currentUserId);
        // The poll's own revision is the cheap probe; whether the board may
        // actually be replaced — and what happens to the objects this build
        // cannot render — belongs to `AdoptRemoteBoard`.
        if (presence.revision <= revisionRef.current) return;
        await refreshFromServer(t('noticeUpdatedByCollaborator'));
      } catch (error) {
        // Presence and polling are best-effort and local edits continue — but an online failure is a fact
        // (offline, the poll failing is the expected shape of the outage, not a report per tick).
        if (typeof navigator === 'undefined' || navigator.onLine !== false) reportLocalFirstFailure('canvasPresencePoll', error);
      }
  }, { intervalMs: 8_000, enabled: persistence === 'server' && serverReady && onScreen, restartKey: sessionId });

  useEffect(() => {
    if (!joinedCollaborator) return;
    const timer = window.setTimeout(() => setJoinedCollaborator(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [joinedCollaborator, setJoinedCollaborator]);

  // The live socket reads the held timeline for its `after` cursor without
  // re-opening the socket every time a message lands.
  const timelineLatest = useLatestRef(timeline);
  useEffect(() => {
    if (persistence !== 'server' || !serverReady) return;
    const liveUrl = creationSessionsApi.liveUrl(sessionId);
    if (!liveUrl) { setRealtimeState('offline'); return; }
    let stopped = false;
    let socket: WebSocket | null = null;
    let attempted = false;
    const syncRevision = async (hint?: number) => {
      if (stopped) return;
      try {
        // `events` is this channel's cheap probe, exactly as the poll's payload is
        // the other channel's. Everything after it is the same act, and lives in
        // one place so the two doors cannot answer differently.
        const caughtUp = await creationSessionsApi.events(sessionId, revisionRef.current);
        if (Math.max(Number(hint || 0), Number(caughtUp.revision || 0)) <= revisionRef.current) return;
        await refreshFromServer(t('noticeUpdatedLive'));
      } catch (error) {
        // The presence reconciliation remains a durable fallback; the failure is still reported.
        if (typeof navigator === 'undefined' || navigator.onLine !== false) reportLocalFirstFailure('canvasLiveRevision', error);
      }
    };
    // Frames arrive in bursts (a Brain turn writes many rows, a drag saves many
    // revisions); each burst is ONE read, never two in flight. The hints carry the
    // highest revision / timeline id announced, so this client's own writes echoed
    // back cost nothing.
    let revisionHint = 0;
    const boardRefresh = createCoalescedRefresh(async () => {
      const hint = revisionHint;
      revisionHint = 0;
      if (hint && hint <= revisionRef.current) return;
      await syncRevision(hint);
    });
    let timelineHint = 0;
    const timelineRefresh = createCoalescedRefresh(async () => {
      const after = timelineCursor(timelineLatest.current);
      const hint = timelineHint;
      timelineHint = 0;
      if (hint && hint <= after) return;
      const rows = await fetchTimelineTail(sessionId, after);
      if (!stopped && rows.length) setTimeline((current) => mergeTimelineTail(current, rows));
    });
    const reconnector = createReconnector({
      baseMs: 1_000,
      maxMs: 15_000,
      onRetryScheduled: () => setRealtimeState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting'),
      onGiveUp: () => setRealtimeState('offline'),
      connect: () => {
        setRealtimeState(attempted ? 'reconnecting' : 'connecting');
        attempted = true;
        const opened = openSocket(liveUrl);
        if (!opened) { reconnector.closed(); return; }
        socket = opened;
        opened.onopen = () => {
          reconnector.opened();
          setRealtimeState('online');
          // Publishing the socket is what arms `sendPresence`; until this runs, the
          // pointer keeps riding the presence poll.
          liveSocketRef.current = opened;
          void syncRevision();
        };
        opened.onmessage = (event) => {
          try {
            const frame = JSON.parse(String(event.data)) as { type?: string; revision?: number; lastId?: number; action?: string; peer?: { id?: string } };
            if (frame.type === 'canvas.changed') { revisionHint = Math.max(revisionHint, Number(frame.revision || 0)); boardRefresh.trigger(); }
            if (frame.type === 'timeline.changed') { timelineHint = Math.max(timelineHint, Number(frame.lastId || 0)); timelineRefresh.trigger(); }
            // A peer's pointer at pointer speed, and the `leave` that retires it. Relayed
            // frames are attributed by the SERVER (`userId`), never by the sender — see
            // `SessionRoomDO`; the folding is `useLivePresence`'s, shared with the guest room.
            receivePresence(frame);
          } catch { /* Ignore malformed relay frames. */ }
        };
        opened.onclose = (event) => {
          if (liveSocketRef.current === opened) liveSocketRef.current = null;
          if (socket === opened) socket = null;
          // Nobody's pointer is live while this client is deaf; the poll takes over.
          clearPresence();
          if (!stopped) reconnector.closed(event?.code);
        };
      },
    });
    reconnector.start();
    return () => {
      stopped = true;
      reconnector.stop();
      boardRefresh.cancel();
      timelineRefresh.cancel();
      liveSocketRef.current = null;
      // Drop the pending flush with the socket it was going to be written to.
      presenceRelay.dispose();
      socket?.close();
    };
  }, [clearPresence, liveSocketRef, persistence, presenceRelay, receivePresence, refreshFromServer, revisionRef, serverReady, sessionId, setRealtimeState, setTimeline, t, timelineLatest]);

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
