import { describe, expect, it } from 'vitest';
import { amzDate, canonicalUri, signAwsRequest } from './awsSigV4';

const FIXED_DATE = new Date('2015-08-30T12:36:00Z');

describe('amzDate', () => {
  it('formats the AWS basic ISO 8601 date + dateStamp', () => {
    expect(amzDate(FIXED_DATE)).toEqual({ amzDate: '20150830T123600Z', dateStamp: '20150830' });
  });
});

describe('canonicalUri', () => {
  it('percent-encodes each path segment, preserving slashes', () => {
    // A Bedrock model id contains `:` and `.`, which must be percent-encoded
    // per AWS's rules — this is the concrete case that motivated per-segment
    // encoding rather than leaving the path as-is.
    expect(canonicalUri('/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse'))
      .toBe('/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/converse');
  });

  it('leaves already-safe segments untouched', () => {
    expect(canonicalUri('/a/b-c_d.e~f')).toBe('/a/b-c_d.e~f');
  });
});

describe('signAwsRequest', () => {
  const baseArgs = {
    method: 'POST',
    path: '/model/test/converse',
    headers: { host: 'bedrock-runtime.us-east-1.amazonaws.com', 'content-type': 'application/json' },
    body: '{"messages":[]}',
    region: 'us-east-1',
    service: 'bedrock',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    now: FIXED_DATE,
  };

  it('hashes an empty body to the well-known SHA-256("") constant', async () => {
    const signed = await signAwsRequest({ ...baseArgs, body: '' });
    expect(signed.headers['x-amz-content-sha256'])
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('stamps x-amz-date from the supplied clock', async () => {
    const signed = await signAwsRequest(baseArgs);
    expect(signed.headers['x-amz-date']).toBe('20150830T123600Z');
  });

  it('builds an Authorization header naming the correct credential scope + signed headers', async () => {
    const signed = await signAwsRequest(baseArgs);
    expect(signed.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('adds x-amz-security-token and includes it in SignedHeaders when a session token is given', async () => {
    const signed = await signAwsRequest({ ...baseArgs, sessionToken: 'session-tok' });
    expect(signed.headers['x-amz-security-token']).toBe('session-tok');
    expect(signed.headers.authorization).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token');
  });

  it('is deterministic — identical inputs produce an identical signature', async () => {
    const a = await signAwsRequest(baseArgs);
    const b = await signAwsRequest(baseArgs);
    expect(a.headers.authorization).toBe(b.headers.authorization);
  });

  it('is sensitive to the body — a changed payload changes the signature', async () => {
    const a = await signAwsRequest(baseArgs);
    const b = await signAwsRequest({ ...baseArgs, body: '{"messages":[{"role":"user"}]}' });
    expect(a.headers.authorization).not.toBe(b.headers.authorization);
    expect(a.headers['x-amz-content-sha256']).not.toBe(b.headers['x-amz-content-sha256']);
  });

  it('is sensitive to the secret key — a different key changes the signature but not the credential scope', async () => {
    const a = await signAwsRequest(baseArgs);
    const b = await signAwsRequest({ ...baseArgs, secretAccessKey: 'a-different-secret-key-entirely' });
    const sigOf = (h: string | undefined) => h?.match(/Signature=([0-9a-f]{64})/)?.[1];
    expect(sigOf(a.headers.authorization)).not.toBe(sigOf(b.headers.authorization));
    expect(a.headers.authorization!.split(', Signature=')[0]).toBe(b.headers.authorization!.split(', Signature=')[0]);
  });

  it('sorts and lower-cases header names in the signed-headers list regardless of input case/order', async () => {
    const signed = await signAwsRequest({
      ...baseArgs,
      headers: { 'Content-Type': 'application/json', Host: 'bedrock-runtime.us-east-1.amazonaws.com' },
    });
    expect(signed.headers.authorization).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date');
  });
});
