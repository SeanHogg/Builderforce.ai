import { describe, expect, it } from 'vitest';
import { extractCodeRefs } from './codeRefs.js';
import { extractFileFacts } from './extract.js';
import { isMapCandidate } from './filePolicy.js';
import { queryTerms, splitIdentifier } from './terms.js';

describe('terms (mirror of bf-index terms.rs)', () => {
  it('splits camel, snake and acronyms', () => {
    expect(splitIdentifier('resolveMembership')).toEqual(['resolve', 'membership']);
    expect(splitIdentifier('resolve_membership')).toEqual(['resolve', 'membership']);
    expect(splitIdentifier('parseHTTPResponse')).toEqual(['parse', 'http', 'response']);
    expect(splitIdentifier('PlanLimits')).toEqual(['plan', 'limits']);
  });

  it('query terms keep parts and whole, drop stopwords', () => {
    const t = queryTerms('where are PlanLimits enforced?');
    expect(t).toEqual(expect.arrayContaining(['plan', 'limits', 'planlimits', 'enforced']));
    expect(t).not.toContain('where');
  });
});

describe('extractCodeRefs (mirror of bf-index refs.rs)', () => {
  it('extracts code and skips prose', () => {
    const t = 'Use `resolveMembership()` from `api/src/auth/membership.ts:42`, not `npm test` or `--force`. '
      + 'Also see frontend/src/lib/planLimits.ts. `TODO` and `the` are prose; `ONE_PORT` is code.';
    const refs = extractCodeRefs(t).map((r) => r.reference);
    expect(refs).toEqual(expect.arrayContaining(['resolveMembership', 'api/src/auth/membership.ts', 'frontend/src/lib/planLimits.ts', 'ONE_PORT']));
    expect(refs.some((x) => x.includes('npm') || x.includes('force') || x === 'TODO' || x === 'the')).toBe(false);
  });

  it('checks the last segment of a qualified name', () => {
    expect(extractCodeRefs('`Store::replaceFile`').map((r) => r.reference)).toEqual(['replaceFile']);
    expect(extractCodeRefs('`adminApi.createReleaseNote`').map((r) => r.reference)).toEqual(['createReleaseNote']);
  });
});

describe('extractFileFacts', () => {
  it('reads definitions, mentions outside comments/strings, and import terms', () => {
    const src = [
      "import { loadConfig } from './lib/config';",
      "const label = 'notAnIdentifierUse';",
      '// commentedOut()',
      'export function boot() { return loadConfig(); }',
    ].join('\n');
    const facts = extractFileFacts('src/boot.ts', src)!;
    expect(facts.symbols.map((s) => [s.name, s.line, s.signature])).toEqual([
      ['label', 2, "const label = 'notAnIdentifierUse';"],
      ['boot', 4, 'export function boot() { return loadConfig(); }'],
    ]);
    expect(facts.identifiers.has('loadConfig')).toBe(true);
    expect(facts.identifiers.has('notAnIdentifierUse')).toBe(false);
    expect(facts.identifiers.has('commentedOut')).toBe(false);
    expect([...facts.imports]).toEqual(expect.arrayContaining(['config', 'lib', 'loadconfig']));
  });

  it('reads Python and Rust imports', () => {
    expect([...extractFileFacts('a.py', 'from pkg.store import Cache\n')!.imports]).toEqual(expect.arrayContaining(['pkg', 'store', 'cache']));
    expect([...extractFileFacts('a.rs', 'use crate::store::Store;\nfn main() {}\n')!.imports]).toEqual(expect.arrayContaining(['crate', 'store']));
  });

  it('skips prose and SQL', () => {
    expect(extractFileFacts('README.md', '# Title')).toBeNull();
    expect(extractFileFacts('db.sql', 'create table t (id int);')).toBeNull();
  });
});

describe('isMapCandidate (mirror of bf-index walk.rs)', () => {
  it('skips generated trees, lockfiles, hidden dirs and oversize files', () => {
    expect(isMapCandidate('src/a.ts', 100)).toBe(true);
    expect(isMapCandidate('.github/scripts/x.js', 100)).toBe(true);
    expect(isMapCandidate('node_modules/x/index.js', 100)).toBe(false);
    expect(isMapCandidate('pkg/dist/index.js', 100)).toBe(false);
    expect(isMapCandidate('.hidden/a.ts', 100)).toBe(false);
    expect(isMapCandidate('web/app.min.js', 100)).toBe(false);
    expect(isMapCandidate('src/a.ts', 10_000_000)).toBe(false);
    expect(isMapCandidate('docs/a.md', 100)).toBe(false);
  });
});
