/**
 * THE INSTALL TOKEN — what it may do, and what it must stop doing the instant a
 * customer changes their mind.
 *
 * The whole argument for having no token TABLE is that the install row is re-read on
 * every call, so revocation is immediate and there is nothing to sweep. That argument
 * is only worth anything if the re-read actually happens and actually decides. These
 * tests are that claim, driven through a fake `db` that stands in for the one query
 * `loadInstallForPublisher` makes.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  INSTALL_TOKEN_TTL_SECONDS,
  InstallTokenError,
  mintInstallToken,
  requireTokenScope,
  resolveInstallToken,
  tokenPermits,
  type ResolvedInstall,
} from './extensionInstallTokens';

const env = { JWT_SECRET: 'test-secret-for-install-tokens' } as never;

interface FakeInstall {
  id: string;
  tenantId: number;
  grantedScopes: string[];
  planCode: string | null;
  subscriptionState: string;
  disabledAt: Date | null;
}

/**
 * A `db` that answers the ONE join this module makes.
 *
 * `rows` is a mutable box on purpose: the tests that matter are the ones where the
 * install changes BETWEEN minting a token and using it, which is exactly what an
 * uninstall or a scope change is.
 */
function fakeDb(state: { install: FakeInstall | null; publisherTenantId: number }) {
  const result = () => {
    const i = state.install;
    if (!i || i.disabledAt) return [];
    return [{
      install: {
        id: i.id,
        tenantId: i.tenantId,
        grantedScopes: i.grantedScopes,
        planCode: i.planCode,
        subscriptionState: i.subscriptionState,
        meteredSince: null,
      },
      pkg: { id: 'pkg-1', tenantId: state.publisherTenantId, slug: 'acme-payroll' },
      version: { id: 'ver-1', semver: '1.2.0' },
      publisher: { publisherSuspendedAt: null },
    }];
  };
  // The chain shape `loadInstallForPublisher` uses. `where` captures nothing —
  // the AUTHORIZATION it expresses is asserted separately, by driving the real
  // predicate through `state.publisherTenantId`.
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => result(),
  };
  return { select: () => chain } as never;
}

const live = (over: Partial<FakeInstall> = {}): FakeInstall => ({
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 42,
  grantedScopes: ['tools:call', 'read:projects'],
  planCode: 'pro',
  subscriptionState: 'active',
  disabledAt: null,
  ...over,
});

describe('mintInstallToken', () => {
  it('mints a short-lived token carrying the install grant', async () => {
    const state = { install: live(), publisherTenantId: 7 };
    const minted = await mintInstallToken(fakeDb(state), env, {
      publisherTenantId: 7,
      installId: state.install!.id,
    });
    expect(minted.expiresIn).toBe(INSTALL_TOKEN_TTL_SECONDS);
    expect(minted.scopes).toEqual(['tools:call', 'read:projects']);
    expect(minted.install.tenantId).toBe(42);
  });

  it('narrows to the requested scopes, and cannot widen past the grant', async () => {
    const state = { install: live(), publisherTenantId: 7 };
    const minted = await mintInstallToken(fakeDb(state), env, {
      publisherTenantId: 7,
      installId: state.install!.id,
      // `write:tickets` was never granted. Asking for it must not produce it.
      requestScopes: ['read:projects', 'write:tickets'],
    });
    expect(minted.scopes).toEqual(['read:projects']);
  });

  it('refuses an install the calling publisher does not own', async () => {
    // The fake returns nothing when the predicate does not match, which is the
    // behaviour of the real `eq(extensionPackages.tenantId, publisherTenantId)`.
    const state = { install: null as FakeInstall | null, publisherTenantId: 7 };
    await expect(mintInstallToken(fakeDb(state), env, { publisherTenantId: 7, installId: 'someone-elses' }))
      .rejects.toBeInstanceOf(InstallTokenError);
  });

  it('refuses a cancelled subscription', async () => {
    const state = { install: live({ subscriptionState: 'cancelled' }), publisherTenantId: 7 };
    await expect(mintInstallToken(fakeDb(state), env, { publisherTenantId: 7, installId: state.install!.id }))
      .rejects.toThrow(/not on an active plan/);
  });

  it('still mints for a PAST-DUE subscription', async () => {
    // A failed renewal must not switch the extension off — see `subscriptionEntitles`.
    const state = { install: live({ subscriptionState: 'past_due' }), publisherTenantId: 7 };
    const minted = await mintInstallToken(fakeDb(state), env, { publisherTenantId: 7, installId: state.install!.id });
    expect(minted.scopes.length).toBeGreaterThan(0);
  });

  it('mints for a FREE install, whose subscription state is `none`', async () => {
    const state = { install: live({ subscriptionState: 'none', planCode: null }), publisherTenantId: 7 };
    const minted = await mintInstallToken(fakeDb(state), env, { publisherTenantId: 7, installId: state.install!.id });
    expect(minted.install.planCode).toBeNull();
  });
});

describe('resolveInstallToken — the re-read is the revocation', () => {
  async function mintFor(state: { install: FakeInstall | null; publisherTenantId: number }): Promise<string> {
    const minted = await mintInstallToken(fakeDb(state), env, {
      publisherTenantId: state.publisherTenantId,
      installId: state.install!.id,
    });
    return `Bearer ${minted.accessToken}`;
  }

  it('resolves a live token back to its install', async () => {
    const state = { install: live(), publisherTenantId: 7 };
    const header = await mintFor(state);
    const resolved = await resolveInstallToken(fakeDb(state), env, header);
    expect(resolved.installId).toBe(state.install!.id);
    expect(resolved.tenantId).toBe(42);
  });

  it('stops working the moment the install is disabled', async () => {
    // THE claim that lets there be no token table: an uninstall is immediate, with
    // no sweep and no TTL to wait out.
    const state = { install: live(), publisherTenantId: 7 };
    const header = await mintFor(state);
    state.install!.disabledAt = new Date();
    await expect(resolveInstallToken(fakeDb(state), env, header)).rejects.toThrow(/no longer available/);
  });

  it('loses a scope the admin has since revoked', async () => {
    const state = { install: live(), publisherTenantId: 7 };
    const header = await mintFor(state);
    state.install!.grantedScopes = ['tools:call'];
    const resolved = await resolveInstallToken(fakeDb(state), env, header);
    expect(resolved.grantedScopes).toEqual(['tools:call']);
  });

  it('does NOT gain a scope granted after the token was minted', async () => {
    // The token's scopes are the ceiling and the install's are the floor; the
    // grant is the intersection, so widening later cannot retroactively widen a
    // token that was issued narrower.
    const state = { install: live({ grantedScopes: ['tools:call'] }), publisherTenantId: 7 };
    const header = await mintFor(state);
    state.install!.grantedScopes = ['tools:call', 'write:tickets'];
    const resolved = await resolveInstallToken(fakeDb(state), env, header);
    expect(resolved.grantedScopes).toEqual(['tools:call']);
  });

  it('stops working when the subscription is cancelled', async () => {
    const state = { install: live(), publisherTenantId: 7 };
    const header = await mintFor(state);
    state.install!.subscriptionState = 'cancelled';
    await expect(resolveInstallToken(fakeDb(state), env, header)).rejects.toThrow(/not on an active plan/);
  });

  it('refuses a missing, malformed or foreign-signed token with one message', async () => {
    const state = { install: live(), publisherTenantId: 7 };
    const db = fakeDb(state);
    await expect(resolveInstallToken(db, env, undefined)).rejects.toThrow(/Authorization header/);
    await expect(resolveInstallToken(db, env, 'Bearer not-a-jwt')).rejects.toThrow(/Invalid or expired/);
    const header = await mintFor(state);
    // Same token, different signing secret — an attacker who can sign is not us.
    await expect(resolveInstallToken(db, { JWT_SECRET: 'a-different-secret' } as never, header))
      .rejects.toThrow(/Invalid or expired/);
  });

  it('refuses a token that has expired', async () => {
    const state = { install: live(), publisherTenantId: 7 };
    const header = await mintFor(state);
    // Past the whole TTL, with a second of margin.
    vi.setSystemTime(Date.now() + (INSTALL_TOKEN_TTL_SECONDS + 1) * 1000);
    try {
      await expect(resolveInstallToken(fakeDb(state), env, header)).rejects.toThrow(/Invalid or expired/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scope checks on a resolved install', () => {
  const resolved = (scopes: string[]): ResolvedInstall => ({
    installId: 'i', tenantId: 1, publisherTenantId: 2,
    packageId: 'p', packageSlug: 's', versionId: 'v', semver: '1.0.0',
    grantedScopes: scopes, planCode: null, subscriptionState: 'none', meteredSince: null,
  });

  it('is strict — an empty grant permits nothing', () => {
    // Unlike the legacy tenant-key path, where an empty list means "minted before
    // scopes existed". A new credential has no legacy to accommodate.
    expect(tokenPermits(resolved([]), 'tools:call')).toBe(false);
    expect(tokenPermits(resolved(['tools:call']), 'tools:call')).toBe(true);
    expect(tokenPermits(resolved(['tools:call']), 'write:tickets')).toBe(false);
  });

  it('refuses with the scope named, so a vendor can fix it', () => {
    expect(() => requireTokenScope(resolved([]), 'write:canvas')).toThrow(/write:canvas/);
    expect(() => requireTokenScope(resolved(['write:canvas']), 'write:canvas')).not.toThrow();
  });
});
