/**
 * Public types for the studio voice-cloning stack (Phase 1 + Phase 2).
 *
 * The pipeline is: reference PCM ──speaker-encoder──▶ SpeakerEmbedding, and
 * text ──tokenizer──▶ tokens ──SSM acoustic model (conditioned on the
 * embedding)──▶ CodecTokens ──neural-codec.decode──▶ PCM. CloneSynthesisResult
 * is deliberately shaped to match the server's `studio_voiceovers` row
 * (audio + wordTimestamps + durationMs) so cloned audio flows into captions,
 * the AvatarWidget, and the timeline with zero new plumbing.
 */

import type { ActiveDevice } from '../../types';

/** Mono PCM as Float32 samples in [-1, 1] plus its sample rate. The lingua
 *  franca between every stage — no Buffers, no base64, browser-native. */
export interface PcmAudio {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * A speaker identity vector — the zero-shot conditioning signal extracted from a
 * reference sample. L2-normalised so two clips of the same voice compare with
 * high cosine similarity. `data` is a plain number array for JSON/IDB/R2
 * portability, mirroring {@link MambaStateSnapshot}.
 */
export interface SpeakerEmbedding {
  data: number[];
  dim: number;
  /** Sample rate the reference was analysed at — guards mismatched re-use. */
  sampleRate: number;
}

/** A discrete, compressed acoustic representation: `numFrames` time steps, each
 *  with `numQuantizers` residual-codebook token ids in [0, codebookSize). This
 *  is exactly what the SSM acoustic model predicts and what the codec decodes. */
export interface CodecTokens {
  /** `[frame][quantizer]` token ids. */
  tokens: number[][];
  numFrames: number;
  numQuantizers: number;
  codebookSize: number;
  hopLength: number;
  frameLength: number;
  sampleRate: number;
}

/** One word's playback span in the synthesized audio — drives caption alignment
 *  and the AvatarWidget's `onBoundary`. */
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

/** The provider seam: a swappable clone-synthesis backend. The studio ships the
 *  built-in `ssm-webgpu` provider; the npm package can register a `tts-server`
 *  provider that calls the gateway. Consumers resolve a provider, never branch
 *  on the id themselves (DRY — mirrors the device-router pattern). */
export type VoiceProviderId = 'ssm-webgpu' | 'tts-server';

export interface SpeakerEncoderOptions {
  /** Output embedding dimensionality. Default 256. */
  embeddingDim?: number;
  sampleRate?: number;
  numMels?: number;
}

export interface NeuralCodecOptions {
  /** Residual quantizer depth. More stages → finer reconstruction. Default 4. */
  numQuantizers?: number;
  /** Entries per codebook. Default 256 (1 byte per token). */
  codebookSize?: number;
  sampleRate?: number;
  numMels?: number;
  frameLength?: number;
  hopLength?: number;
  /** Optional trained codebooks: `[quantizer][entry] = mel-dim centroid`. When
   *  omitted, deterministic seeded codebooks stand in (weight-free reference). */
  codebooks?: Float32Array[][];
}

export interface AcousticModelOptions {
  sampleRate?: number;
  numMels?: number;
  hopLength?: number;
  frameLength?: number;
  numQuantizers?: number;
  codebookSize?: number;
  /** Characters spoken per second — sets how many mel frames a text spans.
   *  Default 14 (≈ natural English narration pace). */
  charsPerSecond?: number;
  /** SSM hidden dimension for the acoustic recurrence. Default 256. */
  hiddenDim?: number;
}

export interface SynthesizeOptions {
  /** Text to speak. */
  text: string;
  /** The voice identity to speak it in. */
  speaker: SpeakerEmbedding;
  /** Playback speed multiplier (1 = natural). Scales predicted duration. */
  speed?: number;
  /** Forwarded to the device router; `cpu` forces the weight-free JS path. */
  device?: ActiveDevice;
  signal?: AbortSignal;
}

export interface CloneSynthesisResult {
  /** Synthesized mono PCM in [-1, 1]. */
  pcm: Float32Array;
  sampleRate: number;
  durationMs: number;
  /** Per-word spans, aligned to the synthesized audio. */
  wordTimestamps: WordTimestamp[];
  /** The discrete tokens the audio was decoded from — persisted for the cache
   *  key and for re-vocoding with a better codec later without re-running the
   *  acoustic model. */
  codecTokens: CodecTokens;
  /** Which hardware path actually ran. */
  activeDevice: ActiveDevice;
}

/** A clone-synthesis backend. The engine and the npm package both consume this
 *  interface so a new model is a registry entry, not a call-site rewrite. */
export interface VoiceProvider {
  readonly id: VoiceProviderId;
  /** Whether this backend can run in the current environment right now. The
   *  single source of truth for the honesty/fallback contract. */
  isAvailable(): Promise<boolean>;
  /** Human-readable reason when `isAvailable()` is false (shown to the user
   *  before any silent fallback). Null when available. */
  unavailableReason(): Promise<string | null>;
  synthesize(options: SynthesizeOptions): Promise<CloneSynthesisResult>;
}
