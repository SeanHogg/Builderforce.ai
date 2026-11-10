import { describe, expect, it } from 'vitest';
import type { LocalFirstAttemptRecord } from '@builderforce/local-inference';
import { BrainRequestError, PROVIDER_AUTH_REQUIRED } from './chatError';
import { providerErrorMapper, refusesCredential, withFailedAccounts } from './localFirstErrors';

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('refusesCredential — a 403 that refused the CREDENTIAL, not a plan / region / quota', () => {
  it('regression: "monthly token limit reached" is a quota refusal, not PROVIDER_AUTH_REQUIRED', async () => {
    expect(refusesCredential({ error: { message: 'monthly token limit reached' } })).toBe(false);
    const err = (await providerErrorMapper('kimi', 'Kimi Code')(response(403, { error: { message: 'monthly token limit reached' } }))) as BrainRequestError;
    expect(err.code).not.toBe(PROVIDER_AUTH_REQUIRED);
  });

  it("regression: \"this key's plan does not allow region X\" is a plan refusal, not PROVIDER_AUTH_REQUIRED", async () => {
    const body = { error: "this key's plan does not allow region X" };
    expect(refusesCredential(body)).toBe(false);
    const err = (await providerErrorMapper('kimi', 'Kimi Code')(response(403, body))) as BrainRequestError;
    expect(err.code).not.toBe(PROVIDER_AUTH_REQUIRED);
  });

  it('reads the machine code first', () => {
    expect(refusesCredential({ error: { code: 'invalid_api_key', message: 'token quota' } })).toBe(true);
    expect(refusesCredential({ code: 'authentication_error' })).toBe(true);
    expect(refusesCredential({ error: { type: 'rate_limit_exceeded', message: 'token budget used' } })).toBe(false);
  });

  it('still recognises the real credential refusals by phrase', () => {
    for (const message of ['bad key', 'Invalid API key provided', 'Unauthorized', 'access token expired', 'Your session has expired', 'invalid credentials']) {
      expect(refusesCredential({ error: { message } }), message).toBe(true);
    }
  });

  it('maps a credential 403 to the provider sign-in', async () => {
    const err = (await providerErrorMapper('kimi', 'Kimi Code')(response(403, { error: 'invalid token' }))) as BrainRequestError;
    expect(err.code).toBe(PROVIDER_AUTH_REQUIRED);
    expect(err.provider).toBe('kimi');
  });
});

describe('withFailedAccounts', () => {
  const failed = [{ attempt: { kind: 'local', ref: 'local/kimi-code/k3' }, outcome: 'failed', detail: 'HTTP 429' }] as unknown as LocalFirstAttemptRecord[];

  it('regression: every own field of the original error survives the re-wrap (an extra field included)', () => {
    const original = new BrainRequestError('no provider is connected', { status: 409, code: 'no_provider', provider: 'kimi' });
    (original as unknown as { retryAfterMs: number }).retryAfterMs = 1234;
    const out = withFailedAccounts(original, failed) as BrainRequestError;
    expect(out).toBeInstanceOf(BrainRequestError);
    expect(out).not.toBe(original);
    expect(out.message).toBe('local/kimi-code/k3 could not take this turn (HTTP 429). no provider is connected');
    expect(out.status).toBe(409);
    expect(out.code).toBe('no_provider');
    expect(out.provider).toBe('kimi');
    expect(out.name).toBe('BrainRequestError');
    expect((out as unknown as { retryAfterMs: number }).retryAfterMs).toBe(1234);
    expect((out as { cause?: unknown }).cause).toBe(original);
    // The original is untouched.
    expect(original.message).toBe('no provider is connected');
  });

  it('returns any other error, or no failed accounts, as it came', () => {
    const plain = new Error('stop');
    expect(withFailedAccounts(plain, failed)).toBe(plain);
    const brain = new BrainRequestError('x', { status: 500 });
    expect(withFailedAccounts(brain, [])).toBe(brain);
  });
});
