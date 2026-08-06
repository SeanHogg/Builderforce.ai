'use client';

/**
 * GuestBrainPanel — the Brain/Ideas chat for LOGGED-OUT visitors.
 *
 * A lean view over the SAME package conversation hooks the authed BrainPanel uses
 * (useBrainChats + useBrainConversation) — so the streaming/agent-loop logic is
 * shared, not duplicated — but wired to the GUEST runtime (guestBrainConfig):
 * a guest token on the transport and localStorage persistence. No tickets/agents/
 * uploads/MCP: a guest gets a clean "try the Brain" chat. When they exhaust the
 * tiny daily allowance we swap the composer for a "sign up free to keep going"
 * wall — the conversion moment. Signing up carries their lead over (same
 * visitorId, existing marketing convert flow).
 *
 * A guest can also INVITE other people in. That turns the same panel into a shared
 * room: one transcript everybody reads and writes, one COMBINED turn allowance
 * (the same ten turns — inviting people is not a way to get more), and an optional
 * camera meeting between the participants, built on the very same mesh-video hook
 * Standup and Planning use. The conversation the host was already having comes
 * with them; "invite people to this chat" would be a strange promise otherwise.
 *
 * Rendered by ConditionalAppShell (the /brainstorm route + the floating drawer)
 * whenever `!hasTenant`, inside a BrainProvider configured with guestBrainConfig.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useBrainChats, useBrainConversation, isStepMessage, getBrainCapability, guestMessageAuthor, GUEST_ROOM_CHAT_ID, type BrainCapabilityId } from '@/lib/brain';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { BrainCapabilityPicker } from '@/components/brain/BrainCapabilityPicker';
import { GuestRoomBar } from '@/components/brain/GuestRoomBar';
import { GuestRoomJoinCard } from '@/components/guest/GuestRoomJoinCard';
import { GuestRoomMeeting } from '@/components/brain/GuestRoomMeeting';
import { mintGuestSession, getGuestUsage } from '@/lib/guestChatApi';
import { useGuestRoom } from '@/lib/useGuestRoom';
import {
  createGuestRoom, leaveGuestRoom, appendGuestRoomMessages, refreshGuestCredentials,
  getActiveGuestRoom, getGuestDisplayName, setGuestDisplayName, type GuestRoomState,
} from '@/lib/guestRoomApi';

/** How often the short-lived guest token is renewed (it expires after an hour). */
const CREDENTIAL_REFRESH_MS = 45 * 60 * 1000;

interface GuestBrainPanelProps {
  variant: 'page' | 'docked';
  /** A one-shot prompt (e.g. from the homepage hero) auto-sent once ready. */
  initialPrompt?: string;
  /** An invite link's room code — the visitor is asked to join it. */
  inviteCode?: string | null;
  /** Present in the docked drawer to close it. */
  onClose?: () => void;
}

export function GuestBrainPanel({ variant, initialPrompt, inviteCode, onClose }: GuestBrainPanelProps) {
  const t = useTranslations('guestBrain');
  const tRoom = useTranslations('guestRoom');
  const tBrainCaps = useTranslations('brain.capabilities');

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

  const capReached = remaining !== null && remaining <= 0;

  // Same capability tiles as the signed-in Brain Storm empty state — the first
  // surface a visitor lands on should show what this thing can make. Guest chats
  // are localStorage-only, so the choice is session state here rather than a
  // persisted chat field; the system-prompt injection is identical.
  const [capability, setCapability] = useState<BrainCapabilityId | null>(null);
  const capabilityPrompt = getBrainCapability(capability)?.systemPrompt;

  const chats = useBrainChats({});
  // In a room the conversation IS the room — one fixed chat id, so every
  // participant's hook resolves to the same transcript instead of each browser
  // picking whichever local chat it happened to have open.
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
  const room = useGuestRoom(roomCode, { name: displayName }, reloadMessages);

  // Re-broadcast my in-flight reply so the room watches the same answer arrive
  // rather than staring at a pause and then a finished wall of text. Only the
  // sender holds the gateway stream, so only the sender can relay it.
  const { relayStream } = room;
  const streamingText = conv.streamingText;
  useEffect(() => {
    if (!inRoom || !streamingText) return;
    relayStream(streamingText);
  }, [inRoom, streamingText, relayStream]);

  // Mint the guest token on mount so the first send is authenticated. A null
  // result means guest chat is disabled or unreachable → show the sign-in CTA.
  // A visitor already in a room keeps their room-bound token; re-minting here
  // would silently drop them out of the shared session.
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

  // Keep the guest token alive. Without this a session that runs past the token's
  // one-hour life goes quietly unauthenticated — and in a shared room that looks
  // like being dropped from the conversation mid-meeting.
  useEffect(() => {
    if (!ready || !enabled) return;
    let cancelled = false;
    const renew = () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      void refreshGuestCredentials().then((state) => {
        if (cancelled) return;
        // A room that has ended drops us back to solo — reflect that in the UI
        // instead of showing a room bar for a session that no longer exists.
        setRoomCode(getActiveGuestRoom());
        if (state) { setRemaining(state.remaining); setLimit(state.limit); }
      });
    };
    const timer = window.setInterval(renew, CREDENTIAL_REFRESH_MS);
    // Coming back to a backgrounded tab is the other moment a token is likely
    // stale — timers are throttled while hidden.
    document.addEventListener('visibilitychange', renew);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', renew);
    };
  }, [ready, enabled]);

  // In a room the COMBINED counter is the truth — it is what everyone is spending.
  useEffect(() => {
    if (!inRoom) return;
    if (room.remaining !== null) setRemaining(room.remaining);
    if (room.limit) setLimit(room.limit);
  }, [inRoom, room.remaining, room.limit]);

  // Auto-send the one-shot initial prompt exactly once, after the token is ready.
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (!ready || !enabled || capReached || pendingInvite) return;
    if (sentInitialRef.current || !initialPrompt?.trim()) return;
    sentInitialRef.current = true;
    void doSend(initialPrompt.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled, capReached, pendingInvite, initialPrompt]);

  const refreshUsage = useCallback(async () => {
    if (getActiveGuestRoom()) { await room.refresh(); return; }
    const usage = await getGuestUsage();
    if (usage) { setRemaining(usage.remaining); setLimit(usage.limit); setEnabled(usage.enabled); setRoomsEnabled(usage.roomsEnabled); }
  }, [room]);

  const doSend = useCallback(async (text: string) => {
    // Tell the room somebody is waiting on the Brain, so the others see why the
    // transcript has gone quiet instead of talking over the in-flight turn.
    if (getActiveGuestRoom()) room.setBusy(true);
    const ok = await conv.send(text);
    if (getActiveGuestRoom()) room.setBusy(false);
    // Whether or not the model answered, the server consumed one message — refresh
    // the counter so the wall appears the instant the allowance is spent.
    void refreshUsage();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, refreshUsage, room]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const isPage = variant === 'page';
  const visibleMessages = useMemo(() => conv.messages.filter((m) => !isStepMessage(m)), [conv.messages]);

  return (
    <div className={`gb-root ${isPage ? 'gb-page' : 'gb-docked'}`}>
      {/* Header */}
      <div className="gb-header">
        <span className="gb-brand">🧠 {t('brand')}</span>
        <div className="gb-header-right">
          <Link href="/register" className="gb-signup-link">{t('signUpFree')}</Link>
          {onClose && (
            <button type="button" onClick={onClose} aria-label={t('close')} className="gb-close">×</button>
          )}
        </div>
      </div>

      {/* Body */}
      {ready && !enabled ? (
        <GuestDisabledCTA t={t} />
      ) : pendingInvite && inviteCode ? (
        <GuestRoomJoinCard
          code={inviteCode}
          onJoined={(state) => { adoptRoom(state); setDisplayName(getGuestDisplayName()); }}
        />
      ) : (
        <>
          {inRoom && roomCode && (
            <GuestRoomBar
              code={roomCode}
              title={room.state?.title || tRoom('defaultTitle')}
              surface={room.state?.surface ?? 'chat'}
              participants={room.participants}
              maxParticipants={room.state?.maxParticipants ?? 0}
              remaining={room.remaining}
              limit={room.limit || limit}
              connected={room.connected}
              busyWith={room.busyWith}
              meetingOn={meetingOn}
              onToggleMeeting={() => setMeetingOn((on) => !on)}
              onLeave={exitRoom}
            />
          )}
          {inRoom && roomCode && meetingOn && (
            <GuestRoomMeeting code={roomCode} name={displayName} onLeave={() => setMeetingOn(false)} />
          )}

          <div className="gb-messages">
            {visibleMessages.length === 0 && !conv.streamingText && (
              <div className="gb-empty">
                <div className="gb-empty-emoji">💡</div>
                <div className="gb-empty-title">{inRoom ? tRoom('emptyTitle') : t('emptyTitle')}</div>
                <div className="gb-empty-body">{inRoom ? tRoom('emptyBody') : t('emptyBody')}</div>
                <BrainCapabilityPicker
                  surface="brainstorm"
                  value={capability}
                  onSelect={(id) => {
                    setCapability(id);
                    if (id) setInput((prev) => (prev.trim() ? prev : tBrainCaps(`${id}.starter`)));
                  }}
                  layout="tiles"
                  disabled={capReached}
                />
              </div>
            )}
            {visibleMessages.map((m) => {
              const author = m.role === 'user' ? guestMessageAuthor(m.metadata) : null;
              return (
                <div key={m.id} className={`gb-msg gb-msg-${m.role === 'user' ? 'user' : 'assistant'}`}>
                  {m.role === 'user'
                    ? (
                      <div className="gb-bubble gb-bubble-user">
                        {author && <span className="gb-author">{author}</span>}
                        {m.content}
                      </div>
                    )
                    : <div className="gb-bubble gb-bubble-assistant"><ChatMessageContent content={m.content} /></div>}
                </div>
              );
            })}
            {conv.streamingText ? (
              <div className="gb-msg gb-msg-assistant">
                <div className="gb-bubble gb-bubble-assistant"><ChatMessageContent content={conv.streamingText} /></div>
              </div>
            ) : room.streamingPeer ? (
              // Somebody ELSE asked: their relayed deltas, rendered exactly like my
              // own streaming bubble and captioned with whose turn produced it.
              <div className="gb-msg gb-msg-assistant">
                <div className="gb-bubble gb-bubble-assistant">
                  <span className="gb-author gb-author-muted">{tRoom('replyingTo', { name: room.streamingPeer.name })}</span>
                  <ChatMessageContent content={room.streamingPeer.text} />
                </div>
              </div>
            ) : null}
            {conv.error && !capReached && <div className="gb-error">{conv.error}</div>}
            {roomError && <div className="gb-error">{roomError}</div>}
          </div>

          {/* Composer OR the sign-up wall */}
          {capReached ? (
            <GuestCapWall t={t} tRoom={tRoom} limit={limit} shared={inRoom} />
          ) : (
            <form onSubmit={onSubmit} className="gb-composer">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSubmit(e as unknown as React.FormEvent); } }}
                placeholder={ready ? t('placeholder') : t('loading')}
                disabled={!ready || conv.sending}
                rows={isPage ? 3 : 2}
                className="gb-textarea"
                aria-label={t('placeholder')}
              />
              <div className="gb-composer-row">
                <span className="gb-remaining">
                  {remaining !== null
                    ? (inRoom ? tRoom('sharedRemaining', { count: remaining, limit }) : t('remaining', { count: remaining }))
                    : t('tagline')}
                </span>
                <div className="gb-composer-actions">
                  {/* Inviting people is only offered when this deployment can host
                      a shared room AND the visitor isn't already in one. */}
                  {!inRoom && roomsEnabled && ready && (
                    <button type="button" onClick={startRoom} disabled={joining} className="gb-invite">
                      {joining ? tRoom('starting') : tRoom('invitePeople')}
                    </button>
                  )}
                  <button type="submit" disabled={!ready || conv.sending || !input.trim()} className="gb-send">
                    {conv.sending ? t('sending') : t('send')}
                  </button>
                </div>
              </div>
            </form>
          )}
        </>
      )}

      <style>{`
        .gb-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-base); color: var(--text-primary); }
        .gb-page { max-width: 820px; width: 100%; margin: 0 auto; height: calc(100vh - 120px); min-height: 480px; border: 1px solid var(--border-subtle); border-radius: 14px; overflow: hidden; }
        .gb-header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
        .gb-brand { font-weight: 600; font-size: 15px; }
        .gb-header-right { display: flex; align-items: center; gap: 12px; }
        .gb-signup-link { font-size: 13px; font-weight: 600; color: var(--accent, #3b82f6); text-decoration: none; }
        .gb-close { background: transparent; border: none; color: var(--text-muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
        .gb-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        /* Wide enough for the capability tiles to sit two-or-more across; the
           tile grid is auto-fit so it collapses to one column on a phone. */
        .gb-empty { margin: auto; text-align: center; max-width: 560px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-muted); }
        .gb-empty-emoji { font-size: 40px; }
        .gb-empty-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }
        .gb-empty-body { font-size: 14px; line-height: 1.5; }
        .gb-msg { display: flex; }
        .gb-msg-user { justify-content: flex-end; }
        .gb-msg-assistant { justify-content: flex-start; }
        .gb-bubble { max-width: 88%; padding: 10px 13px; border-radius: 12px; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
        .gb-bubble-user { background: var(--accent, #3b82f6); color: #fff; border-bottom-right-radius: 4px; }
        .gb-bubble-assistant { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-bottom-left-radius: 4px; }
        /* Who said it — only meaningful in a shared room, where more than one
           person writes into the same transcript. */
        .gb-author { display: block; font-size: 11px; font-weight: 700; opacity: 0.85; margin-bottom: 3px; }
        /* On an assistant bubble the caption names whose turn this reply answers,
           so it reads as context rather than as the speaker. */
        .gb-author-muted { color: var(--text-muted); font-weight: 600; }
        .gb-error { font-size: 13px; color: var(--danger, #dc2626); background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 12px; }
        .gb-composer { flex-shrink: 0; border-top: 1px solid var(--border-subtle); padding: 10px 12px; background: var(--bg-elevated); }
        .gb-textarea { width: 100%; resize: none; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-base); color: var(--text-primary); padding: 9px 11px; font-size: 14px; font-family: inherit; box-sizing: border-box; }
        .gb-textarea:disabled { opacity: 0.6; }
        .gb-composer-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
        .gb-composer-actions { display: flex; align-items: center; gap: 8px; }
        .gb-remaining { font-size: 12px; color: var(--text-muted); }
        .gb-send { padding: 8px 18px; font-size: 14px; font-weight: 600; border: none; border-radius: 10px; background: var(--accent, #3b82f6); color: #fff; cursor: pointer; min-height: 36px; }
        .gb-send:disabled { opacity: 0.5; cursor: default; }
        .gb-invite { padding: 8px 14px; font-size: 13px; font-weight: 600; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-base); color: var(--text-primary); cursor: pointer; min-height: 36px; }
        .gb-invite:disabled { opacity: 0.5; cursor: default; }
        @media (max-width: 640px) {
          .gb-page { height: calc(100vh - 80px); border-radius: 0; border-left: none; border-right: none; }
          .gb-bubble { max-width: 92%; }
          .gb-composer-actions { width: 100%; }
          .gb-composer-actions .gb-send, .gb-composer-actions .gb-invite { flex: 1 1 auto; }
        }
      `}</style>
    </div>
  );
}

/** The conversion wall shown once the daily allowance is spent. */
function GuestCapWall({
  t, tRoom, limit, shared,
}: {
  t: ReturnType<typeof useTranslations>;
  tRoom: ReturnType<typeof useTranslations>;
  limit: number;
  /** In a room the allowance was spent by everyone together — say so. */
  shared: boolean;
}) {
  return (
    <div className="gb-wall">
      <div className="gb-wall-emoji">🚀</div>
      <div className="gb-wall-title">{t('wallTitle')}</div>
      <div className="gb-wall-body">{shared ? tRoom('wallBody', { count: limit }) : t('wallBody', { count: limit })}</div>
      <div className="gb-wall-actions">
        <Link href="/register" className="gb-wall-primary">{t('createFreeAccount')}</Link>
        <Link href="/login" className="gb-wall-secondary">{t('signIn')}</Link>
      </div>
      <style>{`
        .gb-wall { flex-shrink: 0; border-top: 1px solid var(--border-subtle); padding: 20px 16px; background: var(--bg-elevated); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .gb-wall-emoji { font-size: 32px; }
        .gb-wall-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
        .gb-wall-body { font-size: 13px; color: var(--text-muted); max-width: 340px; line-height: 1.5; }
        .gb-wall-actions { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }
        .gb-wall-primary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--accent, #3b82f6); color: #fff; border-radius: 10px; text-decoration: none; }
        .gb-wall-secondary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--bg-base); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 10px; text-decoration: none; }
      `}</style>
    </div>
  );
}

/** Shown when guest chat is disabled (kill switch) or unreachable. */
function GuestDisabledCTA({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="gb-disabled">
      <div className="gb-empty-emoji">🧠</div>
      <div className="gb-empty-title">{t('meetTitle')}</div>
      <div className="gb-empty-body">{t('meetBody')}</div>
      <div className="gb-wall-actions">
        <Link href="/register" className="gb-wall-primary">{t('createFreeAccount')}</Link>
        <Link href="/login" className="gb-wall-secondary">{t('signIn')}</Link>
      </div>
      <style>{`
        .gb-disabled { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; color: var(--text-muted); }
        .gb-disabled .gb-empty-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }
        .gb-disabled .gb-empty-body { font-size: 14px; max-width: 300px; line-height: 1.5; }
        .gb-disabled .gb-wall-actions { display: flex; gap: 10px; margin-top: 8px; }
        .gb-disabled .gb-wall-primary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--accent, #3b82f6); color: #fff; border-radius: 10px; text-decoration: none; }
        .gb-disabled .gb-wall-secondary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--bg-base); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 10px; text-decoration: none; }
      `}</style>
    </div>
  );
}
