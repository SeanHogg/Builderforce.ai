import { describe, expect, it } from 'vitest';
import { verifyPublishUpload, verifyUpload, signUpload, PUBLISH_URL_TTL_SECONDS } from '../../infrastructure/auth/uploadSign';
import { ALLOWED_ASSET_TYPES, isPublishableType, signPublishAsset } from './tenantAssetStore';

/** An R2 stand-in that only answers `head`. */
function bucket(objects: Record<string, string>) {
  return { head: async (key: string) => (key in objects ? { httpMetadata: { contentType: objects[key] } } : null) } as unknown as R2Bucket;
}

const SECRET = 'secret';
const AUDIO = '7/u1/1-aaaa.mp3';
const CHAPTERS = '7/u1/2-bbbb.json';
const DOC = '7/u1/3-cccc.pdf';
const OTHER = '8/u2/4-dddd.mp3';
const PRIVATE_AUDIO = '7/private/media/5-eeee.mp3';
const OTHER_PRIVATE_AUDIO = '8/private/media/6-ffff.mp3';
const files = {
  [AUDIO]: 'audio/mpeg', [CHAPTERS]: 'application/json+chapters', [DOC]: 'application/pdf', [OTHER]: 'audio/mpeg',
  '7/private/dsr/x.mp3': 'audio/mpeg', [PRIVATE_AUDIO]: 'audio/mpeg', [OTHER_PRIVATE_AUDIO]: 'audio/mpeg',
};

describe('signPublishAsset', () => {
  it('mints a signature that verifies and lasts years, for audio and chapters', async () => {
    for (const key of [AUDIO, CHAPTERS]) {
      const signed = await signPublishAsset(bucket(files), key, 7, SECRET);
      if (typeof signed === 'string') throw new Error(signed);
      expect(signed.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(PUBLISH_URL_TTL_SECONDS - 60);
      expect(await verifyPublishUpload(key, signed.exp, signed.sig, SECRET)).toBe(true);
    }
  });

  it('uses a dedicated derived key: a publish signature is not an upload signature, and vice versa', async () => {
    const signed = await signPublishAsset(bucket(files), AUDIO, 7, SECRET);
    if (typeof signed === 'string') throw new Error(signed);
    expect(await verifyUpload(AUDIO, signed.exp, signed.sig, SECRET)).toBe(false);
    const upload = await signUpload(AUDIO, SECRET);
    expect(await verifyPublishUpload(AUDIO, upload.exp, upload.sig, SECRET)).toBe(false);
    // and it does not verify under another secret or another key
    expect(await verifyPublishUpload(AUDIO, signed.exp, signed.sig, 'other')).toBe(false);
    expect(await verifyPublishUpload(OTHER, signed.exp, signed.sig, SECRET)).toBe(false);
  });

  it("signs the caller's OWN private media when it is audio, but never another tenant's", async () => {
    const own = await signPublishAsset(bucket(files), PRIVATE_AUDIO, 7, SECRET);
    if (typeof own === 'string') throw new Error(own);
    expect(await verifyPublishUpload(PRIVATE_AUDIO, own.exp, own.sig, SECRET)).toBe(true);
    expect(await signPublishAsset(bucket(files), OTHER_PRIVATE_AUDIO, 7, SECRET)).toBe('not-found');
  });

  it('refuses a key another tenant owns, a DSR private object and a missing object', async () => {
    expect(await signPublishAsset(bucket(files), OTHER, 7, SECRET)).toBe('not-found');
    expect(await signPublishAsset(bucket(files), '7/private/dsr/x.mp3', 7, SECRET)).toBe('not-found');
    expect(await signPublishAsset(bucket(files), '7/u1/9-zzzz.mp3', 7, SECRET)).toBe('not-found');
    expect(await signPublishAsset(bucket(files), undefined, 7, SECRET)).toBe('not-found');
  });

  it('refuses content types other than audio and chapters, so a private document gets no permanent link', async () => {
    expect(await signPublishAsset(bucket(files), DOC, 7, SECRET)).toBe('type-not-allowed');
    expect(isPublishableType('application/json')).toBe(false);
    expect(isPublishableType('image/png')).toBe(false);
    expect(isPublishableType('audio/ogg')).toBe(true);
  });

  it('reports unconfigured storage', async () => {
    expect(await signPublishAsset(undefined, AUDIO, 7, SECRET)).toBe('unconfigured');
  });

  it('lets the chapters file be uploaded at all', () => {
    expect(ALLOWED_ASSET_TYPES).toContain('application/json+chapters');
  });
});
