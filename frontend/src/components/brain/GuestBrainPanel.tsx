/**
 * GuestBrainPanel — the Brain/Ideas chat for LOGGED-OUT visitors.
 *
 * The session (conversation, allowance, guest token, shared room) is
 * `useGuestBrainSession`; this file draws it through the ONE AI body every host
 * mounts (`WebAiSurface` + `SurfaceEmptyState`). No tickets/agents/
 * uploads/MCP: a guest gets a clean "try the Brain" chat. When they exhaust the tiny
 * daily allowance the composer becomes a "sign up free to keep going" wall — the
 * conversion moment. Signing up carries their lead over (same visitorId, existing
 * marketing convert flow).
 *
 * A guest can also INVITE other people in. That turns the same panel into a shared
 * room: one transcript everybody reads and writes, one COMBINED turn allowance
 * (inviting people is not a way to get more), and an optional camera meeting built on
 * the same mesh-video hook Standup and Planning use. The conversation the host was
 * already having comes with them.
 *
 * Rendered by ConditionalAppShell (the /brainstorm route + the floating drawer)
 * whenever `!hasTenant`, inside a BrainProvider configured with guestBrainConfig.
 */

import { useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { EMPTY_GATEWAY_MODEL_OPTIONS } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline, ChatErrorBanner, SurfaceEmptyState, SurfaceHeader } from '@seanhogg/builderforce-brain-ui';
import { WebAiSurface } from '@/components/ai-surface/WebAiSurface';
import { useBrainTimelineLabels } from '@/i18n/useBrainTimelineLabels';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { ChatInput } from '@/components/ChatInput';
import { BrainCapabilityPicker } from '@/components/brain/BrainCapabilityPicker';
import { GuestRoomBar } from '@/components/brain/GuestRoomBar';
import { GuestRoomJoinCard } from '@/components/guest/GuestRoomJoinCard';
import { GuestRoomMeeting } from '@/components/brain/GuestRoomMeeting';
import { GuestCapWall, GuestDisabledCTA } from './GuestBrainWalls';
import { useGuestBrainSession } from './useGuestBrainSession';
import { useModelRemedies } from './useModelRemedies';

/** `GuestAiUnavailableError`'s message — the guest transport's "no token to be had". */
const GUEST_AI_UNAVAILABLE = 'guest-ai-unavailable';

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
  const tCommon = useTranslations('common');
  const tBrainCaps = useTranslations('brain.capabilities');
  const timelineLabels = useBrainTimelineLabels();
  const s = useGuestBrainSession({ initialPrompt, inviteCode });
  const { conv, room } = s;
  // A guest gets the same remedies as the Brain — "Download a local model" / "Pick a
  // model" open THIS composer's Model tab (keyed by its id), which exists because the
  // composer below is handed the on-device model list.
  const composerId = useId();
  const { labels: remedyLabels, ...remedies } = useModelRemedies(conv.clearError, composerId, conv.retryLastTurn);
  const isPage = variant === 'page';
  const layout = isPage ? 'page' : 'docked';

  const header = (
    <SurfaceHeader
      title={t('brand')}
      running={conv.sending}
      actions={<Link href="/register" className="gb-signup-link">{t('signUpFree')}</Link>}
      {...(onClose ? { onClose } : {})}
      labels={{ close: t('close') }}
    />
  );

  // Before the conversation can start: the kill switch, or an invite to accept.
  const gate = s.ready && !s.enabled
    ? <GuestDisabledCTA layout={layout} />
    : s.pendingInvite && inviteCode
      ? <GuestRoomJoinCard code={inviteCode} onJoined={s.joinRoom} />
      : null;

  const hasThread = s.visibleMessages.length > 0 || !!conv.streamingText || !!room.streamingPeer;

  return (
    <div className={`gb-root ${isPage ? 'gb-page' : 'gb-docked'}`}>
      <WebAiSurface
        label={t('brand')}
        header={header}
        rail={!gate && s.inRoom && s.roomCode ? (
          <>
            <GuestRoomBar
              code={s.roomCode}
              title={room.state?.title || tRoom('defaultTitle')}
              surface={room.state?.surface ?? 'chat'}
              participants={room.participants}
              maxParticipants={room.state?.maxParticipants ?? 0}
              remaining={room.remaining}
              limit={room.limit || s.limit}
              connected={room.connected}
              busyWith={room.busyWith}
              meetingOn={s.meetingOn}
              onToggleMeeting={() => s.setMeetingOn((on) => !on)}
              onLeave={s.exitRoom}
            />
            {s.meetingOn && <GuestRoomMeeting code={s.roomCode} name={s.displayName} onLeave={() => s.setMeetingOn(false)} />}
          </>
        ) : undefined}
        empty={gate ?? (hasThread ? undefined : (
          <SurfaceEmptyState
            layout={layout}
            title={s.inRoom ? tRoom('emptyTitle') : t('emptyTitle')}
            hint={s.inRoom ? tRoom('emptyBody') : t('emptyBody')}
            starters={(
              <BrainCapabilityPicker
                surface="brainstorm"
                value={s.capability}
                onSelect={(id) => {
                  s.setCapability(id);
                  if (id) s.setInput((prev) => (prev.trim() ? prev : tBrainCaps(`${id}.starter`)));
                }}
                layout="tiles"
                disabled={s.capReached}
              />
            )}
          />
        ))}
        thread={(
          // THE shared transcript — a room message carries its writer as `authoredBy`,
          // so it is named like any participant. Somebody ELSE's turn streams as
          // theirs, captioned.
          <div className="gb-messages">
            <BrainTimeline
              conversationKey={s.activeChatId}
              messages={conv.messages}
              trace={[]}
              streamingText={conv.streamingText || room.streamingPeer?.text || ''}
              isRunning={conv.sending || !!room.streamingPeer}
              labels={timelineLabels}
              assistantName={t('brand')}
              renderMessage={(_msg, ctx) => <ChatMessageContent content={ctx.text} />}
              renderStreaming={(text) => (
                <>
                  {!conv.streamingText && room.streamingPeer && (
                    <span className="gb-author gb-author-muted">{tRoom('replyingTo', { name: room.streamingPeer.name })}</span>
                  )}
                  <ChatMessageContent content={text} />
                </>
              )}
            />
          </div>
        )}
        notices={gate ? undefined : (
          <>
            {/* A Hybrid turn that could not get a guest token says so in the visitor's language. */}
            {!s.capReached && <ChatErrorBanner className="gb-error" error={conv.error === GUEST_AI_UNAVAILABLE ? t('aiUnavailable') : conv.error} action={conv.errorAction ?? null} onDismiss={conv.clearError} {...remedies} labels={{ ...remedyLabels, dismiss: tCommon('dismiss') }} />}
            {s.roomError && <ChatErrorBanner className="gb-error" error={s.roomError} action={null} onDismiss={() => s.setRoomError(null)} labels={{ dismiss: tCommon('dismiss') }} />}
          </>
        )}
        // THE web footer: the run's approval (a guest run can pause on one too) and the
        // composer — or the sign-up wall in its place.
        footer={!gate}
        runKey={s.activeChatId}
        messages={conv.messages}
        timelineLabels={timelineLabels}
        composer={s.capReached ? (
              <GuestCapWall limit={s.limit} shared={s.inRoom} refusal={s.refusedWall} />
            ) : (
              <ChatInput
                contextUsage={conv.contextUsage}
                value={s.input}
                onChange={s.setInput}
                onSubmit={() => { void s.submit(); }}
                submitOnEnter
                placeholder={s.ready ? t('placeholder') : t('loading')}
                ariaLabel={t('placeholder')}
                submitLabel={t('send')}
                disabled={!s.ready}
                running={conv.sending}
                onStop={() => conv.stop()}
                // A guest has no workspace behind the box: no plan, meters or Evermind to show.
                account={null}
                // The Model tab: no gateway catalogue for a guest — the models downloaded
                // into THIS browser (the composer's on-device list) and the mode control.
                modelOptions={EMPTY_GATEWAY_MODEL_OPTIONS.options}
                modelSelection={s.modelSelection}
                onModelSelectionChange={s.setModelSelection}
                composerId={composerId}
                // THE first-run gate, shared with the landing prompt's auto-send — so the
                // question shows here for either, and nothing is sent before a choice.
                modeGate={s.modeGate}
                showVoice
                rows={isPage ? 3 : 2}
                // Inviting people is only offered when this deployment can host a
                // shared room AND the visitor isn't already in one.
                contextControls={!s.inRoom && s.roomsEnabled && s.ready ? (
                  <button type="button" onClick={() => { void s.startRoom(); }} disabled={s.joining} className="gb-invite">
                    {s.joining ? tRoom('starting') : tRoom('invitePeople')}
                  </button>
                ) : undefined}
                secondaryContent={(
                  <span className="gb-remaining">
                    {s.remaining !== null
                      ? (s.inRoom ? tRoom('sharedRemaining', { count: s.remaining, limit: s.limit }) : t('remaining', { count: s.remaining }))
                      : t('tagline')}
                  </span>
                )}
              />
            )}
      />

      <style>{`
        .gb-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .gb-page { max-width: 820px; width: 100%; margin: 0 auto; height: calc(100vh - 120px); min-height: 480px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); overflow: hidden; }
        .gb-signup-link { font-size: var(--font-size-small); font-weight: 600; color: var(--accent); text-decoration: none; }
        .gb-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        /* Who said it — only meaningful in a shared room, where more than one
           person writes into the same transcript. On an assistant bubble the caption
           names whose turn this reply answers, so it reads as context. */
        .gb-author { display: block; font-size: var(--font-size-eyebrow); font-weight: 700; opacity: 0.85; margin-bottom: 3px; }
        .gb-author-muted { color: var(--text-muted); font-weight: 600; }
        .gb-error { font-size: var(--font-size-small); color: var(--error-text, var(--danger)); background: var(--error-bg, var(--bg-elevated)); border-radius: var(--radius-md); padding: 8px 12px; }
        .gb-remaining { font-size: var(--font-size-small); color: var(--text-muted); }
        .gb-invite { padding: 0 12px; font-size: var(--font-size-small); font-weight: 600; border: none; border-radius: var(--radius-full); background: transparent; color: var(--text-muted); cursor: pointer; min-height: 32px; white-space: nowrap; }
        .gb-invite:hover:not(:disabled) { color: var(--text-primary); background: var(--surface-interactive, var(--bg-elevated)); }
        .gb-invite:disabled { opacity: 0.5; cursor: default; }
        @media (max-width: 640px) {
          .gb-page { height: calc(100vh - 80px); border-radius: 0; border-left: none; border-right: none; }
        }
      `}</style>
    </div>
  );
}
