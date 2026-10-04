/** The Brain's surface on this board — placement, messages, roster, room speech and the surface context value. */
import { type BrainDockMode, type BrainDockPreferences, brainDockReservedWidth } from '../brainDockPreferences';
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { boardAgentOccupants, boardAgents } from '@/lib/canvas/boardAgents';
import { roomSpeech } from '@/lib/canvas/roomSpeech';
import { useCanvasBoardBridgeFor } from '../canvasBoardBridge';
import type { CanvasSpacePresenceValue } from '../canvasSpacePresence';
import { type LivePresenceEntry, peerBrainRuns } from '@/lib/canvas/livePresence';
import { type CreationSessionSummary, llmApi } from '@/lib/builderforceApi';
import type { GuestSignupPrompt } from '@/components/GuestSignupCta';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { useBrainUnreadReplies } from '../useBrainUnreadReplies';
import type { BrainSurfaceContextValue } from '../brainSurfaceContext';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasSurfaceDef } from '@/lib/canvasSurfaces';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { SharedCanvasRoom } from '@/domains/canvas/presentation/useSharedCanvasRoom';
import type { useTranslations } from 'next-intl';
import type { CardActBoardBinding } from '../cardActRunner';
import type { CreationNodeData } from '../types';
import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import type { GuestLimitRefusal } from '@/lib/guestLimit';
import type { Edge } from '@xyflow/react';

export interface UseCanvasBrainSurfaceDeps {
  activeAgentIds: Set<string>;
  brainDock: BrainDockPreferences;
  brainRunStartedAt: number | null;
  brainTrace: BrainTraceEvent[];
  cardActBoard: CardActBoardBinding;
  cardsEditable: boolean;
  currentUserId: string | null;
  deleteObjects: (ids: readonly string[]) => void;
  edges: Edge[];
  evermindProjectId: number | null;
  guestLimit: GuestLimitRefusal | null;
  inRoom: boolean;
  joinedCollaborator: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; } | null;
  liveMembers: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  livePresence: Readonly<Record<string, LivePresenceEntry>>;
  members: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  nodes: CanvasObject[];
  openBrainDock: () => void;
  persistence: 'local' | 'server';
  presenceSelfId: string | null;
  presentMode: boolean;
  sendPresence: (state: CanvasPresenceState) => void;
  sessionId: string;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  sharedRoom: SharedCanvasRoom;
  startCanvasTurnRef: RefObject<(text?: string) => void>;
  surfaceDef: CanvasSurfaceDef;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  thinking: boolean;
  timeline: CanvasTimelineMessage[];
  title: string;
  updateBrainDock: (patch: Partial<BrainDockPreferences>, persist?: boolean) => void;
  updateNodeData: (nodeId: string, patch: Partial<CreationNodeData>) => void;
}

export function useCanvasBrainSurface({ activeAgentIds, brainDock, brainRunStartedAt, brainTrace, cardActBoard, cardsEditable, currentUserId, deleteObjects, edges, evermindProjectId, guestLimit, inRoom, joinedCollaborator, liveMembers, livePresence, members, nodes, openBrainDock, persistence, presenceSelfId, presentMode, sendPresence, sessionId, setSelectedId, setSelectedIds, sharedRoom, startCanvasTurnRef, surfaceDef, t, thinking, timeline, title, updateBrainDock, updateNodeData }: UseCanvasBrainSurfaceDeps) {
  const brainNode = nodes.find((node) => node.data.kind === 'chat') ?? null;
  /**
   * Where the ONE Brain surface actually renders.
   *
   * Inline means "inside the Brain Object on the graph" — and every surface but the
   * board replaces the flat view rather than floating over it, so while one is up there
   * is no Object to render into and an inline Brain simply vanished: no transcript, no
   * tabs, no controls, and nothing on screen offering a way back to it. A boardless
   * surface therefore places Brain on the edge, which is the placement that survives
   * losing the board. The stored preference is untouched, so coming back to the board
   * puts Brain back in its Object.
   *
   * The exception is the surface that IS the conversation: it renders the transcript
   * itself, so the edge dock stands down entirely rather than putting the same live
   * conversation on screen twice — see `brainIsSurface` below.
   */
  const brainPlacement: BrainDockMode = surfaceDef.showsBoard ? brainDock.mode : 'docked';
  // An inline Brain IS an Object on the board, so only a docked one is reserved.
  const brainDockReserved = brainDockReservedWidth({ ...brainDock, mode: brainPlacement });
  const brainMessages = useMemo<BrainMessage[]>(() => timeline.map((message, index) => ({
    id: index + 1,
    seq: index + 1,
    role: message.messageRole,
    content: message.body,
    metadata: message.metadata?.authoredBy ? JSON.stringify({ authoredBy: message.metadata.authoredBy }) : null,
    createdAt: message.createdAt,
  })), [timeline]);

  /**
   * WHO IS HERE — the one roster, read by the command bar's collapsed cluster AND
   * the chat surface's header. A shared free session's roster is REAL members; a
   * local one falls back to the room's live guests, then to just "you". Computed
   * once so both surfaces can never show a different answer to the same question.
   */
  const rosterMembers = useMemo(
    () => (persistence !== 'local'
      ? members
      : inRoom && sharedRoom.roster.length
        ? sharedRoom.roster
        : [{ userId: 'local', displayName: t('you'), role: 'owner' as const }]),
    [inRoom, members, persistence, sharedRoom.roster, t],
  );
  /**
   * Which roster row is the viewer — the same three branches `rosterMembers` takes.
   * A local canvas's lone row is `local`, not an account id; a shared guest room
   * answers for its own rows (`sharedRoom.selfId` — the one row wearing this
   * browser's name, and nobody when two guests chose the same name).
   */
  const rosterSelfId = useMemo(() => {
    if (persistence !== 'local') return currentUserId;
    if (rosterMembers.length === 1 && rosterMembers[0]!.userId === 'local') return 'local';
    return sharedRoom.selfId;
  }, [currentUserId, persistence, rosterMembers, sharedRoom.selfId]);

  /**
   * WHO IS WORKING ON THIS BOARD — the agent cards on it, read once (`boardAgents`).
   * The bar's team strip rings those seats and the room stands them at the table, so
   * the board, the strip and the room give one answer.
   */
  const seatedAgents = useMemo(() => boardAgents(nodes), [nodes]);
  const roomOccupants = useMemo(
    () => [...rosterMembers, ...boardAgentOccupants(seatedAgents)],
    [rosterMembers, seatedAgents],
  );
  // What each agent at the table is saying this turn, drawn over its head in the room.
  const roomSpeechBySeat = useMemo(
    () => roomSpeech(timeline, seatedAgents, activeAgentIds),
    [activeAgentIds, seatedAgents, timeline],
  );
  // A room speech bubble asked to show the full reply. Nonce so a second click on
  // the same bubble still jumps; the dock may already be open on that turn.
  const [brainReveal, setBrainReveal] = useState<{ id: number; nonce: number } | null>(null);
  const revealSpeechInChat = useCallback((messageId: number) => {
    openBrainDock();
    setBrainReveal((current) => ({ id: messageId, nonce: (current?.nonce ?? 0) + 1 }));
  }, [openBrainDock]);
  // The board as the room's stations and a framed third-party widget read and edit it.
  const boardBridge = useCanvasBoardBridgeFor({ sessionId, title, persistence, objects: nodes, act: cardActBoard, patch: cardsEditable ? updateNodeData : null, remove: cardsEditable ? deleteObjects : null, selfId: rosterSelfId, occupants: roomOccupants });
  // Who is walking which space — a level played in the room, a game on its own surface.
  // Published once, read by any walker by object id (`useSpacePresence`).
  const spacePresence = useMemo<CanvasSpacePresenceValue>(
    () => ({ live: livePresence, selfId: rosterSelfId, members: rosterMembers, send: sendPresence }),
    [livePresence, rosterMembers, rosterSelfId, sendPresence],
  );

  const brainSurfaceOpen = !presentMode && brainDock.open;
  /**
   * Brain turns a COLLABORATOR started. Every Brain surface narrates one — the
   * thinking animation and its elapsed clock — so the whole board sees Brain
   * working, not just the person who asked. This viewer's own run wins when there
   * is one: it is the one carrying the trace and the Stop.
   */
  // `peerBrainRuns` clamps a peer's start to this browser's clock (a peer whose clock runs
  // ahead must not show a negative elapsed time). The clock is read OFF the render path,
  // once per change to the set of peer runs — not once per cursor frame — and until it
  // has been read for the current set the starts are shown as sent.
  const peerRunsKey = useMemo(() => peerBrainRuns(livePresence, presenceSelfId, Infinity).map((run) => `${run.userId}:${run.startedAt}`).join('|'), [livePresence, presenceSelfId]);
  const [peerRunsClock, setPeerRunsClock] = useState<{ key: string; at: number }>({ key: '', at: Infinity });
  useEffect(() => {
    if (peerRunsClock.key === peerRunsKey) return;
    const handle = window.setTimeout(() => setPeerRunsClock({ key: peerRunsKey, at: Date.now() }), 0);
    return () => window.clearTimeout(handle);
  }, [peerRunsClock.key, peerRunsKey]);
  const peerRunsNow = peerRunsClock.key === peerRunsKey ? peerRunsClock.at : Infinity;
  const peerRuns = useMemo(() => peerBrainRuns(livePresence, presenceSelfId, peerRunsNow), [livePresence, peerRunsNow, presenceSelfId]);
  const peerRunStartedAt = peerRuns[0]?.startedAt ?? null;
  const brainRunning = thinking || peerRunStartedAt !== null;
  const brainRunShownStartedAt = thinking ? brainRunStartedAt : peerRunStartedAt;
  // Read off the LIVE roster, so "is writing" and "asked Brain" move at relay speed
  // rather than waiting for the next presence poll.
  const brainCollaborators = useMemo(() => {
    const asking = new Set(peerRuns.map((run) => run.userId));
    return liveMembers
      .filter((member) => member.userId !== presenceSelfId)
      .map((member) => (asking.has(member.userId) ? { ...member, askingBrain: true } : member));
  }, [liveMembers, peerRuns, presenceSelfId]);
  /**
   * "Send again" on a transcript message — the same path a typed prompt takes, so a
   * replay is scoped, queued and narrated identically to the original turn. Read
   * through the ref so the callback identity never changes: <BrainTimeline> is
   * memoized, and a fresh closure here would re-parse the whole transcript per token.
   */
  const replayBrainMessage = useCallback((message: BrainMessage) => {
    startCanvasTurnRef.current(message.content);
  }, [startCanvasTurnRef]);
  /**
   * Rate a Brain reply on this board.
   *
   * The Canvas has no Brain chat and therefore no brain-message id, so it posts to
   * the surface-agnostic ratings endpoint keyed on the transcript's own stable
   * `clientMessageId`. The model and the tool come off the message we stamped at
   * append time (`lastTurnProvenance`), which is what makes a press on a reloaded
   * board still attributable rather than anonymous.
   */
  const [brainRatings, setBrainRatings] = useState<Record<number, 1 | -1>>({});
  const rateBrainMessage = useCallback((message: BrainMessage, rating: 1 | -1 | 0) => {
    const entry = timeline[message.id - 1];
    const model = entry?.metadata?.model;
    if (!entry || !model) return;
    setBrainRatings((prev) => {
      const next = { ...prev };
      if (rating === 0) delete next[message.id];
      else next[message.id] = rating;
      return next;
    });
    void llmApi.rateAction({
      surface: 'canvas',
      subjectKind: 'turn',
      subjectRef: `canvas:${sessionId}:${entry.clientMessageId}`,
      resolvedModel: model,
      // The LAST tool of the turn is the one the reply is reporting on, so it is the
      // one the verdict is about.
      toolName: entry.metadata?.tools?.[entry.metadata.tools.length - 1] ?? null,
      projectId: evermindProjectId ?? null,
      rating,
    }).catch(() => { /* telemetry: a lost rating must never disturb the board */ });
  }, [evermindProjectId, sessionId, timeline]);
  /**
   * Exactly one surface renders the conversation. When it is inline, the Brain Object
   * reads this and becomes the chat; the edge dock is not rendered at all. Feeding both
   * placements from ONE value is what guarantees the board can never show two.
   */
  /**
   * The conversion CTA a refused guest turn arms. Built once and handed to BOTH
   * Brain placements, so the button appears wherever the visitor is reading the
   * refusal — and returns them to THIS canvas, which is the promise the copy makes.
   */
  const guestSignupPrompt = useMemo<GuestSignupPrompt | null>(() => (guestLimit === null ? null : {
    next: `/create/${sessionId}`,
    onAccept: () => trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: canvasSurface(), action: 'guest_limit' } }),
  }), [guestLimit, sessionId]);
  /**
   * HOW MANY REPLIES LANDED BEHIND A CLOSED BRAIN — the number the launcher pill wears
   * and the Brain Object reads off the context below. See `useBrainUnreadReplies` for
   * what "unread" means and why the mark is taken while the surface is open.
   */
  const brainUnreadReplies = useBrainUnreadReplies(brainMessages, brainSurfaceOpen);
  const brainSurface = useMemo<BrainSurfaceContextValue>(() => ({
    open: brainSurfaceOpen,
    unreadReplies: brainUnreadReplies,
    canOpen: !presentMode,
    mode: brainPlacement,
    showExecutionDetail: brainDock.showExecutionDetail,
    running: brainRunning,
    runStartedAt: brainRunShownStartedAt,
    messages: brainMessages,
    trace: brainTrace,
    nodes,
    edges,
    collaborators: brainCollaborators,
    joinedCollaborator,
    onReplayMessage: replayBrainMessage,
    // A guest board has no tenant to file a rating against, so the thumbs hide
    // rather than pretend — the component decides its own visibility from this.
    ...(persistence === 'server' ? { onRateMessage: rateBrainMessage, ratings: brainRatings } : {}),
    guestSignup: guestSignupPrompt,
    onOpen: (nodeId) => { setSelectedId(nodeId); setSelectedIds([nodeId]); openBrainDock(); },
    onModeChange: (mode) => updateBrainDock({ mode }),
    onExecutionDetailChange: (showExecutionDetail) => updateBrainDock({ showExecutionDetail }),
    onClose: () => updateBrainDock({ open: false }),
  }), [brainCollaborators, brainDock.showExecutionDetail, brainMessages, brainPlacement, brainRatings, brainRunShownStartedAt, brainRunning, brainSurfaceOpen, brainTrace, brainUnreadReplies, edges, guestSignupPrompt, joinedCollaborator, nodes, openBrainDock, persistence, presentMode, rateBrainMessage, replayBrainMessage, setSelectedId, setSelectedIds, updateBrainDock]);
  return { brainSurfaceOpen, brainPlacement, rosterMembers, seatedAgents, boardBridge, spacePresence, brainDockReserved, brainSurface, brainMessages, brainReveal, brainRunning, brainRunShownStartedAt, brainNode, brainCollaborators, replayBrainMessage, guestSignupPrompt, roomOccupants, roomSpeechBySeat, revealSpeechInChat, rosterSelfId, brainUnreadReplies };
}
