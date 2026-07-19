'use client';

/**
 * VoiceOutput — the Voice modality's CENTER pane: the generated speech is the
 * output, mirroring how Preview is the output for Designer. Shows the player plus
 * a live word-highlighted transcript while it plays; otherwise an empty/busy/
 * unavailable state. All the voice state lives in the IDE's useVoiceStudio hook;
 * this component only renders what the green Run (Generate) button produced.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { NarrationResult } from '@/lib/voiceEngine';

const wrap: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
};

export function VoiceOutput({
  result,
  audioUrl,
  busy,
  unavailable,
}: {
  result: NarrationResult | null;
  audioUrl: string | null;
  busy: boolean;
  unavailable: string | null;
}) {
  const t = useTranslations('voicePanel');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeWord, setActiveWord] = useState(-1);

  // Reset the highlight whenever a fresh result arrives.
  useEffect(() => { setActiveWord(-1); }, [result, audioUrl]);

  const onTimeUpdate = () => {
    const ms = (audioRef.current?.currentTime ?? 0) * 1000;
    const idx = result?.wordTimestamps.findIndex((w) => ms >= w.startMs && ms < w.endMs) ?? -1;
    setActiveWord(idx);
  };

  if (unavailable) {
    return (
      <div style={wrap}>
        <div style={{
          maxWidth: 520, textAlign: 'center',
          background: 'rgba(234,179,8,0.1)', border: '1px solid #eab308',
          color: '#fde68a', borderRadius: 12, padding: '20px 24px',
        }}>
          <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>⚠</div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{t('synthUnavailable')}</p>
          <p style={{ fontSize: '0.9rem', opacity: 0.9 }}>{unavailable}</p>
        </div>
      </div>
    );
  }

  if (busy) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: '2.5rem', marginBottom: 14, animation: 'pulse 1.5s ease-in-out infinite' }}>🎙</div>
        <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)' }}>{t('generatingSpeech')}</p>
      </div>
    );
  }

  if (!result || !audioUrl) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: '2.5rem', marginBottom: 14, opacity: 0.7 }}>🔊</div>
        <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
          {t('pressRun')}
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6, textAlign: 'center', maxWidth: 360 }}>
          {t('emptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...wrap, justifyContent: 'flex-start' }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <audio ref={audioRef} src={audioUrl} controls autoPlay onTimeUpdate={onTimeUpdate} style={{ width: '100%' }} />
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '8px 0 16px' }}>
          {t('durationSeconds', { seconds: Math.round(result.durationMs / 100) / 10 })} ·{' '}
          {result.engineId === 'clone-client' ? t('sourceOnDevice') : t('sourceServer')}
          {result.cloned ? '' : ` · ${t('fallbackVoice')}`}
        </div>
        <p style={{ lineHeight: 2, fontSize: '1.05rem' }}>
          {result.wordTimestamps.length > 0
            ? result.wordTimestamps.map((w, i) => (
                <span key={i} style={{
                  padding: '1px 3px', borderRadius: 4,
                  background: i === activeWord ? 'var(--coral-bright)' : 'transparent',
                  color: i === activeWord ? '#fff' : 'var(--text-primary)',
                  transition: 'background 0.1s',
                }}>{w.word} </span>
              ))
            : <span style={{ color: 'var(--text-muted)' }}>{t('noWordTiming')}</span>}
        </p>
      </div>
    </div>
  );
}
