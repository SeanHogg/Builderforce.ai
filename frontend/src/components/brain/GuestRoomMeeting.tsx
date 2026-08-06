'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMediaRoom } from '@/lib/useMediaRoom';
import { VideoGrid } from '@/components/video/VideoGrid';
import { guestMediaTransport } from '@/lib/guestRoomApi';

/**
 * The camera meeting inside a free, logged-out guest room.
 *
 * This is NOT a second video stack: it is the same mesh-WebRTC hook and the same
 * tile gallery that Standup, Planning and ad-hoc meetings already use
 * (`useMediaRoom` + `VideoGrid`). The only guest-specific part is the transport —
 * a guest token instead of a tenant JWT, and the room DO's `media` channel instead
 * of the meetings relay — which is passed in, not reimplemented.
 *
 * Media is peer-to-peer; nothing about the call is stored. Turning the camera on
 * spends no part of the room's turn allowance — that budget is for the Brain.
 */
export function GuestRoomMeeting({ code, name, onLeave }: { code: string; name: string; onLeave: () => void }) {
  const t = useTranslations('guestRoom');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const media = useMediaRoom(code, { name, ref: 'self' }, {
    enabled: true,
    transport: guestMediaTransport,
  });

  return (
    <div className="gr-meeting">
      <div className="gr-meeting-head">
        <span className="gr-meeting-title">
          {t('meetingTitle')}
          <small>{media.connected ? t('meetingLive') : t('meetingConnecting')}</small>
        </span>
        <div className="gr-meeting-actions">
          <button
            type="button"
            onClick={media.toggleMic}
            aria-pressed={media.micOn}
            className={media.micOn ? 'gr-media-btn' : 'gr-media-btn gr-media-off'}
          >
            {media.micOn ? t('micOn') : t('micOff')}
          </button>
          <button
            type="button"
            onClick={media.toggleCam}
            aria-pressed={media.camOn}
            className={media.camOn ? 'gr-media-btn' : 'gr-media-btn gr-media-off'}
          >
            {media.camOn ? t('camOn') : t('camOff')}
          </button>
          <button type="button" onClick={onLeave} className="gr-media-btn gr-media-leave">{t('endMeeting')}</button>
        </div>
      </div>

      {media.mediaError && <p className="gr-meeting-error" role="alert">{t('mediaBlocked')}</p>}

      <VideoGrid
        self={{ name: name || t('you'), ref: 'self', stream: media.localStream, camOn: media.camOn, micOn: media.micOn }}
        tiles={media.tiles}
        compact
        focusedId={focusedId}
        onSelect={setFocusedId}
        captions={media.captions}
        speaking={media.speaking}
      />

      <style>{`
        .gr-meeting { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
        .gr-meeting-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .gr-meeting-title { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .gr-meeting-title small { font-size: 11px; font-weight: 500; color: var(--text-muted); }
        .gr-meeting-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .gr-media-btn { padding: 6px 10px; font-size: 12px; font-weight: 600; border-radius: 8px; border: 1px solid var(--border-subtle); background: var(--bg-base); color: var(--text-primary); cursor: pointer; min-height: 32px; }
        .gr-media-off { background: var(--danger-soft, rgba(220, 38, 38, 0.12)); border-color: var(--danger, #dc2626); color: var(--danger, #dc2626); }
        .gr-media-leave { background: transparent; color: var(--text-muted); }
        .gr-meeting-error { margin: 0; font-size: 12px; color: var(--danger, #dc2626); }
        @media (max-width: 480px) {
          .gr-meeting-actions { width: 100%; }
          .gr-media-btn { flex: 1 1 auto; }
        }
      `}</style>
    </div>
  );
}
