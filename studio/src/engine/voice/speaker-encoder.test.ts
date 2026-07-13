import { describe, it, expect } from 'vitest';
import { encodeSpeaker, verifySpeaker } from './speaker-encoder';
import { cosineSimilarity, DEFAULT_SAMPLE_RATE } from './audio-frames';
import type { PcmAudio } from './types';

/** Two distinct synthetic "voices": different fundamentals + formant ratios.
 *  `variant` adds a small amplitude/phase jitter so "same voice, different
 *  utterance" isn't bit-identical — the realistic case for the same-speaker test. */
function voice(f0: number, formant: number, seconds: number, variant = 0): PcmAudio {
  const sr = DEFAULT_SAMPLE_RATE;
  const n = Math.round(seconds * sr);
  const samples = new Float32Array(n);
  const phase = variant * 0.31;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    samples[i] =
      0.6 * Math.sin(2 * Math.PI * f0 * t + phase) +
      0.3 * Math.sin(2 * Math.PI * f0 * formant * t) +
      0.1 * Math.sin(2 * Math.PI * f0 * (formant * 1.6) * t) +
      0.02 * variant * Math.sin(2 * Math.PI * 90 * t);
  }
  return { samples, sampleRate: sr };
}

describe('encodeSpeaker', () => {
  it('produces a unit-length embedding of the requested dimension', () => {
    const emb = encodeSpeaker(voice(140, 2.4, 0.4), { embeddingDim: 256 });
    expect(emb.dim).toBe(256);
    expect(emb.data.length).toBe(256);
    expect(Math.hypot(...emb.data)).toBeCloseTo(1, 4);
  });

  it('is deterministic for identical input', () => {
    const a = encodeSpeaker(voice(150, 2.2, 0.3));
    const b = encodeSpeaker(voice(150, 2.2, 0.3));
    expect(a.data).toEqual(b.data);
  });

  it('matches the same voice across different utterances better than across voices', () => {
    const ref = encodeSpeaker(voice(150, 2.2, 0.4, 0));
    const sameVoiceOtherClip = encodeSpeaker(voice(150, 2.2, 0.4, 1));
    const differentVoice = encodeSpeaker(voice(240, 3.1, 0.4, 0));

    const sameSim = cosineSimilarity(ref.data, sameVoiceOtherClip.data);
    const diffSim = cosineSimilarity(ref.data, differentVoice.data);
    expect(sameSim).toBeGreaterThan(diffSim);
  });

  it('near-silence degrades to a zero vector, not a throw', () => {
    const emb = encodeSpeaker({ samples: new Float32Array(0), sampleRate: DEFAULT_SAMPLE_RATE });
    expect(emb.data.every((x) => x === 0)).toBe(true);
  });
});

describe('verifySpeaker', () => {
  it('reports same==true above threshold', () => {
    const a = encodeSpeaker(voice(150, 2.2, 0.4, 0));
    const b = encodeSpeaker(voice(150, 2.2, 0.4, 0));
    const { same, similarity } = verifySpeaker(a, b);
    expect(similarity).toBeCloseTo(1, 4);
    expect(same).toBe(true);
  });
});
