/**
 * ssm-acoustic-model (Phase 2) — the heart of the clone: (text tokens + speaker
 * embedding) ▶ a sequence of neural-codec tokens, generated autoregressively by
 * a selective state-space recurrence.
 *
 * This is the same architectural bet Cartesia's Sonic makes — an SSM backbone,
 * not a transformer, over discrete audio codec tokens — which is why it slots
 * onto the studio's existing Mamba substrate (mamba-coherence's `advanceState`
 * is the same `h_{t+1} = A·h_t + B·x_t` recurrence, here widened to a hidden
 * vector and conditioned on the voice). SSMs are linear-time and streaming, the
 * property that makes the $0-infra in-browser clone path viable where a
 * transformer's quadratic attention would not be.
 *
 * Conditioning is what makes it a *clone*: the speaker embedding is mixed into
 * every input step AND biases the per-quantizer output projection, so the same
 * text produces a different token stream — hence a different timbre after the
 * codec decodes it — per voice.
 *
 * The projections are deterministic seeded matrices (weight-free, like every
 * other studio engine module). With placeholder weights the output is
 * structured, voice- and text-dependent acoustic texture, not intelligible
 * speech — intelligibility is what the Phase 2 *training* run buys, dropping
 * trained matrices in behind this identical interface (`AcousticWeights`). The
 * inference architecture, shapes, conditioning, and streaming recurrence are
 * what's built here.
 */

import { mulberry32 } from './audio-frames';
import { TEXT_VOCAB_SIZE, type TokenizedText } from './text-tokenizer';
import type { AcousticModelOptions, CodecTokens, SpeakerEmbedding, WordTimestamp } from './types';

const DEFAULTS = {
  sampleRate: 24_000,
  numMels: 80,
  hopLength: 256,
  frameLength: 1024,
  numQuantizers: 4,
  codebookSize: 256,
  charsPerSecond: 14,
  hiddenDim: 256,
};

export interface AcousticGenerateResult {
  codec: CodecTokens;
  wordTimestamps: WordTimestamp[];
}

export class SSMAcousticModel {
  private readonly cfg: Required<AcousticModelOptions>;
  /** Hashed character-embedding table [vocab][hiddenDim]. */
  private readonly charEmbed: Float32Array[];
  /** Speaker-embedding → hidden projection (sign matrix), built lazily per
   *  speaker-dim so a mismatched embedding can't silently mis-multiply. */
  private speakerProj: { dim: number; signs: Int8Array } | null = null;
  /** Per-quantizer output projection: hidden → codebookSize logits. */
  private readonly outProj: Int8Array[];
  /** SSM per-channel decay (diagonal A), stable in [0.5, 0.99). */
  private readonly decay: Float32Array;

  constructor(options: AcousticModelOptions = {}) {
    this.cfg = {
      sampleRate: options.sampleRate ?? DEFAULTS.sampleRate,
      numMels: options.numMels ?? DEFAULTS.numMels,
      hopLength: options.hopLength ?? DEFAULTS.hopLength,
      frameLength: options.frameLength ?? DEFAULTS.frameLength,
      numQuantizers: options.numQuantizers ?? DEFAULTS.numQuantizers,
      codebookSize: options.codebookSize ?? DEFAULTS.codebookSize,
      charsPerSecond: options.charsPerSecond ?? DEFAULTS.charsPerSecond,
      hiddenDim: options.hiddenDim ?? DEFAULTS.hiddenDim,
    };

    const h = this.cfg.hiddenDim;
    const embedRand = mulberry32(0x7e5);
    this.charEmbed = [];
    for (let t = 0; t < TEXT_VOCAB_SIZE; t++) {
      const vec = new Float32Array(h);
      // Sinusoidal-hashed embedding: stable, distinct per token, zero-mean.
      for (let i = 0; i < h; i++) {
        vec[i] = Math.sin((t + 1) * (i + 1) * 0.07 + embedRand() * 6.283);
      }
      this.charEmbed.push(vec);
    }

    this.outProj = [];
    for (let q = 0; q < this.cfg.numQuantizers; q++) {
      const signs = new Int8Array(h * this.cfg.codebookSize);
      const rand = mulberry32((0x017 + Math.imul(q, 0x9e37)) >>> 0);
      for (let i = 0; i < signs.length; i++) signs[i] = rand() < 0.5 ? -1 : 1;
      this.outProj.push(signs);
    }

    this.decay = new Float32Array(h);
    const decayRand = mulberry32(0xdeca7);
    for (let i = 0; i < h; i++) this.decay[i] = 0.5 + decayRand() * 0.49;
  }

  /**
   * Generate codec tokens for `text` in the voice described by `speaker`.
   * `speed` (>0, default 1) scales the predicted duration: 1.5 ≈ 50 % faster.
   */
  generate(text: TokenizedText, speaker: SpeakerEmbedding, speed = 1): AcousticGenerateResult {
    const h = this.cfg.hiddenDim;
    const charCount = Math.max(1, text.tokens.length);
    const seconds = charCount / (this.cfg.charsPerSecond * (speed > 0 ? speed : 1));
    const numFrames = Math.max(1, Math.round((seconds * this.cfg.sampleRate) / this.cfg.hopLength));

    const speakerVec = this.projectSpeaker(speaker, h);

    // SSM recurrence over output frames.
    const state = new Float32Array(h);
    const tokens: number[][] = [];
    for (let f = 0; f < numFrames; f++) {
      // Align this frame to a source character (monotonic, like a duration model).
      const charIdx = Math.min(
        text.tokens.length - 1,
        Math.floor((f / numFrames) * text.tokens.length),
      );
      const charVec = this.charEmbed[text.tokens[charIdx] ?? 0];

      // input_t = charEmbed ⊕ speaker (the conditioning), then SSM step.
      for (let i = 0; i < h; i++) {
        const input = charVec[i] + speakerVec[i];
        state[i] = this.decay[i] * state[i] + (1 - this.decay[i]) * input;
      }

      tokens.push(this.project(state, speakerVec));
    }

    return {
      codec: {
        tokens,
        numFrames,
        numQuantizers: this.cfg.numQuantizers,
        codebookSize: this.cfg.codebookSize,
        hopLength: this.cfg.hopLength,
        frameLength: this.cfg.frameLength,
        sampleRate: this.cfg.sampleRate,
      },
      wordTimestamps: alignWords(text, numFrames, this.cfg.hopLength, this.cfg.sampleRate),
    };
  }

  /** hidden state → one token id per quantizer (argmax of speaker-biased logits). */
  private project(state: Float32Array, speakerVec: Float32Array): number[] {
    const h = this.cfg.hiddenDim;
    const v = this.cfg.codebookSize;
    const ids: number[] = [];
    for (let q = 0; q < this.cfg.numQuantizers; q++) {
      const signs = this.outProj[q];
      let bestId = 0;
      let bestLogit = -Infinity;
      for (let c = 0; c < v; c++) {
        let logit = 0;
        const base = c * h;
        // Note: outProj is laid out [codebookSize][hidden] for cache-friendly rows.
        for (let i = 0; i < h; i++) logit += signs[base + i] * state[i];
        // Speaker bias: identity nudges which codebook entries win, so the same
        // text decodes to a different timbre per voice.
        logit += speakerVec[c % h] * 0.5;
        if (logit > bestLogit) {
          bestLogit = logit;
          bestId = c;
        }
      }
      ids.push(bestId);
    }
    return ids;
  }

  /** Project a speaker embedding to the hidden dim with a cached sign matrix. */
  private projectSpeaker(speaker: SpeakerEmbedding, h: number): Float32Array {
    const dim = speaker.dim;
    if (!this.speakerProj || this.speakerProj.dim !== dim) {
      const signs = new Int8Array(dim * h);
      const rand = mulberry32((0x53e9 ^ Math.imul(dim, 40503)) >>> 0);
      for (let i = 0; i < signs.length; i++) signs[i] = rand() < 0.5 ? -1 : 1;
      this.speakerProj = { dim, signs };
    }
    const { signs } = this.speakerProj;
    const out = new Float32Array(h);
    const scale = 1 / Math.sqrt(dim);
    for (let o = 0; o < h; o++) {
      let sum = 0;
      for (let i = 0; i < dim; i++) sum += signs[i * h + o] * speaker.data[i];
      out[o] = sum * scale;
    }
    return out;
  }
}

/** Distribute frames across words proportional to character length, then convert
 *  frame indices to milliseconds via the hop duration. */
function alignWords(
  text: TokenizedText,
  numFrames: number,
  hopLength: number,
  sampleRate: number,
): WordTimestamp[] {
  if (text.words.length === 0) return [];
  const totalChars = Math.max(1, text.tokens.length);
  const msPerFrame = (hopLength / sampleRate) * 1000;

  const result: WordTimestamp[] = [];
  for (const w of text.words) {
    const startFrame = Math.round((w.startChar / totalChars) * numFrames);
    const endFrame = Math.round((w.endChar / totalChars) * numFrames);
    result.push({
      word: w.word,
      startMs: Math.round(startFrame * msPerFrame),
      endMs: Math.round(endFrame * msPerFrame),
    });
  }
  return result;
}
