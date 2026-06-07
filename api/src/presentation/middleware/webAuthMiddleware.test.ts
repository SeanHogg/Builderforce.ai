import { describe, expect, it } from 'vitest';
import { isTermsExemptPath } from './webAuthMiddleware';

/**
 * The terms-acceptance gate must NOT block the endpoints needed to fetch,
 * display, and accept the current terms — otherwise a terms version bump locks
 * every returning user out of the very screen that lets them re-accept (the
 * "Sign-in failed / Failed to load your account profile" lockout).
 */
describe('isTermsExemptPath', () => {
  it('exempts the read-only identity endpoint required to bootstrap the acceptance UI', () => {
    expect(isTermsExemptPath('/api/auth/me')).toBe(true);
  });

  it('exempts the legal endpoints used to read + accept terms', () => {
    expect(isTermsExemptPath('/api/auth/legal/current')).toBe(true);
    expect(isTermsExemptPath('/api/auth/legal/terms/status')).toBe(true);
    expect(isTermsExemptPath('/api/auth/legal/terms/accept')).toBe(true);
  });

  it('still gates action/tenant endpoints so users cannot use the app before accepting', () => {
    expect(isTermsExemptPath('/api/auth/my-tenants')).toBe(false);
    expect(isTermsExemptPath('/api/auth/tenant-token')).toBe(false);
    expect(isTermsExemptPath('/api/auth/me/onboarding/complete')).toBe(false);
    expect(isTermsExemptPath('/api/projects')).toBe(false);
  });
});
