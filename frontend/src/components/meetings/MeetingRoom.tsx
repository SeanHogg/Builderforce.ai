'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { meetingsApi, type MeetingDetail, type MeetingTranscript } from '@/lib/builderforceApi';
import { useMediaRoom } from '@/lib/useMediaRoom';
import { useSpeechCaptions, isSpeechCaptionsSupported } from '@/lib/useSpeechCaptions';
import { VideoGrid, type AgentTile } from '@/components/video/VideoGrid';
import { MediaControls } from '@/components/video/MediaControls';
import { MeetingTranscriptList } from './MeetingTranscriptList';
import { BrainPanel } from '@/components/brain/BrainPanel';
import { useIsMobile } from '@/lib/useIsMobile';

const TILE_SIZE_KEY = 'bf.meetingTileSize';

function readTileSize(): 'small' | 'large' {
  if (typeof window === 'undefined') return 'small';
  return window.localStorage.getItem(TILE_SIZE_KEY) === 'large' ? 'large' : 'small';
}

/**
 * Full-screen live meeting room. Joins the meeting (marking presence + flipping it
 * live), opens the mesh media room, and renders the gallery + controls.
 *
 * Cameras default to a SMALL tile size; the viewer can switch to large or spotlight
 * one participant. Agent attendees appear as avatar tiles and "speak" (LLM turn →
 * caption + browser voice). The local mic is transcribed in-browser for live captions
 * + a persisted transcript, which the organizer can turn into AI minutes.
 */
export function MeetingRoom({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const t = useTranslations('meetings');
  const { user } = useAuth();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [roomKey, setRoomKey] = useState<string | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcript, setTranscript] = useState<MeetingTranscript | null>(null);
  const [tileSize, setTileSize] = useState<'small' | 'large'>('small');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const [agentBusy, setAgentBusy] = useState<Set<string>>(() => new Set());
  const [ask, setAsk] = useState('');
  const [askAgentRef, setAskAgentRef] = useState<string>('');
  const isMobile = useIsMobile();

  const meRef = user?.id ?? '';
  const me = useMemo(() => ({ name: user?.name ?? user?.email ?? 'You', ref: meRef }), [user?.name, user?.email, meRef]);

  useEffect(() => { setTileSize(readTileSize()); }, []);

  useEffect(() => {
    let cancelled = false;
    meetingsApi.join(meetingId, { name: me.name, email: user?.email ?? undefined })
      .then((info) => {
        if (cancelled) return;
        setRoomKey(info.roomKey);
        setVideoEnabled(info.videoEnabled);
        setDetail(info.meeting);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not join'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const media = useMediaRoom(roomKey, me, { enabled: !!roomKey, audioOnly: !videoEnabled });

  // Live captions from the local mic (browser STT): interim shows on my tile; final
  // lines are persisted + broadcast to peers as captions.
  const onFinal = useCallback((text: string) => {
    setInterim('');
    meetingsApi.appendTranscript(meetingId, text).catch(() => { /* transient */ });
  }, [meetingId]);
  useSpeechCaptions({ enabled: media.connected && media.micOn, onInterim: setInterim, onFinal });

  const m = detail?.meeting;
  const isHost = !!m && (m.createdBy === user?.id);
  const isLive = m?.status === 'live' || m?.status === 'scheduled';
  const chatId = m?.chatId ?? null;

  const attendees = detail?.attendees ?? [];
  const agents: AgentTile[] = useMemo(
    () => attendees.filter((a) => a.memberKind !== 'human').map((a) => ({ ref: a.memberRef, name: a.memberName })),
    [attendees],
  );
  useEffect(() => { if (!askAgentRef && agents.length) setAskAgentRef(agents[0].ref); }, [agents, askAgentRef]);

  const present = new Set(media.tiles.map((x) => x.ref));

  // Merge my in-progress interim caption over the network caption map.
  const captions = useMemo(() => (
    interim && me.ref ? { ...media.captions, [me.ref]: interim } : media.captions
  ), [media.captions, interim, me.ref]);
  const speaking = useMemo(() => {
    if (interim && me.ref) { const s = new Set(media.speaking); s.add(me.ref); return s; }
    return media.speaking;
  }, [media.speaking, interim, me.ref]);

  const setSize = useCallback((next: 'small' | 'large') => {
    setTileSize(next);
    try { window.localStorage.setItem(TILE_SIZE_KEY, next); } catch { /* ignore */ }
  }, []);

  const askAgent = useCallback(async (ref: string, prompt?: string) => {
    if (!ref || agentBusy.has(ref)) return;
    setAgentBusy((prev) => new Set(prev).add(ref));
    try {
      await meetingsApi.agentTurn(meetingId, ref, prompt); // response arrives via the agent-say broadcast
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('agentTurnFailed'));
    } finally {
      setAgentBusy((prev) => { const n = new Set(prev); n.delete(ref); return n; });
    }
  }, [agentBusy, meetingId, t]);

  const sendAsk = useCallback(() => {
    const q = ask.trim();
    if (!q || !askAgentRef) return;
    setAsk('');
    void askAgent(askAgentRef, q);
  }, [ask, askAgentRef, askAgent]);

  // Transcript panel: fetch on open, then poll while the meeting is live.
  const loadTranscript = useCallback(() => {
    meetingsApi.transcript(meetingId).then(setTranscript).catch(() => { /* ignore */ });
  }, [meetingId]);
  useEffect(() => {
    if (!transcriptOpen) return;
    loadTranscript();
    if (m?.status === 'ended' || m?.status === 'cancelled') return;
    const timer = setInterval(loadTranscript, 5000);
    return () => clearInterval(timer);
  }, [transcriptOpen, loadTranscript, m?.status]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const generateMinutes = useCallback(async () => {
    setNotice(t('generatingMinutes'));
    try {
      await meetingsApi.summarize(meetingId);
      loadTranscript();
      setNotice(t('minutesReady'));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('minutesFailed'));
    }
  }, [meetingId, loadTranscript, t]);

  const leave = useCallback(async () => {
    try { await meetingsApi.leave(meetingId); } catch { /* ignore */ }
    onClose();
  }, [meetingId, onClose]);

  const endForAll = useCallback(async () => {
    try { await meetingsApi.end(meetingId); } catch { /* ignore */ }
    onClose();
  }, [meetingId, onClose]);

  const headerBtn = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
    background: active ? 'var(--bg-elevated)' : 'var(--bg-deep)',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    border: `1px solid ${active ? 'var(--border-strong, #555)' : 'var(--border-subtle)'}`,
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m?.title ?? t('joining')}
          </h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {media.connected ? t('liveCount', { count: media.tiles.length + 1 }) : t('connecting')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Camera size toggle */}
          <div role="group" aria-label={t('cameraSize')} style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            {(['small', 'large'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                aria-pressed={tileSize === s}
                style={{
                  padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: tileSize === s ? 'var(--bg-elevated)' : 'var(--bg-deep)',
                  color: tileSize === s ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {s === 'small' ? t('sizeSmall') : t('sizeLarge')}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setTranscriptOpen((o) => !o)} aria-pressed={transcriptOpen} style={headerBtn(transcriptOpen)}>
            <span aria-hidden>📝</span>{t('transcript')}
          </button>
          {chatId != null && (
            <button type="button" onClick={() => setChatOpen((o) => !o)} aria-pressed={chatOpen} style={headerBtn(chatOpen)}>
              <span aria-hidden>💬</span>{t('chatPanel')}
            </button>
          )}
          <button
            type="button"
            onClick={leave}
            style={{ padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {t('leave')}
          </button>
        </div>
      </div>

      {notice && (
        <div style={{ padding: '8px 16px', fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>{notice}</div>
      )}

      {/* Stage + side panels */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, minHeight: 0 }}>
          {error ? (
            <div style={{ color: 'var(--error-text)', fontSize: 14 }}>{error}</div>
          ) : media.mediaError ? (
            <div style={{ color: 'var(--error-text)', fontSize: 14, marginBottom: 12 }}>{t('cameraError', { error: media.mediaError })}</div>
          ) : null}
          {!error && (
            <VideoGrid
              self={{ name: me.name, ref: me.ref, stream: media.localStream, camOn: media.camOn, micOn: media.micOn }}
              tiles={media.tiles}
              agents={agents}
              size={tileSize}
              focusedId={focusedId}
              onSelect={setFocusedId}
              captions={captions}
              speaking={speaking}
            />
          )}

          {/* Agent voice controls — invite an agent attendee to speak. */}
          {isLive && agents.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>{t('agentVoice')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {agents.map((a) => (
                  <button
                    key={a.ref}
                    type="button"
                    onClick={() => askAgent(a.ref)}
                    disabled={agentBusy.has(a.ref)}
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 999, cursor: agentBusy.has(a.ref) ? 'default' : 'pointer', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', opacity: agentBusy.has(a.ref) ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <span aria-hidden>🗣</span>{agentBusy.has(a.ref) ? t('agentThinking', { name: a.name }) : t('askForUpdate', { name: a.name })}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {agents.length > 1 && (
                  <select
                    value={askAgentRef}
                    onChange={(e) => setAskAgentRef(e.target.value)}
                    aria-label={t('askWhichAgent')}
                    style={{ fontSize: 13, padding: '7px 8px', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                  >
                    {agents.map((a) => <option key={a.ref} value={a.ref}>{a.name}</option>)}
                  </select>
                )}
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendAsk(); } }}
                  placeholder={t('askAgentPlaceholder')}
                  style={{ flex: '1 1 220px', fontSize: 13, padding: '7px 10px', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                />
                <button type="button" onClick={sendAsk} disabled={!ask.trim()} style={{ fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: ask.trim() ? 'pointer' : 'default', background: 'var(--coral-bright)', color: 'var(--bg-deep)', border: 'none', opacity: ask.trim() ? 1 : 0.5 }}>
                  {t('askSend')}
                </button>
              </div>
            </div>
          )}

          {/* Roster (who's invited + who's live) */}
          {attendees.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 8 }}>
                {t('participants')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {attendees.map((a) => {
                  const here = a.memberKind !== 'human' || present.has(a.memberRef) || a.memberRef === me.ref;
                  return (
                    <span
                      key={a.id}
                      style={{
                        fontSize: 12, padding: '3px 10px', borderRadius: 999,
                        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                        color: here ? 'var(--text-primary)' : 'var(--text-muted)',
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: here ? 'var(--cyan-bright)' : 'var(--border-strong, #555)' }} />
                      {a.memberName}
                      {a.memberKind !== 'human' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {t('agent')}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Transcript panel */}
        {transcriptOpen && (
          <aside
            style={{
              display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface-card)',
              ...(isMobile ? { position: 'absolute', inset: 0, zIndex: 5 } : { flex: '0 0 340px', maxWidth: '100%', borderLeft: '1px solid var(--border-subtle)' }),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('transcript')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isHost && (
                  <button type="button" onClick={generateMinutes} style={{ fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                    {t('generateMinutes')}
                  </button>
                )}
                <button type="button" onClick={() => setTranscriptOpen(false)} aria-label={t('close')} style={{ fontSize: 16, lineHeight: 1, padding: 4, cursor: 'pointer', background: 'none', color: 'var(--text-muted)', border: 'none' }}>×</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 14, minHeight: 0 }}>
              {!isSpeechCaptionsSupported() && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{t('captionsUnsupported')}</div>
              )}
              <MeetingTranscriptList segments={transcript?.segments ?? []} summary={transcript?.summary ?? null} />
            </div>
          </aside>
        )}

        {/* Team chat panel */}
        {chatOpen && chatId != null && (
          <aside
            style={{
              display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface-card)',
              ...(isMobile ? { position: 'absolute', inset: 0, zIndex: 5 } : { flex: '0 0 380px', maxWidth: '100%', borderLeft: '1px solid var(--border-subtle)' }),
            }}
          >
            <BrainPanel variant="docked" initialChatId={chatId} onClose={() => setChatOpen(false)} />
          </aside>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 16, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <MediaControls
          camOn={media.camOn}
          micOn={media.micOn}
          onToggleCam={media.toggleCam}
          onToggleMic={media.toggleMic}
          onLeave={leave}
          videoEnabled={videoEnabled}
        />
        {isHost && (
          <button
            type="button"
            onClick={endForAll}
            style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, borderRadius: 999, cursor: 'pointer', background: 'var(--error-bg, #7f1d1d)', color: '#fff', border: '1px solid var(--error-border, #b91c1c)' }}
          >
            {t('endForAll')}
          </button>
        )}
      </div>
    </div>
  );
}
