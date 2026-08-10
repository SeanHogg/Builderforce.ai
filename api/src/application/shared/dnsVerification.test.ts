import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_PREFIX,
  challengeRecordName,
  emailDomain,
  isSendableEmail,
  newChallengeToken,
  normalizeEmail,
  normalizeHostname,
  resolveCnameTargets,
  resolveTxtRecords,
  unquoteTxt,
  verifyChallengeToken,
} from './dnsVerification';
import { fakeFetch } from '../../../test/fakeDb';

describe('normalizeHostname', () => {
  it('accepts a plain hostname and lowercases it', () => {
    expect(normalizeHostname('Example.COM')).toBe('example.com');
    expect(normalizeHostname('shop.example.co.uk')).toBe('shop.example.co.uk');
  });

  it('tolerates a pasted URL rather than making the user strip it', () => {
    expect(normalizeHostname('https://shop.example.com/pricing?a=1')).toBe('shop.example.com');
    expect(normalizeHostname('http://example.com:8080')).toBe('example.com');
    expect(normalizeHostname('example.com.')).toBe('example.com');
  });

  it('rejects non-hostnames', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname('localhost')).toBeNull();
    expect(normalizeHostname('not a domain')).toBeNull();
    expect(normalizeHostname('192.168.0.1')).toBeNull();
  });

  it('REFUSES our own apex — a platform hostname is not a customer domain', () => {
    // Without this, a tenant could "claim" api.builderforce.ai and, once a cert
    // existed, have their site served on a platform host.
    expect(normalizeHostname('builderforce.ai')).toBeNull();
    expect(normalizeHostname('api.builderforce.ai')).toBeNull();
    expect(normalizeHostname('anything.builderforce.ai')).toBeNull();
  });
});

describe('challenge records', () => {
  it('namespaces the two proof purposes so they cannot collide', () => {
    expect(challengeRecordName('site', 'example.com')).toBe('_builderforce-challenge.example.com');
    expect(challengeRecordName('sender', 'example.com')).toBe('_builderforce-sender.example.com');
    expect(CHALLENGE_PREFIX.site).not.toBe(CHALLENGE_PREFIX.sender);
  });

  it('issues URL-safe 32-char tokens', () => {
    const token = newChallengeToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(newChallengeToken()).not.toBe(token);
  });
});

describe('unquoteTxt', () => {
  it('strips quoting and joins multi-chunk TXT payloads', () => {
    expect(unquoteTxt('"abc"')).toBe('abc');
    // A >255-byte TXT record comes back as several quoted chunks.
    expect(unquoteTxt('"abc" "def"')).toBe('abcdef');
    expect(unquoteTxt('bare')).toBe('bare');
  });
});

describe('resolveTxtRecords', () => {
  it('returns only TXT answers, unquoted', async () => {
    const fetchImpl = fakeFetch([{
      match: 'dns-query',
      json: { Status: 0, Answer: [
        { type: 5, data: 'cname.target.' },   // a CNAME in the chain — must be ignored
        { type: 16, data: '"token-abc"' },
        { type: 16, data: '"v=spf1 -all"' },
      ] },
    }]);
    await expect(resolveTxtRecords('_x.example.com', { fetchImpl })).resolves.toEqual([
      'token-abc', 'v=spf1 -all',
    ]);
  });

  it('treats NXDOMAIN, an empty answer and a resolver failure identically', async () => {
    const nxdomain = fakeFetch([{ match: 'dns-query', json: { Status: 3 } }]);
    await expect(resolveTxtRecords('_x.example.com', { fetchImpl: nxdomain })).resolves.toEqual([]);

    const http500 = fakeFetch([{ match: 'dns-query', status: 500 }]);
    await expect(resolveTxtRecords('_x.example.com', { fetchImpl: http500 })).resolves.toEqual([]);

    const thrown = (() => { throw new Error('network down'); }) as unknown as typeof fetch;
    await expect(resolveTxtRecords('_x.example.com', { fetchImpl: thrown })).resolves.toEqual([]);
  });
});

describe('verifyChallengeToken', () => {
  it('verifies when the token is present ALONGSIDE unrelated TXT records', async () => {
    const fetchImpl = fakeFetch([{
      match: 'dns-query',
      json: { Status: 0, Answer: [
        { type: 16, data: '"google-site-verification=xyz"' },
        { type: 16, data: '"the-token"' },
      ] },
    }]);
    const result = await verifyChallengeToken('site', 'example.com', 'the-token', { fetchImpl });
    expect(result.verified).toBe(true);
    expect(result.recordName).toBe('_builderforce-challenge.example.com');
  });

  it('does NOT verify on a near-miss, and reports what it found', async () => {
    const fetchImpl = fakeFetch([{
      match: 'dns-query',
      json: { Status: 0, Answer: [{ type: 16, data: '"the-token-but-longer"' }] },
    }]);
    const result = await verifyChallengeToken('site', 'example.com', 'the-token', { fetchImpl });
    expect(result.verified).toBe(false);
    expect(result.found).toEqual(['the-token-but-longer']);
  });

  it('never verifies an empty token, even against an empty record set', async () => {
    const fetchImpl = fakeFetch([{ match: 'dns-query', json: { Status: 0, Answer: [] } }]);
    await expect(verifyChallengeToken('site', 'example.com', '', { fetchImpl }))
      .resolves.toMatchObject({ verified: false });
    // Short-circuits before the resolver is even called.
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('queries the DoH resolver for the purpose-specific name', async () => {
    const fetchImpl = fakeFetch([{ match: 'dns-query', json: { Status: 0, Answer: [] } }]);
    await verifyChallengeToken('sender', 'acme.io', 'tok', { fetchImpl });
    expect(fetchImpl.calls[0]!.url).toContain(encodeURIComponent('_builderforce-sender.acme.io'));
    expect(fetchImpl.calls[0]!.url).toContain('type=TXT');
  });
});

describe('resolveCnameTargets', () => {
  it('returns lowercased, trailing-dot-stripped CNAME targets', async () => {
    const fetchImpl = fakeFetch([{
      match: 'dns-query',
      json: { Status: 0, Answer: [{ type: 5, data: 'BuilderForce.AI.' }] },
    }]);
    await expect(resolveCnameTargets('shop.example.com', { fetchImpl })).resolves.toEqual(['builderforce.ai']);
  });
});

describe('email helpers', () => {
  it('extracts the domain', () => {
    expect(emailDomain('Sam@Example.COM')).toBe('example.com');
    expect(emailDomain('no-at-sign')).toBeNull();
    expect(emailDomain('@example.com')).toBeNull();
  });

  it('accepts sendable addresses and rejects the rest', () => {
    expect(isSendableEmail('sam@example.com')).toBe(true);
    expect(isSendableEmail('sam+tag@sub.example.co.uk')).toBe(true);
    expect(isSendableEmail('sam@')).toBe(false);
    expect(isSendableEmail('sam @example.com')).toBe(false);
    expect(isSendableEmail('sam@localhost')).toBe(false);
    expect(isSendableEmail(null)).toBe(false);
    expect(isSendableEmail(`${'a'.repeat(320)}@example.com`)).toBe(false);
  });

  it('normalizes to ONE canonical storage form (suppression depends on it)', () => {
    expect(normalizeEmail('  Sam@Example.com ')).toBe('sam@example.com');
  });
});
