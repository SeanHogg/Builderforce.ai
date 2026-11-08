import { describe, expect, it } from 'vitest';
import {
  canonicalManifestJson,
  parseVoiceProvenanceManifest,
  provenanceSigningInput,
  type VoiceProvenanceManifest,
} from './manifest';

const manifest: VoiceProvenanceManifest = {
  v: 1,
  clipId: '3f0c2a52-7f0e-4f69-9d5e-2d7f5b3a9c11',
  cloneId: 7,
  ownerUserId: 'u1',
  tenantId: 3,
  consentTextVersion: 'v1',
  engine: 'clone-server',
  model: 'tts-server',
  createdAt: '2026-11-08T10:00:00.000Z',
  audioSha256: 'a'.repeat(64),
  watermarkId: '0123456789abcdef',
};

describe('voice provenance manifest', () => {
  it('serialises in a fixed key order whatever order the object was built in', () => {
    const shuffled = Object.fromEntries(Object.entries(manifest).reverse()) as unknown as VoiceProvenanceManifest;
    expect(canonicalManifestJson(shuffled)).toBe(canonicalManifestJson(manifest));
    expect(canonicalManifestJson(manifest).startsWith('{"v":1,"clipId":')).toBe(true);
  });

  it('domain-separates the signing input', () => {
    expect(provenanceSigningInput(manifest)).toBe(`bf-voice-provenance/v1\n${canonicalManifestJson(manifest)}`);
  });

  it('parses a well-formed manifest and drops unknown keys', () => {
    expect(parseVoiceProvenanceManifest({ ...manifest, extra: 1 })).toEqual(manifest);
    expect(parseVoiceProvenanceManifest({ ...manifest, ownerUserId: null })?.ownerUserId).toBeNull();
  });

  it('rejects malformed manifests', () => {
    expect(parseVoiceProvenanceManifest(null)).toBeNull();
    expect(parseVoiceProvenanceManifest({ ...manifest, v: 2 })).toBeNull();
    expect(parseVoiceProvenanceManifest({ ...manifest, audioSha256: 'xyz' })).toBeNull();
    expect(parseVoiceProvenanceManifest({ ...manifest, watermarkId: 'ABC' })).toBeNull();
    expect(parseVoiceProvenanceManifest({ ...manifest, cloneId: '7' })).toBeNull();
  });
});
