import { describe, it, expect } from 'vitest';
import { NeuralCodec } from './neural-codec';
import { melSpectrogram, DEFAULT_SAMPLE_RATE } from './audio-frames';
import type { PcmAudio } from './types';

function tone(seconds: number, f0: number): PcmAudio {
  const sr = DEFAULT_SAMPLE_RATE;
  const n = Math.round(seconds * sr);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    samples[i] = 0.6 * Math.sin(2 * Math.PI * f0 * t) + 0.3 * Math.sin(2 * Math.PI * f0 * 2.4 * t);
  }
  return { samples, sampleRate: sr };
}

describe('NeuralCodec', () => {
  it('encodes to [frames][quantizers] token ids inside the vocab range', () => {
    const codec = new NeuralCodec({ numQuantizers: 4, codebookSize: 256 });
    const codec_tokens = codec.encode(tone(0.2, 160));

    expect(codec_tokens.numQuantizers).toBe(4);
    expect(codec_tokens.codebookSize).toBe(256);
    expect(codec_tokens.tokens.length).toBe(codec_tokens.numFrames);
    for (const frame of codec_tokens.tokens) {
      expect(frame.length).toBe(4);
      for (const id of frame) {
        expect(id).toBeGreaterThanOrEqual(0);
        expect(id).toBeLessThan(256);
      }
    }
  });

  it('is deterministic', () => {
    const codec = new NeuralCodec();
    const a = codec.encode(tone(0.15, 200));
    const b = codec.encode(tone(0.15, 200));
    expect(a.tokens).toEqual(b.tokens);
  });

  it('decodes tokens back to PCM of the expected length', () => {
    const codec = new NeuralCodec();
    const tokens = codec.encode(tone(0.2, 180));
    const { samples, sampleRate } = codec.decode(tokens);
    expect(sampleRate).toBe(DEFAULT_SAMPLE_RATE);
    const expected = (tokens.numFrames - 1) * tokens.hopLength + tokens.frameLength;
    expect(samples.length).toBe(expected);
  });

  it('more quantizers reconstruct the mel more faithfully (RVQ residual shrink)', () => {
    const pcm = tone(0.2, 175);
    const mel = melSpectrogram(pcm.samples);
    const mid = mel.frames.length >> 1;

    const err = (numQuantizers: number): number => {
      const codec = new NeuralCodec({ numQuantizers });
      const recon = codec.decodeMel(codec.encodeMel(mel));
      let sum = 0;
      const orig = mel.frames[mid];
      const got = recon.frames[mid];
      for (let i = 0; i < orig.length; i++) sum += (orig[i] - got[i]) ** 2;
      return sum;
    };

    expect(err(6)).toBeLessThan(err(1));
  });

  it('accepts injected (trained) codebooks via options', () => {
    const numMels = 80;
    const codebooks = [
      Array.from({ length: 8 }, () => new Float32Array(numMels).fill(0.01)),
    ];
    const codec = new NeuralCodec({ numQuantizers: 1, codebookSize: 8, codebooks });
    const tokens = codec.encode(tone(0.1, 200));
    expect(tokens.numQuantizers).toBe(1);
    expect(tokens.codebookSize).toBe(8);
  });
});
