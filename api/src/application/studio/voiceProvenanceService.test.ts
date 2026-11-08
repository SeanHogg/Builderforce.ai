import { describe, expect, it } from 'vitest';
import { canonicalManifestJson, provenanceSigningInput } from '@builderforce/voice-provenance';
import { hmacBase64Url } from '../../infrastructure/crypto/hmac';
import {
  issueVoiceProvenance,
  pickAuthoritative,
  verifyVoiceProvenance,
  verifyVoiceProvenanceManifest,
  verifyVoiceProvenancePublic,
  VoiceProvenanceConflict,
  VoiceProvenanceInvalid,
  type ProvenanceClone,
  type VoiceProvenancePorts,
  type VoiceProvenanceRecord,
} from './voiceProvenanceService';
import { VoiceCloneConsentRequired, VoiceCloneForbidden, VoiceCloneNotFound } from './voiceCloneAccess';

const SHA = 'ab'.repeat(32);
const WM = '0123456789abcdef';

function clone(over: Partial<ProvenanceClone> = {}): ProvenanceClone {
  return { id: 7, tenantId: 1, userId: 'owner', consentAttestedAt: new Date('2026-06-01'), consentTextVersion: 'v1', ...over };
}

function memoryPorts(c: ProvenanceClone | null, secret = 'k1', visibility = 'private') {
  const rows: VoiceProvenanceRecord[] = [];
  let n = 0;
  const ports: VoiceProvenancePorts = {
    loadClone: async () => c,
    canUse: async (cl, tenantId) => cl.tenantId === tenantId,
    insert: async (r) => {
      if (rows.some((x) => x.manifest.watermarkId === r.manifest.watermarkId)) return 'duplicate';
      rows.push(r);
      return 'inserted';
    },
    find: async (by) =>
      rows.find((r) =>
        'watermarkId' in by ? r.manifest.watermarkId === by.watermarkId
        : 'audioSha256' in by ? r.manifest.audioSha256 === by.audioSha256
        : r.manifest.clipId === by.clipId) ?? null,
    cloneLabel: async () => ({ name: 'Alice', visibility }),
    sign: (input) => hmacBase64Url(secret, input),
    newClipId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => new Date('2026-11-08T10:00:00Z'),
  };
  return { ports, rows };
}

const input = { tenantId: 1, userId: 'u9', cloneId: 7, engine: 'clone-client', model: 'ssm-webgpu', audioSha256: SHA, watermarkId: WM };

describe('issueVoiceProvenance', () => {
  it('signs and persists a manifest bound to the clone, tenant and audio', async () => {
    const { ports, rows } = memoryPorts(clone());
    const rec = await issueVoiceProvenance(ports, input);
    expect(rec.manifest).toMatchObject({ v: 1, cloneId: 7, tenantId: 1, ownerUserId: 'u9', consentTextVersion: 'v1', audioSha256: SHA, watermarkId: WM });
    expect(rec.signature).toBe(await hmacBase64Url('k1', provenanceSigningInput(rec.manifest)));
    expect(rows).toHaveLength(1);
  });

  it('rejects a clone the tenant neither owns nor licenses', async () => {
    const { ports, rows } = memoryPorts(clone({ tenantId: 99 }));
    await expect(issueVoiceProvenance(ports, input)).rejects.toBeInstanceOf(VoiceCloneForbidden);
    expect(rows).toHaveLength(0);
  });

  it('rejects a missing clone', async () => {
    await expect(issueVoiceProvenance(memoryPorts(null).ports, input)).rejects.toBeInstanceOf(VoiceCloneNotFound);
  });

  it('rejects synthesis without a consent attestation', async () => {
    const { ports, rows } = memoryPorts(clone({ consentAttestedAt: null }));
    await expect(issueVoiceProvenance(ports, input)).rejects.toBeInstanceOf(VoiceCloneConsentRequired);
    expect(rows).toHaveLength(0);
  });

  it('rejects malformed hashes and watermark ids', async () => {
    const { ports } = memoryPorts(clone());
    await expect(issueVoiceProvenance(ports, { ...input, audioSha256: 'nope' })).rejects.toBeInstanceOf(VoiceProvenanceInvalid);
    await expect(issueVoiceProvenance(ports, { ...input, watermarkId: 'ZZ' })).rejects.toBeInstanceOf(VoiceProvenanceInvalid);
  });

  it('refuses a second clip claiming the same watermark id', async () => {
    const { ports } = memoryPorts(clone());
    await issueVoiceProvenance(ports, input);
    await expect(issueVoiceProvenance(ports, { ...input, audioSha256: 'cd'.repeat(32) })).rejects.toBeInstanceOf(VoiceProvenanceConflict);
  });
});

describe('public view', () => {
  it('names only marketplace voices and never the owner or tenant', async () => {
    const priv = memoryPorts(clone());
    await issueVoiceProvenance(priv.ports, input);
    const hidden = await verifyVoiceProvenancePublic(priv.ports, { watermarkId: WM });
    expect(hidden).toMatchObject({ valid: true, voiceName: null, engine: 'clone-client', model: 'ssm-webgpu', consentTextVersion: 'v1' });

    const pub = memoryPorts(clone(), 'k1', 'marketplace');
    await issueVoiceProvenance(pub.ports, { ...input, engine: 'clone-server' });
    const shown = await verifyVoiceProvenancePublic(pub.ports, { watermarkId: WM });
    expect(shown).toMatchObject({ valid: true, voiceName: 'Alice', selfReported: false, voiceDeleted: false });
    expect(JSON.stringify(shown)).not.toMatch(/ownerUserId|tenantId|signature/);
  });

  it('a self-reported clip never names the voice, even a marketplace one, and is never "verified"', async () => {
    const { ports } = memoryPorts(clone(), 'k1', 'marketplace');
    await issueVoiceProvenance(ports, input); // engine clone-client
    const view = await verifyVoiceProvenancePublic(ports, { watermarkId: WM }, SHA);
    expect(view).toMatchObject({ valid: true, selfReported: true, voiceName: null, trust: 'self_reported' });
  });

  it('computes trust on the server: verified / self_reported / watermark_only', async () => {
    const server = memoryPorts(clone());
    await issueVoiceProvenance(server.ports, { ...input, engine: 'clone-server' });
    expect(await verifyVoiceProvenancePublic(server.ports, { watermarkId: WM }, SHA)).toMatchObject({ trust: 'verified' });
    expect(await verifyVoiceProvenancePublic(server.ports, { watermarkId: WM }, 'cd'.repeat(32))).toMatchObject({ trust: 'watermark_only' });
    expect(await verifyVoiceProvenancePublic(server.ports, { watermarkId: WM })).toMatchObject({ trust: 'watermark_only' });
  });

  it('a deleted voice reports voiceDeleted and its name snapshot (unless self-reported)', async () => {
    const { ports, rows } = memoryPorts(clone({ name: 'Alice' }));
    await issueVoiceProvenance(ports, { ...input, engine: 'clone-server' });
    rows[0]!.cloneId = null;
    const view = await verifyVoiceProvenancePublic({ ...ports, cloneLabel: async () => null }, { watermarkId: WM });
    expect(view).toMatchObject({ voiceDeleted: true, voiceName: 'Alice' });
  });

  it('claims a hash match only when the supplied hash equals the signed one', async () => {
    const { ports } = memoryPorts(clone());
    await issueVoiceProvenance(ports, input);
    const idOnly = await verifyVoiceProvenancePublic(ports, { watermarkId: WM });
    expect(idOnly).toMatchObject({ valid: true, audioHashSupplied: false, audioMatchesSignedHash: false, selfReported: true });
    const same = await verifyVoiceProvenancePublic(ports, { watermarkId: WM }, SHA);
    expect(same).toMatchObject({ audioHashSupplied: true, audioMatchesSignedHash: true });
    const other = await verifyVoiceProvenancePublic(ports, { watermarkId: WM }, 'cd'.repeat(32));
    expect(other).toMatchObject({ audioHashSupplied: true, audioMatchesSignedHash: false });
  });

  it('still rejects an edited stored manifest before building the view', async () => {
    const { ports, rows } = memoryPorts(clone());
    await issueVoiceProvenance(ports, input);
    rows[0]!.manifest = { ...rows[0]!.manifest, cloneId: 8 };
    expect(await verifyVoiceProvenancePublic(ports, { watermarkId: WM })).toEqual({ valid: false, reason: 'bad_signature' });
  });
});

describe('pickAuthoritative — front-running', () => {
  const rec = (engine: string, createdAt: string) => ({ manifest: { engine, createdAt } });
  it('a server-synthesised registration beats an OLDER self-reported one for the same hash', () => {
    const clientFirst = rec('clone-client', '2026-01-01T00:00:00Z');
    const server = rec('clone-server', '2026-06-01T00:00:00Z');
    expect(pickAuthoritative([clientFirst, server])).toBe(server);
    expect(pickAuthoritative([server, clientFirst])).toBe(server);
  });
  it('among equals the oldest wins', () => {
    const a = rec('clone-client', '2026-01-01T00:00:00Z');
    const b = rec('clone-client', '2026-02-01T00:00:00Z');
    expect(pickAuthoritative([b, a])).toBe(a);
    expect(pickAuthoritative([])).toBeNull();
  });
});

describe('verification', () => {
  it('verifies by watermark id, audio hash and clip id', async () => {
    const { ports } = memoryPorts(clone());
    const rec = await issueVoiceProvenance(ports, input);
    for (const by of [{ watermarkId: WM }, { audioSha256: SHA }, { clipId: rec.manifest.clipId }]) {
      const v = await verifyVoiceProvenance(ports, by);
      expect(v).toMatchObject({ valid: true, signature: rec.signature });
    }
  });

  it('reports an unknown clip as not_found', async () => {
    const { ports } = memoryPorts(clone());
    expect(await verifyVoiceProvenance(ports, { watermarkId: 'ffffffffffffffff' })).toEqual({ valid: false, reason: 'not_found' });
  });

  it('detects a stored row whose manifest was edited (signature no longer covers it)', async () => {
    const { ports, rows } = memoryPorts(clone());
    await issueVoiceProvenance(ports, input);
    rows[0]!.manifest = { ...rows[0]!.manifest, tenantId: 2 };
    expect(await verifyVoiceProvenance(ports, { watermarkId: WM })).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('detects a signing-key change as invalid, not as a match', async () => {
    const issued = memoryPorts(clone(), 'k1');
    await issueVoiceProvenance(issued.ports, input);
    const rotated = memoryPorts(clone(), 'k2');
    rotated.rows.push(...issued.rows);
    expect(await verifyVoiceProvenance(rotated.ports, { watermarkId: WM })).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('verifies a held manifest + signature, and rejects a tampered copy', async () => {
    const { ports } = memoryPorts(clone());
    const rec = await issueVoiceProvenance(ports, input);
    expect(await verifyVoiceProvenanceManifest(ports, { manifest: rec.manifest, signature: rec.signature })).toMatchObject({ valid: true });

    const tampered = { ...rec.manifest, ownerUserId: 'someone-else' };
    expect(canonicalManifestJson(tampered)).not.toBe(canonicalManifestJson(rec.manifest));
    expect(await verifyVoiceProvenanceManifest(ports, { manifest: tampered, signature: rec.signature })).toEqual({ valid: false, reason: 'bad_signature' });
    expect(await verifyVoiceProvenanceManifest(ports, { manifest: { junk: true }, signature: rec.signature })).toEqual({ valid: false, reason: 'malformed' });
    expect(await verifyVoiceProvenanceManifest(ports, { manifest: rec.manifest, signature: 'AAAA' })).toEqual({ valid: false, reason: 'bad_signature' });
  });
});
