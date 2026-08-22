'use client';

/**
 * WHERE AN ACCOUNT-LESS BOARD LIVES — this device, and (when it is shared) the
 * room everybody else is reading.
 *
 * ── WHY THIS IS A HOOK AND NOT ANOTHER USE CASE ──────────────────────────────
 * The RULES of sharing already moved out: echo suppression, the hydration gate,
 * what to say when a board is refused, all in
 * `application/ShareCanvasSession.ts`. What stayed behind in `CanvasInner` was
 * the REACT of it — two pieces of state, three refs, two effects and four
 * callbacks — and moving a rule out does not move that. `AdoptRemoteBoard`
 * proved the point in the other direction: it deleted a duplicated block and a
 * defect, and the component still grew, because wiring costs more than the
 * duplication it replaces.
 *
 * So this is the first module of the canvas PRESENTATION layer, and the shape
 * that actually shrinks a god component: a hook that OWNS state rather than a
 * function the component calls while keeping it.
 *
 * ── WHY THE DEVICE WRITE RIDES WITH THE ROOM ─────────────────────────────────
 * `writeLocalCreationSession` is here rather than at the call sites because the
 * two writes must never diverge: a shared board updated on this device and
 * missed in the room is a board the other people are editing a stale copy of.
 * One function, both destinations — which is what the original `persistSnapshot`
 * comment claimed and what nothing enforced.
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────────────
 * Narrow on purpose (see the no-god-classes rule): the caller hands over what it
 * is, how to speak, how to put a board on screen, and how to read the board it
 * is holding. It gets back the room's observable state and three verbs. Nothing
 * about nodes, edges, timelines or React setters crosses this line, which is why
 * a second surface could mount it unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getActiveGuestRoom, getGuestDisplayName, setGuestDisplayName, type GuestRoomParticipant } from '@/lib/guestRoomApi';
import { useGuestRoom } from '@/lib/useGuestRoom';
import {
  createSharedSession,
  serializeForRoom,
  type SharedSession,
} from '../application/ShareCanvasSession';
import { createGuestRoomGateway } from '../infrastructure/guestRoomGateway';
import {
  parseLocalCreationSnapshot,
  writeLocalCreationSession,
  type LocalCreationSnapshot,
} from '../infrastructure/localCanvasStore';
import type { CanvasTextTranslator } from '../domain/canvasText';

export interface SharedCanvasRoomOptions {
  /** Only an account-less board can open a guest room; a server session shares
   *  through real membership instead. `false` keeps every effect here inert. */
  enabled: boolean;
  sessionId: string;
  t: CanvasTextTranslator;
  /** Say something to the person. */
  notify: (text: string) => void;
  /** Put a board the room handed us on screen. Called only when it is adoptable;
   *  echo suppression is already recorded by then, so the caller gets the snapshot
   *  and nothing it would have to remember to do with it. */
  adopt: (snapshot: LocalCreationSnapshot) => void;
  /** The board as it stands, read at the moment sharing STARTS — because sharing
   *  carries the board with it, and a read taken a render earlier would share the
   *  board as it was before the click. */
  currentSnapshot: () => LocalCreationSnapshot;
}

export interface SharedCanvasRoom {
  /** Sharing right now. */
  active: boolean;
  code: string | null;
  /** The name this browser appears under. Read by the camera anchor, which has to
   *  name the participant it publishes. */
  displayName: string;
  /** A start or a stop is in flight. */
  busy: boolean;
  participants: readonly GuestRoomParticipant[];
  /** The room cannot take another person, so the invite link would fail. */
  full: boolean;
  /** Bumps whenever a peer announces a new board — the pull trigger. */
  boardVersion: number;
  start: () => Promise<void>;
  leave: () => Promise<void>;
  /** Write this board to the device AND, when shared, to the room. */
  persist: (snapshot: LocalCreationSnapshot) => void;
}

export function useSharedCanvasRoom({
  enabled,
  sessionId,
  t,
  notify,
  adopt,
  currentSnapshot,
}: SharedCanvasRoomOptions): SharedCanvasRoom {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guestName = useRef('');

  useEffect(() => {
    if (!enabled) return;
    setCode(getActiveGuestRoom());
    guestName.current = getGuestDisplayName();
  }, [enabled]);

  const room = useGuestRoom(enabled ? code : null, { name: guestName.current });
  const active = enabled && !!code;

  /**
   * The `announce` callback comes off the live room subscription, so it is fed to
   * the gateway through a ref: the sync object is built ONCE and must not be torn
   * down and rebuilt every time the room re-renders, which would reset the
   * hydration gate mid-session — the exact condition that wipes a host's board.
   */
  const announceRef = useRef(room.announceCanvas);
  announceRef.current = room.announceCanvas;
  const sharedRef = useRef<SharedSession<LocalCreationSnapshot> | null>(null);
  if (!sharedRef.current) {
    sharedRef.current = createSharedSession<LocalCreationSnapshot>(createGuestRoomGateway(() => announceRef.current()));
  }
  const shared = sharedRef.current;

  useEffect(() => { shared.enter(active ? code : null); }, [active, code, shared]);

  // The callers change identity every render (they close over the board); read
  // them from refs so the pull effect is driven by the ROOM changing and not by
  // the parent re-rendering, which would re-pull on every keystroke.
  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const snapshotRef = useRef(currentSnapshot);
  snapshotRef.current = currentSnapshot;

  // Pull the shared board: once on entering a room (this is how a LATE joiner
  // sees anything at all) and again whenever a peer announces a new one. Whether
  // the payload is adoptable — and opening the hydration gate either way, so a
  // room with no board yet lets THIS device's board become the shared one — is
  // the use case's decision, not this effect's.
  useEffect(() => {
    if (!enabled || !code) return;
    let cancelled = false;
    void shared.pull(parseLocalCreationSnapshot).then((decision) => {
      if (cancelled || !decision?.adopt) return;
      adoptRef.current(decision.snapshot);
    });
    return () => { cancelled = true; };
  }, [enabled, code, room.canvasVersion, shared]);

  const persist = useCallback((snapshot: LocalCreationSnapshot) => {
    writeLocalCreationSession(sessionId, snapshot);
    void shared.push(serializeForRoom(snapshot), t).then((outcome) => {
      if (outcome && !outcome.stored) notifyRef.current(outcome.notice);
    });
  }, [sessionId, shared, t]);

  /**
   * Turn this private board into a shared session. The board comes WITH it —
   * "invite people to this canvas" that starts them on an empty one would be a
   * different (and worse) feature.
   */
  const start = useCallback(async () => {
    setBusy(true);
    const name = guestName.current.trim() || t('sharedDefaultHostName');
    setGuestDisplayName(name);
    guestName.current = name;
    const snapshot = snapshotRef.current();
    const result = await shared.start({ hostName: name, title: snapshot.title, board: serializeForRoom(snapshot) }, t);
    if (result.started) setCode(result.code);
    setBusy(false);
    notifyRef.current(result.notice);
  }, [shared, t]);

  /** Stop sharing on THIS device. The board stays here; the room runs on for anyone else. */
  const leave = useCallback(async () => {
    setBusy(true);
    setCode(null);
    const result = await shared.stop(t);
    setBusy(false);
    notifyRef.current(result.notice);
  }, [shared, t]);

  return {
    active,
    code: active ? code : null,
    displayName: guestName.current,
    busy,
    participants: room.participants,
    full: room.participants.length >= (room.state?.maxParticipants ?? 0),
    boardVersion: room.canvasVersion,
    start,
    leave,
    persist,
  };
}
