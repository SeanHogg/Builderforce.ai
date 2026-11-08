import { describe, expect, it } from 'vitest';
import {
  buildOsvFindings, cvssToSeverity, OSV_MAX_PACKAGES, osvSeverity, parseCvss3, parseManifests, queryOsv, type OsvPackage,
} from './osvScaScan';

describe('parseManifests', () => {
  it('uses exact npm versions and resolves ^ / ~ ranges from a package-lock in the same read', () => {
    const out = parseManifests([
      { path: 'package.json', content: JSON.stringify({ dependencies: { a: '1.2.3', b: '^2.0.0', c: '~3.1.0', d: 'github:x/y', e: '*' } }) },
      { path: 'package-lock.json', content: JSON.stringify({ packages: { '': {}, 'node_modules/b': { version: '2.4.1' }, 'node_modules/c': { version: '3.1.9' }, 'node_modules/b/node_modules/z': { version: '9.9.9' } } }) },
    ]);
    expect(out.packages.map((p) => `${p.name}@${p.version}`).sort()).toEqual(['a@1.2.3', 'b@2.4.1', 'c@3.1.9']);
    expect(out.unresolved.join('|')).toContain('d@github:x/y');
    expect(out.unresolved.join('|')).toContain('e@*');
  });

  it('lists a range as unresolvable when no lockfile changed with it', () => {
    const out = parseManifests([{ path: 'package.json', content: JSON.stringify({ dependencies: { b: '^2.0.0' } }) }]);
    expect(out.packages).toEqual([]);
    expect(out.unresolved).toEqual(['b@^2.0.0 (package.json)']);
  });

  it('only resolves against the lockfile of the same directory', () => {
    const out = parseManifests([
      { path: 'apps/web/package.json', content: JSON.stringify({ dependencies: { b: '^2.0.0' } }) },
      { path: 'package-lock.json', content: JSON.stringify({ packages: { 'node_modules/b': { version: '2.4.1' } } }) },
    ]);
    expect(out.packages.filter((p) => p.manifest === 'apps/web/package.json')).toEqual([]);
    expect(out.unresolved).toEqual(['b@^2.0.0 (apps/web/package.json)']);
  });

  it('reads pnpm-lock versions', () => {
    const out = parseManifests([
      { path: 'package.json', content: JSON.stringify({ dependencies: { '@s/x': '^1.0.0' } }) },
      { path: 'pnpm-lock.yaml', content: "packages:\n  '@s/x@1.4.0':\n    resolution: {}\n" },
    ]);
    expect(out.packages[0]).toMatchObject({ name: '@s/x', version: '1.4.0', ecosystem: 'npm' });
  });

  it('reads PyPI == pins and reports other specifiers', () => {
    const out = parseManifests([{ path: 'requirements.txt', content: 'Django==3.2.1  # web\nrequests>=2\n-r other.txt\nflask[async]==2.0.0 ; python_version>"3"\n' }]);
    expect(out.packages.map((p) => `${p.ecosystem}:${p.name}@${p.version}`)).toEqual(['PyPI:django@3.2.1', 'PyPI:flask@2.0.0']);
    expect(out.unresolved).toEqual(['requests>=2 (requirements.txt)']);
  });

  it('reads go.mod single and block requires, without the v prefix', () => {
    const out = parseManifests([{ path: 'go.mod', content: 'module x\n\ngo 1.21\n\nrequire github.com/a/b v1.2.3\n\nrequire (\n\tgolang.org/x/net v0.10.0 // indirect\n)\n' }]);
    expect(out.packages.map((p) => `${p.name}@${p.version}`)).toEqual(['github.com/a/b@1.2.3', 'golang.org/x/net@0.10.0']);
  });

  it('dedupes and caps at 500 packages', () => {
    const deps = Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`p${i}`, `1.0.${i}`]));
    const out = parseManifests([{ path: 'package.json', content: JSON.stringify({ dependencies: deps }) }]);
    expect(out.packages).toHaveLength(OSV_MAX_PACKAGES);
    expect(out.capped).toBe(true);
  });
});

describe('severity mapping', () => {
  it('computes CVSS v3 base scores', () => {
    expect(parseCvss3('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(parseCvss3('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(6.1);
    expect(parseCvss3('CVSS:4.0/AV:N')).toBeNull();
    expect(parseCvss3('garbage')).toBeNull();
  });

  it('buckets scores onto the four severities', () => {
    expect([9.8, 7.0, 4.0, 3.9].map(cvssToSeverity)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  });

  it('prefers the database severity word, then CVSS, then MEDIUM', () => {
    expect(osvSeverity({ id: 'X', database_specific: { severity: 'MODERATE' } })).toBe('MEDIUM');
    expect(osvSeverity({ id: 'X', database_specific: { severity: 'CRITICAL' } })).toBe('CRITICAL');
    expect(osvSeverity({ id: 'X', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })).toBe('CRITICAL');
    // unknown severity fails closed
    expect(osvSeverity({ id: 'X' })).toBe('HIGH');
    expect(osvSeverity(undefined)).toBe('HIGH');
  });
});

describe('findings and client', () => {
  const pkg: OsvPackage = { ecosystem: 'npm', name: 'lodash', version: '4.17.0', manifest: 'package.json' };

  it('builds findings fingerprinted osv:<id>:<pkg>@<ver> with fix and CVE', () => {
    const f = buildOsvFindings([pkg], [['GHSA-1']], new Map([['GHSA-1', {
      id: 'GHSA-1', summary: 'Prototype pollution', aliases: ['CVE-2020-1'], database_specific: { severity: 'HIGH' },
      affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }],
    }]]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      ruleId: 'osv:GHSA-1:lodash@4.17.0', severity: 'HIGH', cve: 'CVE-2020-1', fixedVersion: '4.17.21', packageName: 'lodash',
    });
  });

  it('a failed batch query is a failure, never a clean pass', async () => {
    const down = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const r = await queryOsv([pkg], down);
    expect(r.ok).toBe(false);
    const http500 = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect((await queryOsv([pkg], http500)).ok).toBe(false);
  });

  it('keeps a vulnerable package whose detail cannot be read, at HIGH (fails closed)', async () => {
    const fetchFn = (async (url: string) => {
      if (String(url).endsWith('/v1/querybatch')) return new Response(JSON.stringify({ results: [{ vulns: [{ id: 'GHSA-2' }] }] }));
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const r = await queryOsv([pkg], fetchFn);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0]!.severity).toBe('HIGH');
      expect(r.truncated).toBe(false);
    }
  });

  it('marks the scan truncated when more advisories match than detail is read for', async () => {
    const many = Array.from({ length: 160 }, (_, i) => ({ id: `GHSA-${i}` }));
    const fetchFn = (async (url: string) => {
      if (String(url).endsWith('/v1/querybatch')) return new Response(JSON.stringify({ results: [{ vulns: many }] }));
      return new Response(JSON.stringify({ id: 'x', database_specific: { severity: 'LOW' } }));
    }) as unknown as typeof fetch;
    const r = await queryOsv([pkg], fetchFn);
    expect(r.ok && r.truncated).toBe(true);
    // the unread ones stand at HIGH, the read ones at their own severity
    if (r.ok) expect(r.findings.filter((f) => f.severity === 'HIGH')).toHaveLength(10);
  });
});

describe('lockfile-only changes', () => {
  it('scans the lockfile entries that are new or changed against the base, and only those', () => {
    const head = JSON.stringify({ packages: { 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.1.0' }, 'node_modules/c': { version: '3.0.0' } } });
    const base = JSON.stringify({ packages: { 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' } } });
    const out = parseManifests([{ path: 'package-lock.json', content: head }], new Map([['package-lock.json', base]]));
    expect(out.packages.map((p) => `${p.name}@${p.version}`).sort()).toEqual(['b@2.1.0', 'c@3.0.0']);
  });

  it('treats a lockfile with no base as all new', () => {
    const head = JSON.stringify({ packages: { 'node_modules/a': { version: '1.0.0' } } });
    expect(parseManifests([{ path: 'package-lock.json', content: head }]).packages).toHaveLength(1);
  });
});
