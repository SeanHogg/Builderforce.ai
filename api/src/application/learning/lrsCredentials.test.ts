import { describe, expect, it } from 'vitest';
import { normaliseEndpoint, parseBasic } from './lrsCredentials';

describe('parseBasic', () => {
  const header = (key: string, secret: string) => `Basic ${btoa(`${key}:${secret}`)}`;

  it('reads the two halves of a credential', () => {
    expect(parseBasic(header('bfx_key', 'bfx_secret'))).toEqual({ key: 'bfx_key', secret: 'bfx_secret' });
  });

  it('splits on the FIRST colon, so a colon in the secret survives', () => {
    expect(parseBasic(header('k', 'a:b:c'))).toEqual({ key: 'k', secret: 'a:b:c' });
  });

  it('accepts the scheme in any case, which real clients vary', () => {
    expect(parseBasic(`basic ${btoa('k:s')}`)).toEqual({ key: 'k', secret: 's' });
  });

  it('returns null for anything that is not a Basic credential', () => {
    expect(parseBasic(null)).toBeNull();
    expect(parseBasic(undefined)).toBeNull();
    expect(parseBasic('')).toBeNull();
    expect(parseBasic('Bearer abc')).toBeNull();
    expect(parseBasic('Basic')).toBeNull();
    expect(parseBasic('Basic !!!not-base64!!!')).toBeNull();
  });

  it('refuses a decoded value with no key', () => {
    // `:secret` has an empty username, which authenticates nothing.
    expect(parseBasic(`Basic ${btoa(':secret')}`)).toBeNull();
    expect(parseBasic(`Basic ${btoa('no-colon-at-all')}`)).toBeNull();
  });

  it('allows an empty secret to reach the comparison rather than short-circuiting', () => {
    // Refusing here would branch before the constant-time compare; the empty
    // secret simply fails to match a real one.
    expect(parseBasic(`Basic ${btoa('key:')}`)).toEqual({ key: 'key', secret: '' });
  });
});

describe('normaliseEndpoint', () => {
  it('keeps origin and path, and trims the trailing slash', () => {
    expect(normaliseEndpoint('https://lrs.example.com/xapi/')).toBe('https://lrs.example.com/xapi');
    expect(normaliseEndpoint('  https://lrs.example.com  ')).toBe('https://lrs.example.com');
  });

  it('drops a query and a fragment — statements are posted to a path, not a URL', () => {
    expect(normaliseEndpoint('https://lrs.example.com/xapi?token=1#frag')).toBe('https://lrs.example.com/xapi');
  });

  it('REFUSES anything that is not absolute https rather than repairing it', () => {
    // Guessing at a half-typed endpoint is how statements get posted somewhere
    // nobody meant.
    expect(normaliseEndpoint('http://lrs.example.com/xapi')).toBeNull();
    expect(normaliseEndpoint('lrs.example.com/xapi')).toBeNull();
    expect(normaliseEndpoint('')).toBeNull();
    expect(normaliseEndpoint('javascript:alert(1)')).toBeNull();
  });
});
