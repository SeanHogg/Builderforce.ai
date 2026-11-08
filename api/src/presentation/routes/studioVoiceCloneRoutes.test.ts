import { describe, expect, it } from 'vitest';
import { toPublicClone } from './studioVoiceCloneRoutes';

describe('toPublicClone (list / marketplace / create payload)', () => {
  it('never carries the embedding, its ciphertext, or R2 keys', () => {
    const pub = toPublicClone({
      id: 1, tenantId: 1, segmentId: null, userId: 'u', ideProjectId: null, name: 'A', description: null,
      provider: 'p', referenceKey: 'secret/key.wav', embedding: [1, 2], embeddingEnc: 'v2:xx', embeddingIv: 'ab',
      visibility: 'marketplace', status: 'published', priceMillicents: 5, consentAttestedAt: new Date(),
      consentTextVersion: 'v1', createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/embedding|v2:xx|secret\/key/);
    expect(pub.hasReference).toBe(true);
  });
});
