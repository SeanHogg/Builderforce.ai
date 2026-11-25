import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installedRangeMismatches, satisfiesRange } from '../../../../scripts/check-installed-ranges.mjs';

/**
 * `vscode:prepublish` refuses to package when `node_modules` holds a pinned dependency outside the
 * range `package.json` declares — VSIX builds shipped memory 2026.10.35 under `^2026.10.37`, and the
 * old `.gitignore` matcher after the range had moved past it.
 */
describe('satisfiesRange', () => {
  it('holds caret ranges to the left-most non-zero component', () => {
    expect(satisfiesRange('2026.10.82', '^2026.10.82')).toBe(true);
    expect(satisfiesRange('2026.11.0', '^2026.10.82')).toBe(true);
    expect(satisfiesRange('2026.10.81', '^2026.10.82')).toBe(false);
    expect(satisfiesRange('2027.0.0', '^2026.10.82')).toBe(false);
    expect(satisfiesRange('0.3.9', '^0.3.1')).toBe(true);
    expect(satisfiesRange('0.4.0', '^0.3.1')).toBe(false);
  });

  it('handles tilde, exact and >= ranges, and refuses forms it does not know', () => {
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
    expect(satisfiesRange('9.0.0', '>=1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.3', 'link:../x')).toBeNull();
  });

  it('refuses a prerelease install against a range with no prerelease on that version', () => {
    // The regression: the prerelease tag was stripped, so a beta passed as the release.
    expect(satisfiesRange('2026.10.82-beta.1', '^2026.10.82')).toBe(false);
    expect(satisfiesRange('2026.10.83-beta.1', '^2026.10.82')).toBe(false);
    expect(satisfiesRange('2026.10.82-beta.1', '>=2026.10.81')).toBe(false);
    expect(satisfiesRange('1.2.4-rc.1', '~1.2.3')).toBe(false);
    // Build metadata carries no precedence and is still accepted.
    expect(satisfiesRange('2026.10.82+build.7', '^2026.10.82')).toBe(true);
  });

  it('accepts a prerelease install only on the major.minor.patch the range names a prerelease for', () => {
    expect(satisfiesRange('2026.10.82-beta.1', '^2026.10.82-beta.1')).toBe(true);
    expect(satisfiesRange('2026.10.82-beta.2', '^2026.10.82-beta.1')).toBe(true);
    expect(satisfiesRange('2026.10.82-beta.10', '^2026.10.82-beta.2')).toBe(true);
    expect(satisfiesRange('2026.10.82-beta.0', '^2026.10.82-beta.1')).toBe(false);
    expect(satisfiesRange('2026.10.82-alpha.9', '^2026.10.82-beta.1')).toBe(false);
    // A beta on a LATER version is not opted into by a beta on this one.
    expect(satisfiesRange('2026.10.83-beta.1', '^2026.10.82-beta.1')).toBe(false);
    // The release itself (and later releases) satisfy a prerelease floor.
    expect(satisfiesRange('2026.10.82', '^2026.10.82-beta.1')).toBe(true);
    expect(satisfiesRange('2026.11.0', '^2026.10.82-beta.1')).toBe(true);
    expect(satisfiesRange('2026.10.82-beta.1', '2026.10.82-beta.1')).toBe(true);
    expect(satisfiesRange('2026.10.82', '2026.10.82-beta.1')).toBe(false);
  });
});

describe('installedRangeMismatches', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function consumer(declared: Record<string, string>, installed: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), 'installed-ranges-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', dependencies: declared }));
    for (const [name, version] of Object.entries(installed)) {
      const pkg = join(dir, 'node_modules', ...name.split('/'));
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version }));
    }
    return dir;
  }

  it('reports a stale install, a missing install, and skips undeclared names', () => {
    const root = consumer(
      { '@seanhogg/builderforce-memory': '^2026.10.82', '@seanhogg/builderforce-memory-engine': '^2026.10.65' },
      { '@seanhogg/builderforce-memory': '2026.10.80' },
    );
    expect(installedRangeMismatches(root, ['@seanhogg/builderforce-memory', '@seanhogg/builderforce-memory-engine', 'not-declared'])).toEqual([
      { name: '@seanhogg/builderforce-memory', declared: '^2026.10.82', installed: '2026.10.80', reason: 'outside the declared range' },
      { name: '@seanhogg/builderforce-memory-engine', declared: '^2026.10.65', installed: null, reason: 'not installed' },
    ]);
  });

  it('reports a prerelease install under a release range', () => {
    const root = consumer({ '@seanhogg/builderforce-memory': '^2026.10.82' }, { '@seanhogg/builderforce-memory': '2026.10.82-beta.1' });
    expect(installedRangeMismatches(root)).toEqual([
      { name: '@seanhogg/builderforce-memory', declared: '^2026.10.82', installed: '2026.10.82-beta.1', reason: 'outside the declared range' },
    ]);
  });

  it('passes when every pinned install satisfies its range', () => {
    const root = consumer({ '@seanhogg/builderforce-memory': '^2026.10.82' }, { '@seanhogg/builderforce-memory': '2026.10.82' });
    expect(installedRangeMismatches(root)).toEqual([]);
  });
});
