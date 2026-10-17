/**
 * The guest Brain's session state — the conversation, the daily allowance, the guest
 * token and the shared room — for `GuestBrainPanel`, which only draws it.
 *
 * A lean view over the SAME package conversation hooks the authed BrainPanel uses
 * (useBrainChats + useBrainConversation), wired to the GUEST runtime: a guest token
 * on the transport and localStorage persistence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePolledResource } from '@/hooks/usePolledResource';
import { useBrainChats, useBrainConversation, isStepMessage, getBrainCapability, GUEST_ROOM_CHAT_ID, type BrainCapabilityId } from '@/lib/brain';
import { mintGuestSession, getGuestUsage } from '@/lib/guestChatApi';
import { onGuestLimit, type GuestLimitRefusal } from '@/lib/guestLimit';
import { useGuestRoom } from '@/lib/useGuestRoom';
import {
  createGuestRoom, leaveGuestRoom, appendGuestRoomMessages, refreshGuestCredentials,
  getActiveGuestRoom, getGuestDisplayName, setGuestDisplayName, type GuestRoomState,
} from '@/lib/guestRoomApi';

/** How often the short-lived guest token is renewed (it expires after an hour). */
const CREDENTIAL_REFRESH_MS = 45 * 60 * 1000;

export function useGuestBrainSession({ initialPrompt, inviteCode }: { initialPrompt?: string; inviteCode?: string | null }) {
  const t = useTranslations('guestBrain');
  const tRoom = useTranslations('guestRoom');

  const [ready, setReady] = useState(false);          // guest token minted
  const [enabled, setEnabled] = useState(true);       // kill switch / mint ok
  const [roomsEnabled, setRoomsEnabled] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState(0);
  const [input, setInput] = useState('');

  // ── Shared-room state ──────────────────────────────────────────────────────
  // `roomCode` is the room this browser is IN; `inviteCode` is one it has been
  // asked to join. They differ exactly while an invite is pending.
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [joining, setJoining] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [meetingOn, setMeetingOn] = useState(false);

  useEffect(() => {
    setRoomCode(getActiveGuestRoom());
    setDisplayName(getGuestDisplayName());
  }, []);

  const inRoom = !!roomCode;
  const pendingInvite = !!inviteCode && inviteCode !== roomCode;

  /**
   * A wall the counter did not see coming. "Messages left" is this visitor's own
   * allowance, and it is not the only one that can run out: the per-device cap and
   * a room's combined cap both refuse while this browser still believes it has
   * turns left. Those refusals raise the same wall, which is the only thing a
   * blocked visitor can act on.
   */
  const [refusedWall, setRefusedWall] = useState<GuestLimitRefusal | null>(null);
  useEffect(() => onGuestLimit(setRefusedWall), []);

  const capReached = (remaining !== null && remaining <= 0) || refusedWall !== null;

  // Same capability tiles as the signed-in Brain Storm empty state. Guest chats are
  // localStorage-only, so the choice is session state here rather than a persisted
  // chat field; the system-prompt injection is identical.
  const [capability, setCapability] = useState<BrainCapabilityId | null>(null);
  const capabilityPrompt = getBrainCapability(capability)?.systemPrompt;

  const chats = useBrainChats({});
  // In a room the conversation IS the room — one fixed chat id, so every
  // participant's hook resolves to the same transcript.
  const activeChatId = inRoom ? GUEST_ROOM_CHAT_ID : chats.activeChatId;
  const conv = useBrainConversation({
    chatId: activeChatId,
    modality: 'llm',
    extraSystem: capabilityPrompt,
    ensureChatId: async () => {
      if (inRoom) return GUEST_ROOM_CHAT_ID;
      const chat = await chats.create({ title: t('newChatTitle') });
      return chat?.id ?? null;
    },
    onActivity: (id) => { if (!inRoom) void chats.touch(id); },
  });

  const reloadMessages = conv.reloadMessages;
  const room = useGuestRoom(roomCode, { name: displayName }, { onTranscriptChanged: reloadMessages });

  // Re-broadcast my in-flight reply so the room watches the same answer arrive.
  // Only the sender holds the gateway stream, so only the sender can relay it.
  const { relayStream } = room;
  const streamingText = conv.streamingText;
  useEffect(() => {
    if (!inRoom || !streamingText) return;
    relayStream(streamingText);
  }, [inRoom, streamingText, relayStream]);

  // Mint the guest token on mount so the first send is authenticated. A null
  // result means guest chat is disabled or unreachable → show the sign-in CTA.
  // A visitor already in a room keeps their room-bound token.
  useEffect(() => {
    let cancelled = false;
    if (getActiveGuestRoom()) {
      void getGuestUsage().then((usage) => {
        if (cancelled) return;
        setEnabled(usage?.enabled ?? true);
        setRoomsEnabled(usage?.roomsEnabled ?? true);
        setReady(true);
      });
      return () => { cancelled = true; };
    }
    void mintGuestSession().then((usage) => {
      if (cancelled) return;
      if (!usage) { setEnabled(false); setReady(true); return; }
      setRemaining(usage.remaining);
      setLimit(usage.limit);
      setRoomsEnabled(usage.roomsEnabled);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Keep the guest token alive past its one-hour life; the poll pauses while the
  // tab is hidden and renews once on return.
  usePolledResource(
    (signal) => refreshGuestCredentials().then((state) => {
      if (signal.aborted) return;
      // A room that has ended drops us back to solo.
      setRoomCode(getActiveGuestRoom());
      if (state) { setRemaining(state.remaining); setLimit(state.limit); }
    }),
    { intervalMs: CREDENTIAL_REFRESH_MS, enabled: ready && enabled, immediate: false },
  );

  // In a room the COMBINED counter is the truth — it is what everyone is spending.
  useEffect(() => {
    if (!inRoom) return;
    if (room.remaining !== null) setRemaining(room.remaining);
    if (room.limit) setLimit(room.limit);
  }, [inRoom, room.remaining, room.limit]);

  const refreshUsage = useCallback(async () => {
    if (getActiveGuestRoom()) { await room.refresh(); return; }
    const usage = await getGuestUsage();
    if (usage) { setRemaining(usage.remaining); setLimit(usage.limit); setEnabled(usage.enabled); setRoomsEnabled(usage.roomsEnabled); }
    // Allowances reset daily. A refusal-raised wall has no counter to retire it, so
    // it is retired HERE, the moment the server says there are turns again.
    if (usage && usage.remaining > 0) setRefusedWall(null);
  }, [room]);

  const doSend = useCallback(async (text: string) => {
    // Tell the room somebody is waiting on the Brain.
    if (getActiveGuestRoom()) room.setBusy(true);
    const ok = await conv.send(text);
    if (getActiveGuestRoom()) room.setBusy(false);
    // The server consumed one message either way — refresh the counter so the wall
    // appears the instant the allowance is spent.
    void refreshUsage();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, refreshUsage, room]);

  // Auto-send the one-shot initial prompt exactly once, after the token is ready.
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (!ready || !enabled || capReached || pendingInvite) return;
    if (sentInitialRef.current || !initialPrompt?.trim()) return;
    sentInitialRef.current = true;
    void doSend(initialPrompt.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled, capReached, pendingInvite, initialPrompt]);

  // A turn mid-run is not supported by the guest conversation: the box stays
  // writable and the text stays put until the run ends (or is stopped).
  const submit = async () => {
    const text = input.trim();
    if (!text || conv.sending || capReached) return;
    setInput('');
    const ok = await doSend(text);
    if (!ok) setInput(text); // restore on failure so nothing is lost
  };

  // ── Room actions ───────────────────────────────────────────────────────────

  const adoptRoom = useCallback((state: GuestRoomState) => {
    setRoomCode(state.code);
    setRemaining(state.remaining);
    setLimit(state.limit);
    setRoomError(null);
    reloadMessages();
  }, [reloadMessages]);

  /** Accept an invite: adopt the room and the name the join card stored. */
  const joinRoom = useCallback((state: GuestRoomState) => {
    adoptRoom(state);
    setDisplayName(getGuestDisplayName());
  }, [adoptRoom]);

  /** Open a shared session and carry the conversation so far into it. */
  const startRoom = useCallback(async () => {
    setJoining(true);
    setRoomError(null);
    const name = displayName.trim() || tRoom('defaultHostName');
    setGuestDisplayName(name);
    // Capture the local transcript BEFORE the room becomes active — once it is,
    // persistence reads and writes the room instead of this browser.
    const carried = conv.messages
      .filter((m) => !isStepMessage(m))
      .map((m) => ({ role: m.role, content: m.content, metadata: m.metadata ?? null }));
    const state = await createGuestRoom(name, carried.find((m) => m.role === 'user')?.content?.slice(0, 80));
    if (typeof state === 'string') {
      setRoomError(state === 'unavailable' ? tRoom('errorUnavailable') : tRoom('errorGone'));
      setJoining(false);
      return;
    }
    if (carried.length) await appendGuestRoomMessages(state.code, carried);
    adoptRoom(state);
    setDisplayName(name);
    setJoining(false);
  }, [conv.messages, displayName, adoptRoom, tRoom]);

  const exitRoom = useCallback(async () => {
    const code = getActiveGuestRoom();
    setMeetingOn(false);
    setRoomCode(null);
    if (code) await leaveGuestRoom(code);
    // Back to a solo guest: mint a fresh, room-less token and reload the local
    // transcript this browser still owns.
    const usage = await mintGuestSession();
    if (usage) { setRemaining(usage.remaining); setLimit(usage.limit); setRoomsEnabled(usage.roomsEnabled); }
    reloadMessages();
  }, [reloadMessages]);

  const visibleMessages = useMemo(() => conv.messages.filter((m) => !isStepMessage(m)), [conv.messages]);

  return {
    ready, enabled, roomsEnabled, remaining, limit, input, setInput, submit,
    roomCode, inRoom, pendingInvite, displayName, joining, roomError, setRoomError,
    meetingOn, setMeetingOn, refusedWall, capReached, capability, setCapability,
    activeChatId, conv, room, visibleMessages, joinRoom, startRoom, exitRoom,
  };
}
