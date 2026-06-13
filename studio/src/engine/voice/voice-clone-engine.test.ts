import { describe, it, expect } from 'vitest';
import { VoiceCloneEngine } from './voice-clone-engine';
import { SSMVoiceProvider, resolveVoiceProvider } from './provider';
import { encodeWav } from './wav';
import { DEFAULT_SAMPLE_RATE } from './audio-frames';
import type { PcmAudio, SpeakerEmbedding, VoiceProvider } from './types';

function voice(f0: number, formant: number, seconds = 0.4): PcmAudio {
  const sr = DEFAULT_SAMPLE_RATE;
  const n = Math.round(seconds * sr);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    samples[i] = 0.6 * Math.sin(2 * Math.PI * f0 * t) + 0.3 * Math.sin(2 * Math.PI * f0 * formant * t);
  }
  return { samples, sampleRate: sr };
}

describe('VoiceCloneEngine', () => {
  it('enrol → synthesize returns aligned audio + word timestamps', async () => {
    const engine = new VoiceCloneEngine();
    const speaker = engine.enroll(voice(150, 2.2));
    const result = await engine.synthesize({ text: 'hello there world', speaker });

    expect(result.sampleRate).toBe(DEFAULT_SAMPLE_RATE);
    expect(result.pcm.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.activeDevice).toBe('cpu'); // no WebGPU in the test runtime
    // one timestamp per word, monotonic and within the clip
    expect(result.wordTimestamps.map((w) => w.word)).toEqual(['hello', 'there', 'world']);
    let prev = -1;
    for (const w of result.wordTimestamps) {
      expect(w.startMs).toBeGreaterThanOrEqual(prev);
      expect(w.endMs).toBeLessThanOrEqual(result.durationMs + 1);
      prev = w.startMs;
    }
  });

  it('emits PCM inside the [-1, 1] contract (peak-normalised)', async () => {
    const engine = new VoiceCloneEngine();
    const speaker = engine.enroll(voice(150, 2.2));
    const { pcm } = await engine.synthesize({ text: 'normalise me please', speaker });
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0); // not silence
  });

  it('is deterministic for the same (text, voice)', async () => {
    const engine = new VoiceCloneEngine();
    const speaker = engine.enroll(voice(150, 2.2));
    const a = await engine.synthesize({ text: 'consistency matters', speaker });
    const b = await engine.synthesize({ text: 'consistency matters', speaker });
    expect(a.codecTokens.tokens).toEqual(b.codecTokens.tokens);
  });

  it('different voices produce different token streams for the same text (it clones)', async () => {
    const engine = new VoiceCloneEngine();
    const s1 = engine.enroll(voice(150, 2.2));
    const s2 = engine.enroll(voice(260, 3.3));
    const a = await engine.synthesize({ text: 'same words different voice', speaker: s1 });
    const b = await engine.synthesize({ text: 'same words different voice', speaker: s2 });
    expect(a.codecTokens.tokens).not.toEqual(b.codecTokens.tokens);
  });

  it('speed > 1 yields a shorter clip than speed < 1', async () => {
    const engine = new VoiceCloneEngine();
    const speaker = engine.enroll(voice(150, 2.2));
    const fast = await engine.synthesize({ text: 'the quick brown fox', speaker, speed: 2 });
    const slow = await engine.synthesize({ text: 'the quick brown fox', speaker, speed: 0.5 });
    expect(fast.durationMs).toBeLessThan(slow.durationMs);
  });

  it('output encodes to a valid 16-bit WAV', async () => {
    const engine = new VoiceCloneEngine();
    const speaker = engine.enroll(voice(150, 2.2));
    const { pcm, sampleRate } = await engine.synthesize({ text: 'hi', speaker });
    const wav = encodeWav({ samples: pcm, sampleRate });
    const head = new TextDecoder().decode(new Uint8Array(wav, 0, 4));
    expect(head).toBe('RIFF');
    expect(wav.byteLength).toBe(44 + pcm.length * 2);
  });
});

describe('resolveVoiceProvider (honesty / fallback contract)', () => {
  it('picks the on-device SSM provider when available', async () => {
    const ssm = new SSMVoiceProvider();
    const { provider, reason } = await resolveVoiceProvider([ssm]);
    expect(provider?.id).toBe('ssm-webgpu');
    expect(reason).toBeNull();
  });

  it('returns a reason (not a silent null) when every provider is unavailable', async () => {
    const dead: VoiceProvider = {
      id: 'tts-server',
      isAvailable: async () => false,
      unavailableReason: async () => 'no server configured',
      synthesize: async () => {
        throw new Error('unreachable');
      },
    };
    const { provider, reason } = await resolveVoiceProvider([dead]);
    expect(provider).toBeNull();
    expect(reason).toMatch(/no server configured/);
  });

  it('the SSM provider can enrol and synthesize end-to-end', async () => {
    const ssm = new SSMVoiceProvider();
    const speaker: SpeakerEmbedding = ssm.cloneEngine.enroll(voice(150, 2.2));
    const result = await ssm.synthesize({ text: 'provider path', speaker });
    expect(result.pcm.length).toBeGreaterThan(0);
  });
});
