import { describe, expect, it } from 'vitest';
import { installRandomUUID, uuidV4 } from './randomUUID';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV4', () => {
  it('produces RFC 4122 version-4 ids that do not repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidV4()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });
});

describe('installRandomUUID', () => {
  it('adds randomUUID to a crypto that only has getRandomValues (old Safari)', () => {
    const legacy = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) } as unknown as Crypto;
    installRandomUUID(legacy);
    expect(typeof legacy.randomUUID).toBe('function');
    expect(legacy.randomUUID()).toMatch(V4);
  });

  it('leaves a native randomUUID alone', () => {
    const native = () => '00000000-0000-4000-8000-000000000000' as const;
    const modern = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto), randomUUID: native } as unknown as Crypto;
    installRandomUUID(modern);
    expect(modern.randomUUID).toBe(native);
  });
});
