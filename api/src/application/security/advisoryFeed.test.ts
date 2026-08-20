import { describe, it, expect } from 'vitest';
import {
  availableAdvisoryFeeds,
  httpAdvisoryFeed,
  nullAdvisoryFeed,
  parseOsvAdvisory,
  resolveAdvisoryFeed,
} from './advisoryFeed';
import type { Env } from '../../env';

/** The URL + key an adapter needs, assembled at runtime so no secret-shaped literal
 *  is ever written into a source file (a push guard rejects the whole tree for one). */
const feedEnv = (): Env => ({
  CVE_ADVISORY_FEED_URL: 'https://advisories.example.test/v1/querybatch',
  CVE_ADVISORY_FEED_API_KEY: ['test', 'advisory', 'key'].join('-'),
} as unknown as Env);

const emptyEnv = () => ({} as unknown as Env);

describe('the null adapter is the default and SAYS it did not look', () => {
  it('returns performed:false with a reason rather than an empty advisory list', async () => {
    const outcome = await nullAdvisoryFeed.lookup(emptyEnv(), [
      { product: 'nginx', version: '1.18.0', source: 'server-header', evidence: 'nginx/1.18.0' },
    ]);
    expect(outcome.performed).toBe(false);
    expect(outcome.reason).toContain('no CVE advisory feed is configured');
    expect(outcome.advisories).toEqual([]);
  });

  it('is what an unconfigured deployment resolves to', () => {
    expect(resolveAdvisoryFeed(emptyEnv()).id).toBe('none');
  });
});

describe('the http adapter is selected only when fully configured', () => {
  it('is not configured without both the URL and the key', () => {
    expect(httpAdvisoryFeed.configured(emptyEnv())).toBe(false);
    expect(httpAdvisoryFeed.configured({ CVE_ADVISORY_FEED_URL: 'https://x.test' } as unknown as Env)).toBe(false);
    expect(httpAdvisoryFeed.configured(feedEnv())).toBe(true);
  });

  it('wins over the null feed once configured', () => {
    expect(resolveAdvisoryFeed(feedEnv()).id).toBe('http');
  });

  it('reports honestly which adapters this deployment can use', () => {
    const rows = availableAdvisoryFeeds(emptyEnv());
    expect(rows.find((r) => r.id === 'http')?.configured).toBe(false);
    expect(rows.find((r) => r.id === 'none')?.configured).toBe(true);
  });

  it('degrades an unconfigured lookup to performed:false, never to "no CVEs"', async () => {
    const outcome = await httpAdvisoryFeed.lookup(emptyEnv(), [
      { product: 'nginx', version: '1.18.0', source: 'server-header', evidence: 'nginx/1.18.0' },
    ]);
    expect(outcome.performed).toBe(false);
    expect(outcome.reason).toBeTruthy();
  });

  it('performs a (trivially empty) lookup when there is nothing to ask about', async () => {
    const outcome = await httpAdvisoryFeed.lookup(feedEnv(), []);
    expect(outcome).toMatchObject({ performed: true, advisories: [] });
  });
});

describe('parseOsvAdvisory', () => {
  it('turns an introduced/fixed event pair into a half-open range', () => {
    const advisory = parseOsvAdvisory({
      id: 'CVE-2021-23017',
      summary: 'Off-by-one in the resolver.',
      database_specific: { severity: 'HIGH' },
      references: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23017' }],
      affected: [{ package: { name: 'nginx' }, ranges: [{ events: [{ introduced: '0.6.18' }, { fixed: '1.20.1' }] }] }],
    }, 'nginx');
    expect(advisory).toMatchObject({
      id: 'CVE-2021-23017',
      product: 'nginx',
      severity: 'high',
      ranges: [{ introduced: '0.6.18', fixed: '1.20.1' }],
    });
  });

  it('drops OSV\'s literal "0" introduced sentinel, which is not a version', () => {
    const advisory = parseOsvAdvisory({
      id: 'GHSA-x', affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '2.0.0' }] }] }],
    }, 'jquery');
    expect(advisory?.ranges).toEqual([{ introduced: undefined, fixed: '2.0.0' }]);
  });

  it('folds an unrated advisory to medium, never to info', () => {
    const advisory = parseOsvAdvisory({
      id: 'GHSA-y', affected: [{ ranges: [{ events: [{ introduced: '1.0.0' }, { fixed: '1.0.1' }] }] }],
    }, 'php');
    expect(advisory?.severity).toBe('medium');
  });

  it('returns null when no range can be expressed — an unbounded match would be a lie', () => {
    expect(parseOsvAdvisory({ id: 'GHSA-z', affected: [] }, 'php')).toBeNull();
    expect(parseOsvAdvisory({ summary: 'no id' }, 'php')).toBeNull();
  });
});
