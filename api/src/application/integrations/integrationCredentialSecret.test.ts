import { describe, expect, it } from 'vitest';
import { integrationCredentialSecret } from './integrationCredentialSecret';
import { credentialSecret } from './credentialCrypto';
import type { Env } from '../../env';

const env = (o: Record<string, string | undefined>) => o as unknown as Env;

describe('integrationCredentialSecret', () => {
  it('prefers INTEGRATION_ENCRYPTION_SECRET over JWT_SECRET', () => {
    expect(integrationCredentialSecret({ INTEGRATION_ENCRYPTION_SECRET: 'integration', JWT_SECRET: 'jwt' }))
      .toBe('integration');
  });

  it('falls back to JWT_SECRET for deployments predating the split', () => {
    expect(integrationCredentialSecret({ JWT_SECRET: 'jwt' })).toBe('jwt');
  });

  it('reproduces the `?? \'\'` tail the narrowed-env call sites carried', () => {
    // Routes and DOs cast env to `{ INTEGRATION_ENCRYPTION_SECRET?; JWT_SECRET? }`,
    // where JWT_SECRET is optional; those sites all ended in `?? ''`.
    expect(integrationCredentialSecret({})).toBe('');
  });

  it('IGNORES CREDENTIAL_ENCRYPTION_SECRET — that key belongs to the other store', () => {
    // The load-bearing assertion. `integration_credentials` is sealed with the
    // two-level chain; if this ever started preferring CREDENTIAL_ENCRYPTION_SECRET,
    // every existing repo/board/CI credential would derive a different PBKDF2 key and
    // silently stop opening.
    expect(integrationCredentialSecret(
      { CREDENTIAL_ENCRYPTION_SECRET: 'dedicated', INTEGRATION_ENCRYPTION_SECRET: 'integration', JWT_SECRET: 'jwt' } as never,
    )).toBe('integration');
  });
});

describe('the two chains are deliberately different', () => {
  it('diverges exactly when CREDENTIAL_ENCRYPTION_SECRET is set', () => {
    const both = { CREDENTIAL_ENCRYPTION_SECRET: 'dedicated', INTEGRATION_ENCRYPTION_SECRET: 'integration', JWT_SECRET: 'jwt' };
    expect(credentialSecret(env(both))).toBe('dedicated');
    expect(integrationCredentialSecret(both as never)).toBe('integration');
  });

  it('agrees when it is not set, which is why the split went unnoticed', () => {
    const without = { INTEGRATION_ENCRYPTION_SECRET: 'integration', JWT_SECRET: 'jwt' };
    expect(credentialSecret(env(without))).toBe(integrationCredentialSecret(without));
  });
});
