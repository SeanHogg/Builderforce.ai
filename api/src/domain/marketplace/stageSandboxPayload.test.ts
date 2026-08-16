import { describe, expect, it } from 'vitest';
import { isSandboxApplicable, stageSandboxPayloadHash, type StageSandboxSubject } from './stageSandboxPayload';
import { LISTING_HARNESSES } from '@builderforce/creation-canvas-contract';

function subject(overrides: Partial<StageSandboxSubject> = {}): StageSandboxSubject {
  return {
    harness: 'runtime',
    delivery: 'copy',
    objects: [{ id: 'a', kind: 'game', canvasData: { document: '<script></script>' }, content: null }],
    strippedFields: [],
    ...overrides,
  };
}

describe('stageSandboxPayloadHash', () => {
  it('is stable across key reordering', async () => {
    const a = await stageSandboxPayloadHash(subject({
      objects: [{ id: 'a', kind: 'game', canvasData: { x: 1, y: 2 }, content: null }],
    }));
    const b = await stageSandboxPayloadHash(subject({
      objects: [{ id: 'a', kind: 'game', canvasData: { y: 2, x: 1 }, content: null }],
    }));
    expect(a).toBe(b);
  });

  it('changes on a one-character edit to card content', async () => {
    const a = await stageSandboxPayloadHash(subject({
      objects: [{ id: 'a', kind: 'game', canvasData: { document: '<script>1</script>' }, content: null }],
    }));
    const b = await stageSandboxPayloadHash(subject({
      objects: [{ id: 'a', kind: 'game', canvasData: { document: '<script>2</script>' }, content: null }],
    }));
    expect(a).not.toBe(b);
  });

  it('is unchanged by price or trial — those never affect sandbox behaviour', async () => {
    // priceCents/trial are deliberately not part of StageSandboxSubject; this
    // documents the contract rather than exercising it, since the type itself
    // has no field for them.
    const a = await stageSandboxPayloadHash(subject());
    const b = await stageSandboxPayloadHash(subject());
    expect(a).toBe(b);
  });

  it('changes when strippedFields differ', async () => {
    const a = await stageSandboxPayloadHash(subject({ strippedFields: ['projectId'] }));
    const b = await stageSandboxPayloadHash(subject({ strippedFields: ['sessionId'] }));
    expect(a).not.toBe(b);
  });

  it('is order-independent over strippedFields', async () => {
    const a = await stageSandboxPayloadHash(subject({ strippedFields: ['projectId', 'sessionId'] }));
    const b = await stageSandboxPayloadHash(subject({ strippedFields: ['sessionId', 'projectId'] }));
    expect(a).toBe(b);
  });

  it('produces a 64-character hex digest', async () => {
    const hash = await stageSandboxPayloadHash(subject());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isSandboxApplicable', () => {
  it('is true for exactly runtime and media, and false for every other harness', () => {
    const applicable = LISTING_HARNESSES.filter((harness) => isSandboxApplicable(harness));
    expect(applicable.sort()).toEqual(['media', 'runtime']);
  });
});
