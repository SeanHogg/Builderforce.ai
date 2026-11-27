import { describe, expect, it } from 'vitest';
import { audienceAllowsPath, isScopedTokenAudience } from './scopedTokenAudiences';

describe('scoped token audiences', () => {
  it('allows spawn on exactly its two (method, path) pairs', () => {
    expect(audienceAllowsPath('spawn', 'GET', '/api/spawn/account')).toBe(true);
    expect(audienceAllowsPath('spawn', 'POST', '/api/spawn/build')).toBe(true);
    expect(audienceAllowsPath('spawn', 'get', '/api/spawn/account/')).toBe(true);
    expect(audienceAllowsPath('spawn', 'GET', '/api/spawn/membership')).toBe(false);
    expect(audienceAllowsPath('spawn', 'GET', '/api/spawn/tokens')).toBe(false);
    expect(audienceAllowsPath('spawn', 'GET', '/api/spawn/account/extra')).toBe(false);
    expect(audienceAllowsPath('spawn', 'GET', '/api/projects')).toBe(false);
  });

  it('refuses the wrong method on an allowed path', () => {
    expect(audienceAllowsPath('spawn', 'POST', '/api/spawn/account')).toBe(false);
    expect(audienceAllowsPath('spawn', 'DELETE', '/api/spawn/account')).toBe(false);
    expect(audienceAllowsPath('spawn', 'GET', '/api/spawn/build')).toBe(false);
    expect(audienceAllowsPath('spawn', 'PUT', '/api/spawn/build')).toBe(false);
  });

  it('refuses an unknown audience, including prototype keys', () => {
    expect(audienceAllowsPath('other', 'GET', '/api/spawn/account')).toBe(false);
    expect(isScopedTokenAudience('toString')).toBe(false);
    expect(isScopedTokenAudience('spawn')).toBe(true);
  });
});
