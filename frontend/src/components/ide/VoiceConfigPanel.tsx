'use client';

/**
 * VoiceConfigPanel — the Voice modality's RIGHT pane: everything that configures
 * a generation (create/enrol a clone, pick the active voice, and the lines to
 * speak) lives here, the way Files/Train/Publish configure the other modalities.
 * The actual generation is the green Run (Generate) button in the top bar, which
 * calls `voice.synth()`. State is owned by the IDE's useVoiceStudio hook.
 */

import { useRef, useState } from 'react';
import { MicRecorder, type PcmAudio } from '@/lib/captureAudio';
import { hasWebGPU } from '@/lib/voiceEngine';
import type { VoiceStudio } from '@/lib/voiceStudio';

const section: React.CSSProperties = {
  padding: '14px 14px 16px',
  borderBottom: '1px solid var(--border-subtle)',
};
const heading: React.CSSProperties = {
  fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 10,
};
const label: React.CSSProperties = { display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 5 };
const input: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem',
};
const primaryBtn: React.CSSProperties = {
  fontSize: '0.82rem', fontWeight: 600, background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px', cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  fontSize: '0.78rem', background: 'none', border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 11px', cursor: 'pointer',
};

export function VoiceConfigPanel({ voice }: { voice: VoiceStudio }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...section, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <EngineBadge onDevice={voice.onDevice} />
      </div>

      {voice.error && (
        <div style={{ ...section, background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }}>
          ⚠ {voice.error}{' '}
          <button onClick={() => void voice.reload()} style={{ ...ghostBtn, marginLeft: 6 }}>Retry</button>
        </div>
      )}

      {/* Active voice + the lines to speak — the inputs the Generate button consumes. */}
      <div style={section}>
        <div style={heading}>Voice</div>
        {voice.loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</p>
        ) : voice.clones.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No voices yet — create one below.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {voice.clones.map((c) => (
              <button
                key={c.id}
                onClick={() => voice.setSelectedCloneId(c.id)}
                style={{
                  padding: '5px 11px', borderRadius: 16, cursor: 'pointer', fontSize: '0.8rem',
                  border: `1px solid ${c.id === voice.selectedCloneId ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                  background: c.id === voice.selectedCloneId ? 'rgba(255,107,107,0.12)' : 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                }}
              >
                {c.name}{voice.hasEmbedding(c.id) ? ' ·🔊' : ''}
              </button>
            ))}
          </div>
        )}

        <label style={label}>Text to speak</label>
        <textarea
          style={{ ...input, minHeight: 90, resize: 'vertical' }}
          value={voice.text}
          onChange={(e) => voice.setText(e.target.value)}
          placeholder="Write the lines to narrate, or ask the Brain…"
        />
        {voice.selectedCloneId > 0 && (
          <button
            onClick={() => void voice.deleteClone(voice.selectedCloneId)}
            style={{ ...ghostBtn, marginTop: 10 }}
          >
            Delete selected voice
          </button>
        )}
      </div>

      <CreateCloneForm voice={voice} />

      <p style={{ padding: '12px 14px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        Cloning is Pro-gated and requires consent. On-device synthesis is free; the metered server is the fallback.
      </p>
    </div>
  );
}

function EngineBadge({ onDevice }: { onDevice: boolean | null }) {
  if (onDevice === null) {
    return <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>probing engine…</span>;
  }
  const text = onDevice ? `On-device${hasWebGPU() ? ' · WebGPU' : ' · CPU'} (free)` : 'Server synthesis (metered)';
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 600, padding: '4px 10px', borderRadius: 16,
      border: '1px solid var(--border-subtle)', color: onDevice ? '#6ee7b7' : 'var(--text-secondary)',
      background: onDevice ? 'rgba(16,185,129,0.1)' : 'var(--bg-surface)',
    }}>{text}</span>
  );
}

function CreateCloneForm({ voice }: { voice: VoiceStudio }) {
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [reference, setReference] = useState<File | null>(null);
  const [recordedPcm, setRecordedPcm] = useState<PcmAudio | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);

  const toggleRecord = async () => {
    setErr(null);
    try {
      if (!recording) {
        recorderRef.current = new MicRecorder();
        await recorderRef.current.start();
        setRecording(true);
      } else {
        const pcm = await recorderRef.current!.stop();
        setRecordedPcm(pcm);
        setReference(null);
        setRecording(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Microphone capture failed.');
      setRecording(false);
    }
  };

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr('Name is required.');
    if (!consent) return setErr('You must attest consent to create a voice clone.');
    setBusy(true);
    try {
      await voice.createClone({ name, consentAttested: consent, reference, recordedPcm });
      setName(''); setConsent(false); setReference(null); setRecordedPcm(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={section}>
      <div style={heading}>Create a voice clone</div>
      <div style={{ marginBottom: 10 }}>
        <label style={label}>Voice name</label>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Narrator" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={label}>Reference sample</label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => { setReference(e.target.files?.[0] ?? null); setRecordedPcm(null); }}
          style={{ ...input, padding: 5 }}
        />
        {MicRecorder.supported && (
          <button
            onClick={() => void toggleRecord()}
            style={{
              ...ghostBtn, marginTop: 8,
              color: recording ? '#fca5a5' : 'var(--text-secondary)',
              borderColor: recording ? '#ef4444' : 'var(--border-subtle)',
            }}
          >
            {recording ? '⏹ Stop recording' : '🎤 Record from mic'}
          </button>
        )}
        {recordedPcm && (
          <p style={{ fontSize: '0.72rem', color: '#6ee7b7', marginTop: 6 }}>
            ✓ Recorded {(recordedPcm.samples.length / recordedPcm.sampleRate).toFixed(1)}s
          </p>
        )}
      </div>
      <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 10, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>This is my voice, or I have written permission to clone it. (Required — ToS §9a)</span>
      </label>
      {err && <p style={{ color: '#fca5a5', fontSize: '0.8rem', marginBottom: 8 }}>{err}</p>}
      <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void submit()}>
        {busy ? 'Creating…' : 'Create voice'}
      </button>
    </div>
  );
}
