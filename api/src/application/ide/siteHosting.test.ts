import { describe, expect, it } from 'vitest';
import { subdomainFromHost, normalizeSubdomain, HOSTING_APEX } from './siteHosting';

describe('siteHosting apex', () => {
  it('hosts on the single-label apex (free Universal SSL wildcard)', () => {
    expect(HOSTING_APEX).toBe('builderforce.ai');
  });
});

describe('subdomainFromHost', () => {
  it('extracts a single-label site subdomain', () => {
    expect(subdomainFromHost('rumbledating.builderforce.ai')).toBe('rumbledating');
    expect(subdomainFromHost('rumbledating.builderforce.ai:443')).toBe('rumbledating');
    expect(subdomainFromHost('My-App.BuilderForce.ai')).toBe('my-app');
  });

  it('returns null for the apex itself and foreign hosts', () => {
    expect(subdomainFromHost('builderforce.ai')).toBeNull();
    expect(subdomainFromHost('example.com')).toBeNull();
    expect(subdomainFromHost(undefined)).toBeNull();
  });

  it('returns null for multi-label hosts (Universal SSL covers one level only)', () => {
    expect(subdomainFromHost('a.b.builderforce.ai')).toBeNull();
  });

  it('NEVER treats a reserved/platform label as a site (so api/www/etc. route normally)', () => {
    // This is the safety property: the apex is shared, so reserved labels must
    // fall through to normal routing rather than be looked up + 404'd as a site.
    for (const reserved of ['api', 'app', 'www', 'admin', 'gateway', 'ide', 'apps']) {
      expect(subdomainFromHost(`${reserved}.builderforce.ai`)).toBeNull();
    }
  });
});

describe('normalizeSubdomain', () => {
  it('slugifies valid candidates', () => {
    expect(normalizeSubdomain('Rumble Dating')).toBe('rumble-dating');
    expect(normalizeSubdomain('my_app')).toBe('my-app');
  });

  it('rejects reserved labels at claim time (symmetric with the serve side)', () => {
    expect(normalizeSubdomain('api')).toBeNull();
    expect(normalizeSubdomain('www')).toBeNull();
    expect(normalizeSubdomain('apps')).toBeNull();
  });

  it('rejects empty / unusable candidates', () => {
    expect(normalizeSubdomain('   ')).toBeNull();
    expect(normalizeSubdomain('!!!')).toBeNull();
  });
});
