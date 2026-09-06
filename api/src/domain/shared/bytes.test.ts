import { describe, expect, it } from 'vitest';
import {
  base64ToBytes, base64UrlDecode, base64UrlEncode, base64UrlToBytes, bytesToBase64, bytesToBase64Url,
  bytesToHex, hexToBytes, randomBase64Url, randomHex,
} from './bytes';

describe('bytes', () => {
  const sample = new Uint8Array([0, 1, 15, 16, 127, 128, 251, 255]);

  it('round-trips hex', () => {
    expect(bytesToHex(sample)).toBe('00010f107f80fbff');
    expect(hexToBytes('00010F107F80FBFF')).toEqual(sample);
    expect(bytesToHex(sample.buffer)).toBe('00010f107f80fbff');
  });

  it('fails closed on malformed hex', () => {
    expect(hexToBytes('abc')).toEqual(new Uint8Array());
    expect(hexToBytes('zz')).toEqual(new Uint8Array());
  });

  it('round-trips base64 and base64url, unpadded', () => {
    expect(bytesToBase64(sample)).toBe('AAEPEH+A+/8=');
    expect(bytesToBase64Url(sample)).toBe('AAEPEH-A-_8');
    expect(base64ToBytes('AAEPEH+A+/8=')).toEqual(sample);
    expect(base64ToBytes('AAEPEH+A+/8')).toEqual(sample);
    expect(base64UrlToBytes('AAEPEH-A-_8')).toEqual(sample);
  });

  it('encodes UTF-8 text, not code units', () => {
    const text = '{"sub":"ü","n":1}';
    expect(base64UrlDecode(base64UrlEncode(text))).toBe(text);
    expect(base64UrlEncode(text)).not.toMatch(/[+/=]/);
  });

  it('survives a large buffer', () => {
    const big = new Uint8Array(2_000_000);
    expect(bytesToBase64(big).length).toBeGreaterThan(0);
  });

  it('issues random tokens of the stated width', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomBase64Url(24)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomHex(16)).not.toBe(randomHex(16));
  });
});
