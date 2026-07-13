'use client';

import { useTranslations } from 'next-intl';

/** Round control button — pressed (danger) when the track is OFF. */
function ControlButton({ on, onClick, onIcon, offIcon, labelOn, labelOff }: {
  on: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!on}
      aria-label={on ? labelOn : labelOff}
      title={on ? labelOn : labelOff}
      style={{
        width: 44, height: 44, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        background: on ? 'var(--bg-elevated)' : 'var(--error-bg, #7f1d1d)',
        color: on ? 'var(--text-primary)' : '#fff',
        border: `1px solid ${on ? 'var(--border-subtle)' : 'var(--error-border, #b91c1c)'}`,
      }}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

const camOnIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);
const camOffIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v2l4-3v8" /><line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const micOnIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);
const micOffIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);
const leaveIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="23" y1="1" x2="1" y2="23" />
  </svg>
);

/** The camera / mic (/ leave) control cluster shared by the ceremony + meeting room. */
export function MediaControls({
  camOn, micOn, onToggleCam, onToggleMic, onLeave, videoEnabled = true,
}: {
  camOn: boolean;
  micOn: boolean;
  onToggleCam: () => void;
  onToggleMic: () => void;
  onLeave?: () => void;
  /** Hide the camera control for audio-only calls. */
  videoEnabled?: boolean;
}) {
  const t = useTranslations('meetings');
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <ControlButton on={micOn} onClick={onToggleMic} onIcon={micOnIcon} offIcon={micOffIcon} labelOn={t('muteMic')} labelOff={t('unmuteMic')} />
      {videoEnabled && (
        <ControlButton on={camOn} onClick={onToggleCam} onIcon={camOnIcon} offIcon={camOffIcon} labelOn={t('stopCamera')} labelOff={t('startCamera')} />
      )}
      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          aria-label={t('leave')}
          title={t('leave')}
          style={{
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--error-bg, #7f1d1d)', color: '#fff', border: '1px solid var(--error-border, #b91c1c)',
          }}
        >
          {leaveIcon}
        </button>
      )}
    </div>
  );
}
