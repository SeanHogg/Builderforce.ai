import { describe, it, expect } from 'vitest';
import { tokenFromAddress } from './inboundEmail';

const TOKEN = 'a'.repeat(32);

describe('tokenFromAddress', () => {
  it('reads a plus-tagged token', () => {
    expect(tokenFromAddress(`wf+${TOKEN}@inbound.builderforce.ai`)).toBe(TOKEN);
  });
  it('reads a bare local-part token', () => {
    expect(tokenFromAddress(`${TOKEN}@inbound.builderforce.ai`)).toBe(TOKEN);
  });
  it('is case-insensitive on the local part', () => {
    expect(tokenFromAddress(`WF+${TOKEN.toUpperCase()}@x.com`)).toBe(TOKEN);
  });
  it('returns null when no token-shaped local-part is present', () => {
    expect(tokenFromAddress('hello@x.com')).toBeNull();
    expect(tokenFromAddress('not-an-address')).toBeNull();
    expect(tokenFromAddress('@x.com')).toBeNull();
  });
});
