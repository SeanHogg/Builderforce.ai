/**
 * SHARE CANVAS SESSION — the account-less board that more than one person edits.
 *
 * ── WHAT WAS WRONG, AND WHY IT WAS WORTH MOVING ──────────────────────────────
 * PRD 22 §3.4 names this as one of the four canvas use cases still implemented
 * inside `CanvasInner`. It was five `useCallback`s and three `useRef`s spread
 * over 700 lines of a 13,000-line component, and between them they held the two
 * rules that decide whether a shared board WORKS:
 *
 *   1. ECHO SUPPRESSION — never push back the snapshot you just pulled. Without
 *      it two peers ping-pong a board neither of them is touching, forever.
 *   2. THE HYDRATION GATE — never push before this device has read the room.
 *      An invitee mounts on the default starter board and the save debounce
 *      fires ~300ms later; without the gate, joining a shared canvas WIPES it.
 *
 * Both are one-line comparisons and both were unreachable except by mounting
 * 940 KB of canvas in jsdom, where the suite already costs ~35 s per render.
 * They are now `decidePush`, which a test exercises in microseconds.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────
 * Same as `MaterializeDataset.ts`: take what you need, return a DESCRIPTION of
 * what should happen, mutate no React state. The one departure is that this use
 * case is STATEFUL — "what has this device exchanged with the room" is genuinely
 * a fact the use case owns, not a fact the view owns — so it is a factory
 * returning a small service rather than a bag of pure functions. The three refs
 * it replaces were that same state, kept where nothing could test it.
 *
 * The room transport is a PORT ({@link GuestRoomPort}). The canvas does not know
 * whether a room is HTTP, a socket or a fake; `infrastructure/guestRoomGateway.ts`
 * decides that, and a test supplies four functions.
 */

import type { CanvasTextTranslator } from '../domain/canvasText';

/** A board serialized for the room, exactly as the room stores it. */
export type SerializedBoard = string;

/**
 * How this canvas reaches the shared room.
 *
 * Four methods, because four is what sharing needs: open one, read the board,
 * write the board, and stop. `announce` is the notification that a new board is
 * up — separate from `pushBoard` because a push that the room REFUSED (too
 * large) must not tell peers to come and read it.
 */
export interface GuestRoomPort {
  /** Open a room. Returns its code, or why it could not be opened. */
  open(hostName: string, title: string): Promise<{ code: string } | GuestRoomFailure>;
  /** The room's current board, or `null` when it has none yet. */
  fetchBoard(code: string): Promise<SerializedBoard | null>;
  /** Store the board. `false` means the room refused it — see {@link PushOutcome}. */
  pushBoard(code: string, board: SerializedBoard): Promise<boolean>;
  /** Tell everyone in the room there is a new board to read. */
  announce(): void;
  /** Stop sharing from THIS device. The room runs on for everyone else. */
  leave(code: string): Promise<void>;
}

/** Why a room could not be opened. The transport's vocabulary, kept narrow. */
export type GuestRoomFailure = 'unavailable' | 'gone' | 'network';

/**
 * Whether the board this device just saved should reach the room, and if not, why.
 *
 * The reason is part of the result rather than a bare `false` because the three
 * cases are operationally different — `echo` is the system working, `hydrating`
 * is a race being won, and `solo` is the ordinary state of a private board — and
 * a caller that cannot tell them apart cannot log or test any of them.
 */
export type PushDecision =
  | { push: false; reason: 'solo' | 'hydrating' | 'echo' }
  | { push: true; code: string; board: SerializedBoard };

/** What came back from a push that was attempted. */
export type PushOutcome = { stored: true } | { stored: false; notice: string };

/** The result of adopting a snapshot the room handed us. */
export type AdoptDecision<Snapshot> =
  | { adopt: true; snapshot: Snapshot; board: SerializedBoard }
  | { adopt: false; reason: 'unparseable' | 'not-a-board' };

/** The result of turning a private board into a shared one. */
export type StartSharingResult =
  | { started: true; code: string; notice: string }
  | { started: false; notice: string };

/**
 * The minimum a snapshot must look like before this device will replace a good
 * local board with it. Deliberately structural rather than a full parse: the
 * room is a last-writer-wins cache of something this same build wrote, and the
 * reader (`readLocalCreationSession`) validates properly on the way back off
 * disk. What we are guarding against here is a TRUNCATED or corrupt payload,
 * and `nodes`/`edges` being arrays is what tells those apart.
 */
function looksLikeBoard(value: unknown): value is { nodes: unknown[]; edges: unknown[] } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { nodes?: unknown; edges?: unknown };
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

/**
 * This device's half of a shared session.
 *
 * Holds three facts and nothing else: which room we are in, whether we have read
 * it yet, and what we last exchanged with it. Every rule that used to live in
 * `CanvasInner`'s refs is a method here.
 */
export interface SharedSession<Snapshot> {
  /** The room this device is sharing into, or `null` when the board is private. */
  code(): string | null;
  /** Enter (or leave) a room. Entering resets the hydration gate — a new room has
   *  not been read yet, and treating it as read is exactly bug 2. */
  enter(code: string | null): void;
  /** Open the gate: this device has now read the room (or learned it has none). */
  markHydrated(): void;
  /** Whether the gate is open. */
  hydrated(): boolean;
  /** Should this save reach the room? See {@link PushDecision}. */
  decidePush(board: SerializedBoard): PushDecision;
  /** Push, honouring {@link decidePush}. Returns `null` when nothing was sent. */
  push(board: SerializedBoard, t: CanvasTextTranslator): Promise<PushOutcome | null>;
  /** Read the room's board and decide whether to adopt it. */
  pull(parse: (board: SerializedBoard) => Snapshot | null): Promise<AdoptDecision<Snapshot> | null>;
  /** Record that a snapshot came FROM the room, so the next save does not echo it. */
  noteExchanged(board: SerializedBoard): void;
  /** Turn this private board into a shared one, board and all. */
  start(input: StartSharingInput, t: CanvasTextTranslator): Promise<StartSharingResult>;
  /** Stop sharing on this device. */
  stop(t: CanvasTextTranslator): Promise<{ notice: string }>;
}

export interface StartSharingInput {
  /** The name to appear under. Blank falls back to the localized default. */
  hostName: string;
  title: string;
  /** The board as it stands right now — sharing carries it, never starts empty. */
  board: SerializedBoard;
}

export function createSharedSession<Snapshot>(room: GuestRoomPort): SharedSession<Snapshot> {
  let code: string | null = null;
  let hydrated = false;
  /** The snapshot most recently exchanged with the room, in either direction. */
  let exchanged: SerializedBoard = '';

  const decidePush = (board: SerializedBoard): PushDecision => {
    if (!code) return { push: false, reason: 'solo' };
    if (!hydrated) return { push: false, reason: 'hydrating' };
    if (board === exchanged) return { push: false, reason: 'echo' };
    return { push: true, code, board };
  };

  return {
    code: () => code,
    enter(next) {
      code = next;
      hydrated = false;
      if (!next) exchanged = '';
    },
    markHydrated() { hydrated = true; },
    hydrated: () => hydrated,
    decidePush,
    async push(board, t) {
      const decision = decidePush(board);
      if (!decision.push) return null;
      exchanged = decision.board;
      const stored = await room.pushBoard(decision.code, decision.board);
      if (stored) {
        room.announce();
        return { stored: true };
      }
      // A board too big for the room's slot must SAY so: everyone here would
      // otherwise keep editing while late joiners load a stale board.
      return { stored: false, notice: t('sharedBoardTooLarge') };
    },
    async pull(parse) {
      if (!code) return null;
      const serialized = await room.fetchBoard(code);
      // A room with no board yet (the host is mid-create) means THIS device's
      // board becomes the shared one — so open the gate either way.
      if (!serialized) { hydrated = true; return null; }
      let raw: unknown;
      try {
        raw = JSON.parse(serialized);
      } catch {
        hydrated = true;
        return { adopt: false, reason: 'unparseable' }; // a corrupt board is not worth wiping a good local one for
      }
      if (!looksLikeBoard(raw)) { hydrated = true; return { adopt: false, reason: 'not-a-board' }; }
      const snapshot = parse(serialized);
      hydrated = true;
      if (!snapshot) return { adopt: false, reason: 'not-a-board' };
      exchanged = serialized;
      return { adopt: true, snapshot, board: serialized };
    },
    noteExchanged(board) { exchanged = board; },
    async start({ hostName, title, board }, t) {
      const name = hostName.trim() || t('sharedDefaultHostName');
      const opened = await room.open(name, title);
      if (typeof opened === 'string') {
        return { started: false, notice: opened === 'unavailable' ? t('sharedUnavailable') : t('sharedEnded') };
      }
      code = opened.code;
      exchanged = board;
      // The host's board IS the room's board — there is no pull to wait for.
      hydrated = true;
      const stored = await room.pushBoard(opened.code, board);
      return { started: true, code: opened.code, notice: stored ? t('sharedStarted') : t('sharedBoardTooLarge') };
    },
    async stop(t) {
      const leaving = code;
      code = null;
      hydrated = false;
      exchanged = '';
      if (leaving) await room.leave(leaving);
      return { notice: t('sharedLeft') };
    },
  };
}

/**
 * A board serialized for the room.
 *
 * One function so the two sides of echo suppression cannot disagree about what
 * "the same board" means. They compared `JSON.stringify(snapshot)` at one call
 * site and `JSON.stringify({ nodes, edges })` at another, which is a comparison
 * that silently never matches.
 */
export function serializeForRoom(snapshot: unknown): SerializedBoard {
  return JSON.stringify(snapshot);
}
