/**
 * Voice-cloning stack (Phase 1 + Phase 2) for @seanhogg/builderforce-studio.
 *
 * Phase 1 — the reusable foundation:
 *   • audio-frames   : shared PCM↔log-mel DSP (FFT, mel filterbank, vocoder)
 *   • speaker-encoder: reference audio ▶ speaker identity embedding
 *   • neural-codec   : PCM ▶ discrete RVQ tokens ▶ PCM
 *
 * Phase 2 — the clone model:
 *   • text-tokenizer    : text ▶ tokens + word spans
 *   • ssm-acoustic-model: (tokens + speaker) ▶ codec tokens via an SSM recurrence
 *   • voice-clone-engine: orchestrates the whole "speak text in a voice" path
 *   • provider          : the swappable backend seam + on-device provider
 *
 * Weight-free, deterministic reference implementations today (trained weights
 * drop in behind the same interfaces — see the Gap Register). Everything is
 * browser/Node/worker-portable.
 */

export {
  DEFAULT_SAMPLE_RATE,
  DEFAULT_FRAME_LENGTH,
  DEFAULT_HOP_LENGTH,
  DEFAULT_NUM_MELS,
  defaultMelConfig,
  melSpectrogram,
  melToWaveform,
  cosineSimilarity,
  l2Normalize,
  type MelConfig,
  type MelSpectrogram,
} from './audio-frames';

export { encodeSpeaker, verifySpeaker } from './speaker-encoder';
export { NeuralCodec } from './neural-codec';
export { tokenizeText, TEXT_VOCAB_SIZE, type TokenizedText } from './text-tokenizer';
export { SSMAcousticModel, type AcousticGenerateResult } from './ssm-acoustic-model';
export { VoiceCloneEngine, type VoiceCloneEngineOptions } from './voice-clone-engine';
export { SSMVoiceProvider, resolveVoiceProvider, type ResolveProviderResult } from './provider';
export { encodeWav, encodeWavBlob } from './wav';

export type {
  PcmAudio,
  SpeakerEmbedding,
  CodecTokens,
  WordTimestamp,
  VoiceProviderId,
  VoiceProvider,
  SpeakerEncoderOptions,
  NeuralCodecOptions,
  AcousticModelOptions,
  SynthesizeOptions,
  CloneSynthesisResult,
} from './types';
