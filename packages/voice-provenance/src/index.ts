export {
  VOICE_PROVENANCE_VERSION,
  SHA256_HEX,
  WATERMARK_ID_HEX,
  canonicalManifestJson,
  provenanceSigningInput,
  parseVoiceProvenanceManifest,
} from './manifest';
export type { VoiceProvenanceManifest, SignedVoiceProvenance } from './manifest';

export {
  WATERMARK_ID_HEX_LENGTH,
  WatermarkUnsupportedError,
  canWatermark,
  detectWatermark,
  embedWatermark,
  newWatermarkId,
} from './watermark';
export type { WatermarkDetection } from './watermark';

export { decodeWav, encodeWavPcm16, floatToPcm16, pcm16Bytes, wavPcm16DataBytes, wrapPcm16AsWav } from './pcm';
export type { DecodedWav } from './pcm';
