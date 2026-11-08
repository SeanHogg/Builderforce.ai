'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import PageContainer from '@/components/PageContainer';
import { verifyAudioFile, verifyWatermarkId, type VerifyOutcome } from '@/lib/voiceVerify';
import { voiceTrustOf, type VoiceTrust } from '@/lib/voiceTrust';

/**
 * VoiceVerifyClient — the public "did Builderforce make this clip?" page. Drop or
 * pick an audio file: it is decoded and checked in the browser, and only the
 * watermark id reaches the server, which answers with the public view (never the
 * owner or workspace). Also opened with `?watermarkId=` from a clip's badge.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  width: '100%',
  boxSizing: 'border-box',
};

type State = { phase: 'idle' } | { phase: 'checking' } | { phase: 'done'; outcome: VerifyOutcome } | { phase: 'failed' };

const WATERMARK_ID = /^[0-9a-f]{16}$/;

/** Success tone ONLY for a verified record; a licensee's registration is neutral, a bare mark is a warning. */
const TRUST_TONE: Record<VoiceTrust, { box: React.CSSProperties; text: string }> = {
  verified: { box: { borderColor: 'var(--success-border)', background: 'var(--success-bg)' }, text: 'var(--success-text)' },
  self_reported: { box: { borderColor: 'var(--border-default, var(--border-subtle))', background: 'var(--surface-interactive, var(--bg-base))' }, text: 'var(--text-secondary)' },
  watermark_only: { box: { borderColor: 'var(--warning-border)', background: 'var(--warning-bg)' }, text: 'var(--warning-text)' },
};

export default function VoiceVerifyClient() {
  const t = useTranslations('voice.provenance');
  const v = useTranslations('voice.provenance.verifyPage');
  const format = useFormatter();
  const params = useSearchParams();
  const input = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [dragging, setDragging] = useState(false);

  const run = useCallback(async (job: () => Promise<VerifyOutcome>) => {
    setState({ phase: 'checking' });
    try {
      setState({ phase: 'done', outcome: await job() });
    } catch {
      setState({ phase: 'failed' });
    }
  }, []);

  const prefill = params.get('watermarkId');
  useEffect(() => {
    if (prefill && WATERMARK_ID.test(prefill)) void run(() => verifyWatermarkId(prefill));
  }, [prefill, run]);

  const onFile = (file: File | undefined) => {
    if (file) void run(() => verifyAudioFile(file));
  };

  return (
    <PageContainer width="narrow">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-page-title)', margin: '0 0 8px' }}>{v('title')}</h1>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 20px' }}>{v('intro')}</p>

      <div
        data-testid="voice-verify-drop"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0]); }}
        style={{
          ...card,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          textAlign: 'center',
          padding: 24,
          borderStyle: 'dashed',
          borderColor: dragging ? 'var(--cyan-bright)' : 'var(--border-subtle)',
        }}
      >
        <span style={{ color: 'var(--text-muted)' }}>{v('dropHint')}</span>
        <button
          type="button"
          onClick={() => input.current?.click()}
          style={{
            minHeight: 44,
            padding: '0 18px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated, var(--bg-base))',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {v('choose')}
        </button>
        <input
          ref={input}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
          hidden
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      <div aria-live="polite" style={{ marginTop: 16 }}>
        {state.phase === 'checking' && <p style={{ color: 'var(--text-secondary)' }}>{v('checking')}</p>}
        {state.phase === 'failed' && <Notice tone="error" text={v('failed')} />}
        {state.phase === 'done' && state.outcome.kind === 'noWatermark' && <Notice tone="warning" text={v('noWatermark')} />}
        {state.phase === 'done' && state.outcome.kind === 'invalid' && <Notice tone="error" text={v('invalid')} />}
        {state.phase === 'done' && state.outcome.kind === 'unreadable' && <Notice tone="warning" text={v('unreadable')} />}
        {state.phase === 'done' && state.outcome.kind === 'verified' && (() => {
          const view = state.outcome.view;
          const trust = voiceTrustOf(view);
          const tone = TRUST_TONE[trust];
          const voiceName = view.voiceName ?? (view.voiceDeleted ? v('voiceDeleted') : trust === 'self_reported' ? null : v('privateVoice'));
          const summary = trust === 'verified'
            ? v('audioMatches')
            : trust === 'self_reported'
              ? v('selfReported')
              : v(view.audioMatchesSignedHash === false ? 'watermarkMismatch' : 'watermarkUnchecked', { clipId: view.clipId });
          const rows: Array<[string, string]> = [
            ...(voiceName ? [[v('voiceLabel'), voiceName] as [string, string]] : []),
            [v('markLabel'), view.watermarked ? t('signedWatermarked') : t('signedOnly')],
            [v('engineLabel'), view.engine],
            [v('modelLabel'), view.model],
            [v('consentLabel'), view.consentTextVersion],
            [v('createdLabel'), format.dateTime(new Date(view.createdAt), { dateStyle: 'medium', timeStyle: 'short' })],
            [v('clipLabel'), view.clipId],
          ];
          return (
            <div data-testid="voice-verify-result" data-trust={trust} style={{ ...card, ...tone.box }}>
              {trust === 'verified' && state.outcome.detected === 'watermark' && (
                <strong style={{ color: tone.text, display: 'block', overflowWrap: 'anywhere' }}>{v('watermarkDetected', { clipId: view.clipId })}</strong>
              )}
              <strong style={{ color: tone.text, display: 'block', overflowWrap: 'anywhere' }}>{summary}</strong>
              <dl style={{ margin: '12px 0 0', display: 'grid', gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)', gap: '6px 14px' }}>
                {rows.map(([label, value]) => (
                  <div key={label} style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
                    <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })()}
      </div>
    </PageContainer>
  );
}

function Notice({ tone, text }: { tone: 'warning' | 'error'; text: string }) {
  return (
    <div style={{ ...card, borderColor: `var(--${tone}-border)`, background: `var(--${tone}-bg)`, color: `var(--${tone}-text)` }}>
      {text}
    </div>
  );
}
