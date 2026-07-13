/**
 * @seanhogg/builderforce-studio — headless engine.
 *
 * Client-side video-generation engine: LCM / SD-Turbo diffusion on WebGPU or
 * WebNN (via onnxruntime-web), CLIP tokenization (via @huggingface/transformers),
 * Mamba SSM temporal coherence, and WebCodecs MP4 muxing. No React, no UI.
 *
 * For a ready-made React `<StudioPanel>`, install
 * @seanhogg/builderforce-studio-embedded, which builds on this engine.
 */

export type {
  MambaStateSnapshot,
  DeviceTarget,
  ActiveDevice,
  DiffusionModelId,
  CoherenceMode,
  InterpolationBackend,
  QualityMode,
  WeightSource,
  ModelDescriptor,
  OnnxFile,
  OrtInputSpec,
  OrtTensorDtype,
  VideoEngineOptions,
  GenerateOptions,
  GenerateResult,
  CameraMove,
  CharacterBible,
  PlannedShot,
  Storyboard,
  ScenePlanOptions,
  FrameIssueKind,
  FrameValidationIssue,
  FrameValidation,
  ValidateFrameOptions,
  ShotValidation,
  StoryboardGenerateOptions,
  StoryboardGenerateResult,
} from './types';

export { VideoEngine } from './engine/video-engine';
export { probeDevice, hasWebGPUSupport } from './engine/device-router';
export type { ProbedDevice } from './engine/device-router';
export { MODEL_REGISTRY } from './engine/diffusion-engine';
export { configureOnnxRuntime } from './engine/onnx-runtime-config';
export type { OnnxRuntimeConfigOptions } from './engine/onnx-runtime-config';
export {
  planScene,
  directorPass,
  shotPlannerPass,
  composeShotPrompt,
  cameraMoveToMotion,
  normaliseShotBudget,
  storyboardFrameCount,
  CAMERA_MOVES,
} from './engine/scene-planner';
export { validateFrame } from './engine/frame-validator';
export {
  slerp,
  planKeyframeIndices,
  buildInterpolatedSequence,
} from './engine/frame-interpolator';
export type { Keyframe, InterpolatedSlot } from './engine/frame-interpolator';
export {
  luma,
  estimateBlockMotion,
  interpolateFrames,
} from './engine/motion-interpolator';
export type { MotionField, MotionOptions } from './engine/motion-interpolator';

// ── Voice cloning (Phase 1: speaker encoder + neural codec; Phase 2: SSM
//    acoustic model + clone engine). Same headless, weight-free, device-routed
//    posture as the diffusion stack. See engine/voice/index.ts. ──
export {
  encodeSpeaker,
  verifySpeaker,
  NeuralCodec,
  tokenizeText,
  TEXT_VOCAB_SIZE,
  SSMAcousticModel,
  VoiceCloneEngine,
  SSMVoiceProvider,
  resolveVoiceProvider,
  encodeWav,
  encodeWavBlob,
  melSpectrogram,
  melToWaveform,
  cosineSimilarity,
} from './engine/voice';
export type {
  PcmAudio,
  SpeakerEmbedding,
  CodecTokens,
  WordTimestamp,
  VoiceProvider,
  VoiceProviderId,
  SpeakerEncoderOptions,
  NeuralCodecOptions,
  AcousticModelOptions,
  SynthesizeOptions,
  CloneSynthesisResult,
  VoiceCloneEngineOptions,
  ResolveProviderResult,
  TokenizedText,
  AcousticGenerateResult,
  MelConfig,
  MelSpectrogram,
} from './engine/voice';
