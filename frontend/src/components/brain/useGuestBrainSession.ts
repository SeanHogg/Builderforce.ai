/**
 * The guest Brain's session state — the conversation, the daily allowance, the guest
 * token and the shared room — for `GuestBrainPanel`, which only draws it.
 *
 * A lean view over the SAME package conversation hooks the authed BrainPanel uses
 * (useBrainChats + useBrainConversation), wired to the GUEST runtime: a guest token
 * on the transport and localStorage persistence.
 *
 * ANONYMOUS FIRST (operator decision): opening the panel makes NO API call. The visitor
 * defaults to Local only — turns run on this device's model, and with none here the
 * shared `no_local_model` remedy shows (download a model / switch to Hybrid), never a
 * disabled panel. Hybrid is their opt-in: choosing it (the first-run question, the `/`
 * menu, the remedy) mints the guest allowance, and a Hybrid turn that reaches the
 * gateway mints on demand (`guestRuntime`). The landing page's one-shot prompt passes
 * the SAME first-run gate as Send (`modeGate`), so it is never sent before a choice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { routingModeForSelection, type ChatModelSelection } from '@seanhogg/builderforce-brain-embedded';
import { useInferenceModeGate } from '@seanhogg/builderforce-brain-ui';
import { usePolledResource } from '@/hooks/usePolledResource';
import { useWebInferenceMode } from '@/lib/localFirst/useWebInferenceMode';
import { webInferenceModeNow } from '@/lib/localFirst/webInferenceMode';
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

  // Ready at once: nothing has to be minted before a Local-only turn can run.
  const [ready, setReady] = useState(() => !getActiveGuestRoom());
  const [enabled, setEnabled] = useState(true);       // the guest-chat kill switch (Hybrid)
  const [roomsEnabled, setRoomsEnabled] = useState(false);
  const [soloRemaining, setSoloRemaining] = useState<number | null>(null);
  const [soloLimit, setSoloLimit] = useState(0);
  const [input, setInput] = useState('');

  // ── Shared-room state ──────────────────────────────────────────────────────
  // `roomCode` is the room this browser is IN; `inviteCode` is one it has been
  // asked to join. They differ exactly while an invite is pending.
  // Read from localStorage on first render: this hook only runs client-side (the
  // panel mounts behind `ssr: false` / an opened drawer), so there is no server
  // render to mismatch and no reason to paint an empty value first.
  const [roomCode, setRoomCode] = useState<string | null>(getActiveGuestRoom);
  const [displayName, setDisplayName] = useState(getGuestDisplayName);
  const [joining, setJoining] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [meetingOn, setMeetingOn] = useState(false);

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

  // Same capability tiles as the signed-in Brain Storm empty state. Guest chats are
  // localStorage-only, so the choice is session state here rather than a persisted
  // chat field; the system-prompt injection is identical.
  const [capability, setCapability] = useState<BrainCapabilityId | null>(null);
  const capabilityPrompt = getBrainCapability(capability)?.systemPrompt;

  // The guest's `/` menu Model tab: Auto, or a model downloaded into THIS browser (the
  // guest has no gateway catalogue to pick from). Session state, like the capability.
  // The pick rides on the call strictly — the person's pick, which the inference mode
  // then decides about (brain-embedded's `createHostModelStream`).
  const [modelSelection, setModelSelection] = useState<ChatModelSelection>({ mode: 'auto' });

  const chats = useBrainChats({});
  // In a room the conversation IS the room — one fixed chat id, so every
  // participant's hook resolves to the same transcript.
  const activeChatId = inRoom ? GUEST_ROOM_CHAT_ID : chats.activeChatId;
  const conv = useBrainConversation({
    chatId: activeChatId,
    modality: 'llm',
    extraSystem: capabilityPrompt,
    ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
    routingMode: routingModeForSelection(modelSelection),
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

  // Where models run — THE web mode (anonymous default: Local only) — and THE first-run
  // gate the composer's Send and the landing prompt both pass.
  const inference = useWebInferenceMode();
  const modeGate = useInferenceModeGate(inference);
  const reachesGateway = inference.value !== 'local-only';
  // The kill switch closes only what it governs — the gateway allowance. Local only runs
  // on this device whatever the switch says.
  const usable = enabled || !reachesGateway;

  // NEVER MINT ON OPEN. A visitor already in a room opted in and keeps their room-bound
  // token: their room's allowance is read. Anyone else starts with nothing sent.
  useEffect(() => {
    if (!getActiveGuestRoom()) return;
    let cancelled = false;
    void getGuestUsage().then((usage) => {
      if (cancelled) return;
      setEnabled(usage?.enabled ?? true);
      setRoomsEnabled(usage?.roomsEnabled ?? true);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Hybrid / Specific chosen (now, or on an earlier visit): the guest allowance is theirs
  // to see — the "N left" counter, the kill switch, rooms. Read, never minted (the opt-in
  // mints; a Hybrid turn mints on demand). Local only reads nothing.
  useEffect(() => {
    if (!reachesGateway || getActiveGuestRoom()) return;
    let cancelled = false;
    void getGuestUsage().then((usage) => {
      if (cancelled || !usage) return;
      setSoloRemaining(usage.remaining);
      setSoloLimit(usage.limit);
      setEnabled(usage.enabled);
      setRoomsEnabled(usage.roomsEnabled);
    });
    return () => { cancelled = true; };
  }, [reachesGateway]);

  // Keep the guest token alive past its one-hour life — only while the visitor runs a
  // mode that reaches the gateway; the poll pauses while the tab is hidden and renews
  // once on return.
  usePolledResource(
    (signal) => refreshGuestCredentials().then((state) => {
      if (signal.aborted) return;
      // A room that has ended drops us back to solo.
      setRoomCode(getActiveGuestRoom());
      if (state) { setSoloRemaining(state.remaining); setSoloLimit(state.limit); }
    }),
    { intervalMs: CREDENTIAL_REFRESH_MS, enabled: ready && enabled && reachesGateway, immediate: false },
  );

  // In a room the COMBINED counter is the truth — it is what everyone is spending.
  // Derived, not copied into state: the room's numbers win while they are known.
  const remaining = inRoom && room.remaining !== null ? room.remaining : soloRemaining;
  const limit = inRoom && room.limit ? room.limit : soloLimit;
  // The allowance only walls a turn that would spend it: Local only runs on this device.
  const capReached = reachesGateway && ((remaining !== null && remaining <= 0) || refusedWall !== null);

  const refreshUsage = useCallback(async () => {
    if (getActiveGuestRoom()) { await room.refresh(); return; }
    const usage = await getGuestUsage();
    if (usage) { setSoloRemaining(usage.remaining); setSoloLimit(usage.limit); setEnabled(usage.enabled); setRoomsEnabled(usage.roomsEnabled); }
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
    // appears the instant the allowance is spent. Local only spent nothing and sends
    // nothing (read live: the mode may have been chosen this very turn).
    if (webInferenceModeNow() !== 'local-only') void refreshUsage();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, refreshUsage, room]);

  // Auto-send the one-shot initial prompt exactly once — through THE first-run gate, so a
  // visitor who never chose where models run is asked first and the prompt is sent the
  // moment they answer (Local only: on this device; Hybrid: minted, then sent).
  const doSendRef = useRef(doSend);
  doSendRef.current = doSend;
  const sentInitialRef = useRef(false);
  const { request: requestTurn } = modeGate;
  useEffect(() => {
    if (!ready || !usable || capReached || pendingInvite) return;
    if (sentInitialRef.current || !initialPrompt?.trim()) return;
    sentInitialRef.current = true;
    const text = initialPrompt.trim();
    requestTurn(() => { void doSendRef.current(text); });
  }, [ready, usable, capReached, pendingInvite, initialPrompt, requestTurn]);

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
    setSoloRemaining(state.remaining);
    setSoloLimit(state.limit);
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
    // Back to a solo guest: mint a fresh, room-less token (only for a mode that reaches
    // the gateway — Local only needs none) and reload the local transcript this browser
    // still owns.
    const usage = webInferenceModeNow() !== 'local-only' ? await mintGuestSession() : null;
    if (usage) { setSoloRemaining(usage.remaining); setSoloLimit(usage.limit); setRoomsEnabled(usage.roomsEnabled); }
    reloadMessages();
  }, [reloadMessages]);

  const visibleMessages = useMemo(() => conv.messages.filter((m) => !isStepMessage(m)), [conv.messages]);

  return {
    ready, enabled: usable, roomsEnabled: roomsEnabled && reachesGateway, remaining, limit, input, setInput, submit,
    roomCode, inRoom, pendingInvite, displayName, joining, roomError, setRoomError,
    meetingOn, setMeetingOn, refusedWall, capReached, capability, setCapability,
    activeChatId, conv, room, visibleMessages, joinRoom, startRoom, exitRoom,
    modelSelection, setModelSelection, modeGate,
  };
}
