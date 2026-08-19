import { describe, expect, it } from 'vitest';
import { SUPPORTED_PROTOCOL, SsoError, ssoChallengeRecordName } from './enterpriseSso';
import { CHALLENGE_PREFIX } from '../shared/dnsVerification';

/**
 * The SAML decision is enforced here or it is not enforced anywhere.
 *
 * These are the properties that survive a refactor: that a SAML connection is
 * refused WITH ITS REASON rather than silently accepted or 404'd, and that the
 * domain proof runs on the platform's one verifier rather than a second token
 * format that would drift out of sight.
 *
 * The validator is exercised through `createConnection`'s own normaliser, which
 * is not exported — so it is reached the way a route reaches it, via a store stub
 * that never gets called because every case here fails validation first.
 */

/** Enough of a `Db` to prove the refusals happen BEFORE anything is written. */
const refuseAllWrites = new Proxy({}, {
  get() { throw new Error('the store was reached — validation did not refuse first'); },
}) as never;

const env = {} as never;

async function create(input: Record<string, unknown>): Promise<SsoError> {
  const { createConnection } = await import('./enterpriseSso');
  try {
    await createConnection(env, refuseAllWrites, 1, input as never, null);
  } catch (error) {
    if (error instanceof SsoError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

const valid = {
  label: 'Example University (Okta)',
  issuer: 'https://login.example.edu',
  discoveryUrl: 'https://login.example.edu/.well-known/openid-configuration',
  clientId: 'client-abc',
  clientSecret: 'shh',
};

describe('the SAML decision', () => {
  it('implements exactly one protocol, and it is OIDC', () => {
    expect(SUPPORTED_PROTOCOL).toBe('oidc');
  });

  it('refuses a SAML connection and says where SAML belongs instead', async () => {
    const error = await create({ ...valid, protocol: 'saml' });
    expect(error.status).toBe(400);
    // The message has to be actionable: an administrator who reads "unsupported"
    // has no next step, and one who reads this does.
    expect(error.message).toMatch(/SAML is terminated at an identity provider/i);
    expect(error.message).toMatch(/OIDC/);
  });
});

describe('what a connection must have before it can start a login', () => {
  it('refuses a connection with neither discovery nor the three endpoints', async () => {
    const error = await create({ ...valid, discoveryUrl: null });
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/nowhere to send a person to sign in/i);
  });

  it('refuses a plaintext endpoint outright', async () => {
    const error = await create({ ...valid, issuer: 'http://login.example.edu' });
    expect(error.message).toMatch(/must be https/i);
  });

  it('refuses scopes without `openid`, because there would be no id_token to verify', async () => {
    const error = await create({ ...valid, scopes: 'email profile' });
    expect(error.message).toMatch(/openid/);
  });

  it('refuses a connection with no client secret', async () => {
    const error = await create({ ...valid, clientSecret: '' });
    expect(error.message).toMatch(/client secret/i);
  });
});

describe('domain proof', () => {
  it('uses the platform’s one challenge-record convention, not a second one', () => {
    expect(ssoChallengeRecordName('physics.edu')).toBe(`${CHALLENGE_PREFIX.sso}.physics.edu`);
  });

  it('keeps its own record name, so one published token cannot satisfy three grants', () => {
    const prefixes = new Set(Object.values(CHALLENGE_PREFIX));
    expect(prefixes.size).toBe(Object.values(CHALLENGE_PREFIX).length);
  });
});
