'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { meetingsApi, type MeetingDetail } from '@/lib/builderforceApi';
import { useMediaRoom } from '@/lib/useMediaRoom';
import { VideoGrid } from '@/components/video/VideoGrid';
import { MediaControls } from '@/components/video/MediaControls';

/**
 * Full-screen live meeting room. Joins the meeting (marking presence + flipping
 * it live), opens the mesh media room, and renders the gallery + controls.
 * "Leave" exits for me; the organizer/manager additionally sees "End for all".
 */
export function MeetingRoom({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const t = useTranslations('meetings');
  const { user } = useAuth();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [roomKey, setRoomKey] = useState<string | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const me = { name: user?.name ?? user?.email ?? 'You', ref: user?.id ?? '' };

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

  const leave = useCallback(async () => {
    try { await meetingsApi.leave(meetingId); } catch { /* ignore */ }
    onClose();
  }, [meetingId, onClose]);

  const endForAll = useCallback(async () => {
    try { await meetingsApi.end(meetingId); } catch { /* ignore */ }
    onClose();
  }, [meetingId, onClose]);

  const m = detail?.meeting;
  const isHost = !!m && (m.createdBy === user?.id);
  const present = new Set(media.tiles.map((x) => x.ref));

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--bg-base)', display: 'flex', flexDirection: 'column',
      }}
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
        <button
          type="button"
          onClick={leave}
          style={{ padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
        >
          {t('leave')}
        </button>
      </div>

      {/* Stage */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, minHeight: 0 }}>
        {error ? (
          <div style={{ color: 'var(--error-text)', fontSize: 14 }}>{error}</div>
        ) : media.mediaError ? (
          <div style={{ color: 'var(--error-text)', fontSize: 14, marginBottom: 12 }}>{t('cameraError', { error: media.mediaError })}</div>
        ) : null}
        {!error && (
          <VideoGrid
            self={{ name: me.name, stream: media.localStream, camOn: media.camOn, micOn: media.micOn }}
            tiles={media.tiles}
          />
        )}

        {/* Roster (who's invited + who's live) */}
        {detail && detail.attendees.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 8 }}>
              {t('participants')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {detail.attendees.map((a) => (
                <span
                  key={a.id}
                  style={{
                    fontSize: 12, padding: '3px 10px', borderRadius: 999,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                    color: present.has(a.memberRef) || a.memberRef === me.ref ? 'var(--text-primary)' : 'var(--text-muted)',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: present.has(a.memberRef) || a.memberRef === me.ref ? 'var(--cyan-bright)' : 'var(--border-strong, #555)' }} />
                  {a.memberName}
                </span>
              ))}
            </div>
          </div>
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
