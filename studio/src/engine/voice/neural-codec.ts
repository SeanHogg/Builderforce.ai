/**
 * neural-codec (Phase 1) — the discrete acoustic representation everything else
 * speaks.
 *
 * A Residual Vector Quantizer (RVQ) over log-mel frames: encode maps each mel
 * frame to `numQuantizers` codebook token ids by repeatedly subtracting the
 * nearest centroid and re-quantizing the residual (the EnCodec/DAC/SoundStream
 * scheme); decode sums the chosen centroids back into a mel frame and inverts it
 * to PCM through the shared vocoder in audio-frames. Discretising audio this way
 * is what lets the SSM acoustic model (Phase 2) *predict* speech as a sequence of
 * tokens — an autoregressive model over a small vocabulary — instead of
 * regressing raw samples.
 *
 * The codebooks here are deterministic, seeded placeholders (weight-free, like
 * the rest of the engine). A trained codec drops its learned codebooks in via
 * `NeuralCodecOptions.codebooks` behind the identical interface; round-trip
 * fidelity improves, call sites don't change. RVQ already gives graceful
 * degradation — fewer quantizers = coarser audio, never broken.
 */

import {
  cosineSimilarity,
  defaultMelConfig,
  melToWaveform,
  melSpectrogram,
  mulberry32,
  type MelConfig,
  type MelSpectrogram,
} from './audio-frames';
import type { CodecTokens, NeuralCodecOptions, PcmAudio } from './types';

const DEFAULT_NUM_QUANTIZERS = 4;
const DEFAULT_CODEBOOK_SIZE = 256;

export class NeuralCodec {
  private readonly config: MelConfig;
  private readonly numQuantizers: number;
  private readonly codebookSize: number;
  /** `[quantizer][entry] = mel-dim centroid`. */
  private readonly codebooks: Float32Array[][];

  constructor(options: NeuralCodecOptions = {}) {
    this.config = defaultMelConfig({
      ...(options.sampleRate ? { sampleRate: options.sampleRate } : {}),
      ...(options.numMels ? { numMels: options.numMels } : {}),
      ...(options.frameLength ? { frameLength: options.frameLength } : {}),
      ...(options.hopLength ? { hopLength: options.hopLength } : {}),
    });
    this.numQuantizers = options.numQuantizers ?? DEFAULT_NUM_QUANTIZERS;
    this.codebookSize = options.codebookSize ?? DEFAULT_CODEBOOK_SIZE;
    this.codebooks =
      options.codebooks ??
      buildSeededCodebooks(this.numQuantizers, this.codebookSize, this.config.numMels);

    if (this.codebooks.length !== this.numQuantizers) {
      throw new Error(
        `NeuralCodec: ${this.codebooks.length} codebooks for ${this.numQuantizers} quantizers`,
      );
    }
  }

  get quantizers(): number { return this.numQuantizers; }
  get vocabSize(): number { return this.codebookSize; }
  get sampleRate(): number { return this.config.sampleRate; }

  /** PCM ▶ discrete tokens. */
  encode(audio: PcmAudio): CodecTokens {
    const mel = melSpectrogram(audio.samples, this.config);
    return this.encodeMel(mel);
  }

  /** log-mel spectrogram ▶ discrete tokens. The acoustic model and the analysis
   *  path share this so quantisation lives in one place. */
  encodeMel(mel: MelSpectrogram): CodecTokens {
    const tokens: number[][] = mel.frames.map((frame) => {
      const residual = new Float32Array(frame); // copy; we mutate per stage
      const ids: number[] = [];
      for (let q = 0; q < this.numQuantizers; q++) {
        const id = nearestCentroid(this.codebooks[q], residual);
        ids.push(id);
        const centroid = this.codebooks[q][id];
        for (let i = 0; i < residual.length; i++) residual[i] -= centroid[i];
      }
      return ids;
    });

    return {
      tokens,
      numFrames: tokens.length,
      numQuantizers: this.numQuantizers,
      codebookSize: this.codebookSize,
      hopLength: this.config.hopLength,
      frameLength: this.config.frameLength,
      sampleRate: this.config.sampleRate,
    };
  }

  /** Discrete tokens ▶ reconstructed log-mel spectrogram (sum of chosen
   *  centroids per frame). */
  decodeMel(codec: CodecTokens): MelSpectrogram {
    const frames: Float32Array[] = codec.tokens.map((ids) => {
      const mel = new Float32Array(this.config.numMels);
      for (let q = 0; q < ids.length && q < this.numQuantizers; q++) {
        const centroid = this.codebooks[q][ids[q]];
        for (let i = 0; i < mel.length; i++) mel[i] += centroid[i];
      }
      return mel;
    });
    return {
      frames,
      numMels: this.config.numMels,
      hopLength: codec.hopLength,
      frameLength: codec.frameLength,
      sampleRate: codec.sampleRate,
    };
  }

  /** Discrete tokens ▶ PCM waveform (mel reconstruction → shared vocoder). */
  decode(codec: CodecTokens): PcmAudio {
    const mel = this.decodeMel(codec);
    const samples = melToWaveform(mel);
    return { samples, sampleRate: codec.sampleRate };
  }
}

/** Nearest codebook entry to `vec` by cosine similarity (scale-invariant — log-mel
 *  energy magnitude varies with loudness; identity/structure lives in the
 *  *shape* of the spectrum, which cosine compares). */
function nearestCentroid(codebook: Float32Array[], vec: Float32Array): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < codebook.length; i++) {
    const score = cosineSimilarity(codebook[i], vec);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Deterministic seeded codebooks standing in for trained weights. Later stages
 * quantise smaller residuals, so each stage's centroids are scaled down by
 * `0.5^q` — the geometric residual-shrink an RVQ learns, approximated, so the
 * reference codec actually reduces error per stage instead of thrashing.
 */
function buildSeededCodebooks(
  numQuantizers: number,
  codebookSize: number,
  melDim: number,
): Float32Array[][] {
  const books: Float32Array[][] = [];
  for (let q = 0; q < numQuantizers; q++) {
    const rand = mulberry32((0xc0de ^ Math.imul(q + 1, 2246822519)) >>> 0);
    const scale = 0.5 ** q;
    const book: Float32Array[] = [];
    for (let e = 0; e < codebookSize; e++) {
      const centroid = new Float32Array(melDim);
      for (let i = 0; i < melDim; i++) centroid[i] = (rand() * 2 - 1) * scale;
      book.push(centroid);
    }
    books.push(book);
  }
  return books;
}
