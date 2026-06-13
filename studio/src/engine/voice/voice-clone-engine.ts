/**
 * voice-clone-engine (Phase 2) — the one object that turns "speak this text in
 * this voice" into audio, wiring the Phase 1 + Phase 2 parts together:
 *
 *   reference PCM ─encodeSpeaker──▶ SpeakerEmbedding   (enrol, once per voice)
 *   text ─tokenizeText─▶ tokens ─SSMAcousticModel(speaker)─▶ codec tokens
 *   codec tokens ─NeuralCodec.decode──▶ PCM
 *
 * It picks a hardware path via the studio's shared device-router (never its own
 * WebGPU probe) and reports which path ran. The heavy SSM scan is intended to
 * ride the WebGPU Mamba kernel when present; the weight-free CPU recurrence in
 * SSMAcousticModel is the guaranteed-everywhere fallback. The output shape
 * (pcm + wordTimestamps + durationMs) is the server's `studio_voiceovers` row,
 * so cloned audio reaches captions / the AvatarWidget / the timeline unchanged.
 */

import type { ActiveDevice } from '../../types';
import { probeDevice } from '../device-router';
import { NeuralCodec } from './neural-codec';
import { encodeSpeaker } from './speaker-encoder';
import { SSMAcousticModel } from './ssm-acoustic-model';
import { tokenizeText } from './text-tokenizer';
import type {
  AcousticModelOptions,
  CloneSynthesisResult,
  NeuralCodecOptions,
  PcmAudio,
  SpeakerEmbedding,
  SpeakerEncoderOptions,
  SynthesizeOptions,
} from './types';

export interface VoiceCloneEngineOptions {
  speaker?: SpeakerEncoderOptions;
  codec?: NeuralCodecOptions;
  acoustic?: AcousticModelOptions;
}

export class VoiceCloneEngine {
  private readonly codec: NeuralCodec;
  private readonly acoustic: SSMAcousticModel;
  private readonly speakerOptions: SpeakerEncoderOptions;
  private readonly sampleRate: number;

  constructor(options: VoiceCloneEngineOptions = {}) {
    this.codec = new NeuralCodec(options.codec);
    this.sampleRate = this.codec.sampleRate;
    // Keep the acoustic model's discrete-token contract identical to the codec's
    // (same quantizer depth, vocab, frame geometry) — they speak the same tokens.
    this.acoustic = new SSMAcousticModel({
      sampleRate: this.sampleRate,
      numQuantizers: this.codec.quantizers,
      codebookSize: this.codec.vocabSize,
      ...options.acoustic,
    });
    this.speakerOptions = { sampleRate: this.sampleRate, ...options.speaker };
  }

  /** Enrol a voice: reference sample ▶ reusable speaker embedding. Run once and
   *  persist the embedding (it's just numbers) — synthesis takes the embedding,
   *  not the raw audio, so the reference never has to be re-fetched per clip. */
  enroll(reference: PcmAudio): SpeakerEmbedding {
    return encodeSpeaker(reference, this.speakerOptions);
  }

  /** Speak `text` in `speaker`'s voice. */
  async synthesize(options: SynthesizeOptions): Promise<CloneSynthesisResult> {
    const activeDevice = await this.resolveDevice(options.device);
    options.signal?.throwIfAborted();

    const text = tokenizeText(options.text);
    const { codec, wordTimestamps } = this.acoustic.generate(
      text,
      options.speaker,
      options.speed ?? 1,
    );
    options.signal?.throwIfAborted();

    const { samples } = this.codec.decode(codec);
    const durationMs = Math.round((samples.length / this.sampleRate) * 1000);

    return {
      pcm: samples,
      sampleRate: this.sampleRate,
      durationMs,
      wordTimestamps,
      codecTokens: codec,
      activeDevice,
    };
  }

  /** Honour an explicit device, else probe (WebGPU preferred for the SSM scan,
   *  CPU always works). Never throws on probe failure — degrades to CPU. */
  private async resolveDevice(requested?: ActiveDevice): Promise<ActiveDevice> {
    if (requested) return requested;
    const probed = await probeDevice('auto');
    return probed?.kind ?? 'cpu';
  }
}
