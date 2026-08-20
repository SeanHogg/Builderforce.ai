import { describe, it, expect } from 'vitest';
import {
  fingerprintSoftware,
  compareVersions,
  versionInRange,
  advisoryAffects,
  matchAdvisories,
  worstSeverity,
  normalizeProduct,
  evaluateCveFindings,
  type Advisory,
  type SoftwareFingerprint,
} from './softwareFingerprint';
import type { ScanContext } from './WebSecurityScanner';

const ctx: ScanContext = {
  origin: 'https://example.com',
  finalUrl: 'https://example.com/',
  headers: {},
  cookies: [],
  httpProbe: 'upgraded',
};

describe('fingerprintSoftware', () => {
  it('reads product + version off the Server header, including an embedded module', () => {
    const fps = fingerprintSoftware({ headers: { server: 'Apache/2.4.41 (Ubuntu) PHP/7.4.3' }, body: '' });
    expect(fps).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: 'apache', version: '2.4.41', source: 'server-header' }),
      expect.objectContaining({ product: 'php', version: '7.4.3' }),
    ]));
  });

  it('normalises vendor spellings onto one product key', () => {
    const fps = fingerprintSoftware({ headers: { server: 'Microsoft-IIS/10.0' }, body: '' });
    expect(fps[0]).toMatchObject({ product: 'iis', version: '10.0' });
    expect(normalizeProduct('Microsoft-IIS')).toBe('iis');
  });

  it('reads X-Powered-By and the bare framework version headers', () => {
    const fps = fingerprintSoftware({
      headers: { 'x-powered-by': 'PHP/8.1.2', 'x-aspnet-version': '4.0.30319' },
      body: '',
    });
    expect(fps).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: 'php', version: '8.1.2', source: 'powered-by-header' }),
      expect.objectContaining({ product: 'asp.net', version: '4.0.30319', source: 'framework-header' }),
    ]));
  });

  it('reads a generator meta tag in either attribute order', () => {
    const a = fingerprintSoftware({ headers: {}, body: '<meta name="generator" content="WordPress 5.4.2" />' });
    expect(a[0]).toMatchObject({ product: 'wordpress', version: '5.4.2', source: 'generator-meta' });
    const b = fingerprintSoftware({ headers: {}, body: '<meta content="Drupal 9.3.1 (https://drupal.org)" name="generator">' });
    expect(b[0]).toMatchObject({ product: 'drupal', version: '9.3.1' });
  });

  it('reads a version out of an asset path', () => {
    const fps = fingerprintSoftware({
      headers: {},
      body: '<script src="/assets/js/jquery-3.5.1.min.js"></script>',
    });
    expect(fps).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: 'jquery', version: '3.5.1', source: 'asset-path' }),
    ]));
  });

  it('emits nothing for a version-free header — a guess would become a CVE claim', () => {
    expect(fingerprintSoftware({ headers: { server: 'cloudflare', 'x-powered-by': 'Express' }, body: '' })).toEqual([]);
  });

  it('reports one row per product+version however many times it appears', () => {
    const body = '<script src="/a/jquery-3.5.1.js"></script><script src="/b/jquery-3.5.1.js"></script>';
    const fps = fingerprintSoftware({ headers: {}, body });
    expect(fps.filter((f) => f.product === 'jquery')).toHaveLength(1);
  });
});

describe('compareVersions', () => {
  it('compares segments numerically, not lexicographically', () => {
    // The classic bug: '1.10' < '1.9' as strings, which silently misses every
    // advisory on a double-digit minor.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('orders a pre-release below its release', () => {
    expect(compareVersions('2.0.0-rc.1', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0-rc.1')).toBeGreaterThan(0);
  });

  it('ignores a leading v', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
});

describe('versionInRange (the half-open [introduced, fixed) contract)', () => {
  const range = { introduced: '1.18.0', fixed: '1.20.1' };

  it('includes the first affected version', () => {
    expect(versionInRange('1.18.0', range)).toBe(true);
  });

  it('EXCLUDES the fixed version — treating it as inclusive marks patched sites vulnerable', () => {
    expect(versionInRange('1.20.1', range)).toBe(false);
    expect(versionInRange('1.20.0', range)).toBe(true);
  });

  it('excludes anything below the introduced version', () => {
    expect(versionInRange('1.17.9', range)).toBe(false);
  });

  it('honours an inclusive lastAffected for feeds that publish no fix', () => {
    expect(versionInRange('3.0.0', { lastAffected: '3.0.0' })).toBe(true);
    expect(versionInRange('3.0.1', { lastAffected: '3.0.0' })).toBe(false);
  });

  it('refuses an unbounded range — that is always a feed parse failure', () => {
    expect(versionInRange('1.0.0', {})).toBe(false);
  });
});

const nginxCve: Advisory = {
  id: 'CVE-2021-23017',
  product: 'nginx',
  summary: 'Off-by-one in the resolver.',
  severity: 'high',
  ranges: [{ introduced: '0.6.18', fixed: '1.20.1' }],
};

describe('matchAdvisories', () => {
  const fps: SoftwareFingerprint[] = [
    { product: 'nginx', version: '1.18.0', source: 'server-header', evidence: 'nginx/1.18.0' },
    { product: 'php', version: '8.2.0', source: 'powered-by-header', evidence: 'PHP/8.2.0' },
  ];

  it('pairs only the fingerprint the advisory actually affects', () => {
    const matched = matchAdvisories(fps, [nginxCve]);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.fingerprint.product).toBe('nginx');
  });

  it('does not match an advisory for a different product', () => {
    expect(matchAdvisories(fps, [{ ...nginxCve, product: 'apache' }])).toEqual([]);
  });

  it('does not match a patched version', () => {
    expect(advisoryAffects('1.20.1', nginxCve)).toBe(false);
  });

  it('picks the worst severity in a group, and never sinks an unrated one to info', () => {
    expect(worstSeverity([{ ...nginxCve, severity: 'low' }, { ...nginxCve, severity: 'critical' }])).toBe('critical');
    expect(worstSeverity([])).toBe('medium');
  });
});

describe('evaluateCveFindings', () => {
  const fps: SoftwareFingerprint[] = [
    { product: 'nginx', version: '1.18.0', source: 'server-header', evidence: 'nginx/1.18.0' },
  ];

  it('reports the fingerprints and states the lookup did NOT run when there is no feed', () => {
    const findings = evaluateCveFindings(ctx, fps, {
      performed: false, feedId: 'none', reason: 'no CVE advisory feed is configured', advisories: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.checkId).toBe('cve-lookup-not-performed');
    expect(findings[0]!.detail).toContain('nginx 1.18.0');
    // The whole point: it must not be readable as an all-clear.
    expect(findings[0]!.detail).toContain('No CVE advisory lookup was performed');
  });

  it('says nothing at all when there is nothing to look up', () => {
    expect(evaluateCveFindings(ctx, [], { performed: false, feedId: 'none', reason: 'x', advisories: [] })).toEqual([]);
  });

  it('raises NO finding when the lookup ran and matched nothing — that is a real all-clear', () => {
    expect(evaluateCveFindings(ctx, fps, { performed: true, feedId: 'http', advisories: [] })).toEqual([]);
  });

  it('raises one finding per affected product, carrying the advisory ids', () => {
    const findings = evaluateCveFindings(ctx, fps, { performed: true, feedId: 'http', advisories: [nginxCve] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.checkId).toBe('cve-nginx');
    expect(findings[0]!.severity).toBe('high');
    expect(findings[0]!.detail).toContain('CVE-2021-23017');
    expect(findings[0]!.marker).toBe('[web:cve-nginx:https://example.com]');
  });
});
