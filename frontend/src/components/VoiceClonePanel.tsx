'use client';

/**
 * VoiceClonePanel — the IDE reference implementation for voice cloning (Voice
 * PRD #1994). Exercises the whole flow end-to-end so the UI/UX can be validated:
 * enrol a clone (file OR mic, with consent), list clones, synthesize text, and
 * play the result with live word highlighting.
 *
 * It prefers the FREE on-device WebGPU path: when the studio engine loads it
 * enrols a speaker embedding client-side and synthesis runs locally ($0); when
 * it can't, the same `narrate()` seam routes to the metered server. Synthesis
 * unavailability shows the honest reason (PRD §7), never a silent swap. The
 * engine choice is surfaced as a badge so the path is observable during review.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createVoiceClone,
  deleteVoiceClone,
  listVoiceClones,
  type VoiceClone,
} from '@/lib/voiceClones';
import { decodeToPcm, MicRecorder, type PcmAudio } from '@/lib/captureAudio';
import {
  deleteEmbedding,
  getOnDeviceEngine,
  hasWebGPU,
  loadEmbedding,
  narrate,
  narrationResultToObjectUrl,
  saveEmbedding,
  type NarrationResult,
  type SpeakerEmbedding,
} from '@/lib/voiceEngine';

const card: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  borderRadius: 12, padding: 20, marginBottom: 20,
};
const label: React.CSSProperties = { display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 };
const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.9rem',
};
const primaryBtn: React.CSSProperties = {
  fontSize: '0.875rem', fontWeight: 600, background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: '#fff', border: 'none', borderRadius: 10, padding: '8px 18px', cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  fontSize: '0.8rem', background: 'none', border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
};

export function VoiceClonePanel() {
  const [clones, setClones] = useState<VoiceClone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = still probing; true/false = on-device engine availability.
  const [onDevice, setOnDevice] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClones(await listVoiceClones());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voice clones.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void getOnDeviceEngine().then((e) => setOnDevice(Boolean(e))); }, []);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Voice Studio</h1>
        <EngineBadge onDevice={onDevice} />
      </div>
      <p style={{ color: 'var(--text-secondary)', margin: '4px 0 24px', fontSize: '0.9rem' }}>
        Create a custom voice clone and narrate text in it. Cloning is Pro-gated and requires consent.
      </p>

      {error && (
        <div style={{ ...card, background: 'rgba(239,68,68,0.12)', borderColor: '#ef4444', color: '#fca5a5' }}>
          ⚠ {error} <button onClick={() => void load()} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}

      <CreateCloneForm onDeviceReady={onDevice === true} onCreated={() => void load()} />

      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 12 }}>Your voices</h2>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : clones.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No voice clones yet. Create one above.</p>
        ) : (
          <SynthesizeSection clones={clones} onDeleted={() => void load()} />
        )}
      </div>
    </div>
  );
}

function EngineBadge({ onDevice }: { onDevice: boolean | null }) {
  if (onDevice === null) return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>probing engine…</span>;
  const text = onDevice
    ? `On-device${hasWebGPU() ? ' · WebGPU' : ' · CPU'} (free)`
    : 'Server synthesis (metered)';
  return (
    <span style={{
      fontSize: '0.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: 20,
      border: '1px solid var(--border-subtle)', color: onDevice ? '#6ee7b7' : 'var(--text-secondary)',
      background: onDevice ? 'rgba(16,185,129,0.1)' : 'var(--bg-surface)',
    }}>{text}</span>
  );
}

function CreateCloneForm({ onDeviceReady, onCreated }: { onDeviceReady: boolean; onCreated: () => void }) {
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
      // Enrol on-device when possible → embedding (the free synthesis identity).
      let embedding: SpeakerEmbedding | null = null;
      if (onDeviceReady) {
        const engine = await getOnDeviceEngine();
        const pcm = recordedPcm ?? (reference ? await decodeToPcm(reference) : null);
        if (engine && pcm) embedding = engine.enroll(pcm);
      }

      const created = await createVoiceClone({
        name: name.trim(),
        consentAttested: consent,
        reference,
        embedding: embedding?.data ?? null,
      });
      if (embedding) saveEmbedding(created.id, embedding);

      setName(''); setConsent(false); setReference(null); setRecordedPcm(null);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 12 }}>Create a voice clone</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={label}>Voice name</label>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Narrator" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={label}>Reference sample</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept="audio/*"
            onChange={(e) => { setReference(e.target.files?.[0] ?? null); setRecordedPcm(null); }}
            style={{ ...input, padding: 6, flex: 1, minWidth: 220 }} />
          {MicRecorder.supported && (
            <button onClick={() => void toggleRecord()}
              style={{ ...ghostBtn, color: recording ? '#fca5a5' : 'var(--text-secondary)', borderColor: recording ? '#ef4444' : 'var(--border-subtle)' }}>
              {recording ? '⏹ Stop' : '🎤 Record'}
            </button>
          )}
        </div>
        {recordedPcm && (
          <p style={{ fontSize: '0.75rem', color: '#6ee7b7', marginTop: 6 }}>
            ✓ Recorded {(recordedPcm.samples.length / recordedPcm.sampleRate).toFixed(1)}s
          </p>
        )}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>This is my voice, or I have written permission to clone it. (Required — ToS §9a)</span>
      </label>
      {err && <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: 10 }}>{err}</p>}
      <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void submit()}>
        {busy ? 'Creating…' : 'Create voice'}
      </button>
    </div>
  );
}

function SynthesizeSection({ clones, onDeleted }: { clones: VoiceClone[]; onDeleted: () => void }) {
  const [cloneId, setCloneId] = useState<number>(clones[0]?.id ?? 0);
  const [text, setText] = useState('The AI wrote this, and it speaks in my voice.');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [result, setResult] = useState<NarrationResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeWord, setActiveWord] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const synth = async () => {
    setBusy(true); setUnavailable(null); setResult(null);
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }
    try {
      // Prefer the on-device path when we hold a local embedding for this voice.
      const speaker = loadEmbedding(cloneId);
      const res = await narrate(cloneId, text, speaker);
      setResult(res);
      setAudioUrl(await narrationResultToObjectUrl(res));
    } catch (e) {
      setUnavailable(e instanceof Error ? e.message : 'Synthesis failed.');
    } finally {
      setBusy(false);
    }
  };

  const onTimeUpdate = () => {
    const ms = (audioRef.current?.currentTime ?? 0) * 1000;
    const idx = result?.wordTimestamps.findIndex((w) => ms >= w.startMs && ms < w.endMs) ?? -1;
    setActiveWord(idx);
  };

  const remove = async (id: number) => {
    await deleteVoiceClone(id);
    deleteEmbedding(id);
    onDeleted();
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {clones.map((c) => (
          <button key={c.id} onClick={() => setCloneId(c.id)}
            style={{
              padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: '0.85rem',
              border: `1px solid ${c.id === cloneId ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
              background: c.id === cloneId ? 'rgba(255,107,107,0.12)' : 'var(--bg-surface)',
              color: 'var(--text-primary)',
            }}>
            {c.name}{loadEmbedding(c.id) ? ' ·🔊' : ''}
          </button>
        ))}
      </div>

      <label style={label}>Text to speak</label>
      <textarea style={{ ...input, minHeight: 80, resize: 'vertical', marginBottom: 12 }}
        value={text} onChange={(e) => setText(e.target.value)} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy || !cloneId} onClick={() => void synth()}>
          {busy ? 'Synthesizing…' : '🎙 Narrate in this voice'}
        </button>
        <button onClick={() => void remove(cloneId)} style={ghostBtn}>Delete voice</button>
      </div>

      {/* Honesty contract: show the real reason, never a silent swap. */}
      {unavailable && (
        <div style={{ ...card, marginTop: 14, marginBottom: 0, background: 'rgba(234,179,8,0.1)', borderColor: '#eab308', color: '#fde68a' }}>
          ⚠ Cloning unavailable — {unavailable}
        </div>
      )}

      {result && audioUrl && (
        <div style={{ marginTop: 16 }}>
          <audio ref={audioRef} src={audioUrl} controls onTimeUpdate={onTimeUpdate} style={{ width: '100%' }} />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '6px 0' }}>
            {Math.round(result.durationMs / 100) / 10}s ·{' '}
            {result.engineId === 'clone-client' ? 'on-device (free)' : 'server'}
            {result.cloned ? '' : ' · fallback voice'}
          </div>
          <p style={{ lineHeight: 1.8 }}>
            {result.wordTimestamps.length > 0
              ? result.wordTimestamps.map((w, i) => (
                  <span key={i} style={{
                    padding: '1px 3px', borderRadius: 4,
                    background: i === activeWord ? 'var(--coral-bright)' : 'transparent',
                    color: i === activeWord ? '#fff' : 'var(--text-primary)',
                  }}>{w.word} </span>
                ))
              : <span style={{ color: 'var(--text-muted)' }}>(no word timing)</span>}
          </p>
        </div>
      )}
    </div>
  );
}
