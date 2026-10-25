import { describe, expect, it } from 'vitest';
import { isRevokedRefresh } from './subscriptionOAuthCode';

const failed = (status?: number) => Object.assign(new Error('refresh failed'), status != null ? { status } : {});

describe('isRevokedRefresh — one verdict for every subscription resolver', () => {
  it('a dead grant means reconnect: 400 invalid_grant, 401, 403', () => {
    expect(isRevokedRefresh(failed(400))).toBe(true);
    expect(isRevokedRefresh(failed(401))).toBe(true);
    expect(isRevokedRefresh(failed(403))).toBe(true);
  });

  it('an outage, a throttle or a network failure is worth retrying', () => {
    expect(isRevokedRefresh(failed(500))).toBe(false);
    expect(isRevokedRefresh(failed(503))).toBe(false);
    expect(isRevokedRefresh(failed(429))).toBe(false);
    expect(isRevokedRefresh(failed())).toBe(false);
    expect(isRevokedRefresh(null)).toBe(false);
  });
});
