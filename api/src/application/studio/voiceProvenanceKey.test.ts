import { describe, expect, it } from 'vitest';
import { hkdfSha256 } from '../../infrastructure/crypto/hkdf';
import { provenanceSigningKey } from './voiceProvenancePorts';
import { VoiceProvenanceUnavailable } from './voiceProvenanceService';

describe('provenance signing key', () => {
  it('derives a stable key that differs from JWT_SECRET', async () => {
    const a = await provenanceSigningKey({ JWT_SECRET: 'jwt-master' });
    const b = await provenanceSigningKey({ JWT_SECRET: 'jwt-master' });
    expect(a).toBeInstanceOf(Uint8Array);
    expect(Array.from(a as Uint8Array)).toEqual(Array.from(b as Uint8Array));
    expect((a as Uint8Array).length).toBe(32);
    expect(Array.from(a as Uint8Array)).not.toEqual(Array.from(new TextEncoder().encode('jwt-master')));
  });

  it('binds the key to the info label and to the master', async () => {
    const x = await hkdfSha256('m', 'one');
    const y = await hkdfSha256('m', 'two');
    const z = await hkdfSha256('n', 'one');
    expect(Array.from(x)).not.toEqual(Array.from(y));
    expect(Array.from(x)).not.toEqual(Array.from(z));
  });

  it('uses VOICE_PROVENANCE_SECRET verbatim when provisioned, and refuses with neither', async () => {
    expect(await provenanceSigningKey({ VOICE_PROVENANCE_SECRET: 'own', JWT_SECRET: 'jwt' })).toBe('own');
    await expect(provenanceSigningKey({} as never)).rejects.toBeInstanceOf(VoiceProvenanceUnavailable);
  });
});
