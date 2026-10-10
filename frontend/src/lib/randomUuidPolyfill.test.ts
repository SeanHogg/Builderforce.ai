import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { RANDOM_UUID_POLYFILL } from './randomUuidPolyfill';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A plain-HTTP document's `crypto`: `getRandomValues` present, `randomUUID` absent. */
function insecureCrypto(): { getRandomValues: Crypto['getRandomValues']; randomUUID?: () => string } {
  return { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) as Crypto['getRandomValues'] };
}

describe('crypto.randomUUID polyfill', () => {
  it('defines RFC 4122 v4 ids on an insecure-context crypto', () => {
    const crypto = insecureCrypto();
    runInNewContext(RANDOM_UUID_POLYFILL, { crypto, Uint8Array });
    expect(typeof crypto.randomUUID).toBe('function');
    const ids = Array.from({ length: 200 }, () => crypto.randomUUID!());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves a native randomUUID alone', () => {
    const native = () => 'native';
    const crypto = { ...insecureCrypto(), randomUUID: native };
    runInNewContext(RANDOM_UUID_POLYFILL, { crypto, Uint8Array });
    expect(crypto.randomUUID).toBe(native);
  });

  it('does nothing, and does not throw, where there is no crypto at all', () => {
    expect(() => runInNewContext(RANDOM_UUID_POLYFILL, { Uint8Array })).not.toThrow();
  });
});
