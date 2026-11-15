/**
 * The full-tier cache keys evidence by `(absPath, sha-256 of the bytes, check)` — the
 * cache-invalidation contract the ship gate relies on (PRD 45 §4.4 cache).
 *
 * `invalidateUnder` is the wedge fix: a package's typecheck record encodes the WHOLE
 * package's bytes, but it is cached against ONE file's hash. When a sibling file in the
 * same package changes (that sibling's own bytes-hash is unchanged for the checked file),
 * the cached record must be evicted or the gate serves a stale package-wide fail forever.
 */
import { describe, expect, it } from 'vitest';
import type { CheckRecord } from './types';
import { createVerifyCache } from './cache';

describe('createVerifyCache — invalidateUnder', () => {
  const makeCache = () => createVerifyCache<readonly CheckRecord[]>();
  const record = (outcome: 'pass' | 'fail') =>
    ({ kind: 'typecheck' as const, name: 'tsc', outcome, exitCode: outcome === 'pass' ? 0 : 1, findings: [], at: 1 }) as const;

  it('drops every entry for paths under the directory', () => {
    const cache = makeCache();
    cache.set('/repo/clients/vscode/src/chat/runStatusOf.test.ts', 'hashA', 'full', [record('fail')]);
    cache.set('/repo/clients/vscode/src/other.ts', 'hashB', 'full', [record('fail')]);
    cache.set('/repo/packages/agent-tools/src/seedCode.ts', 'hashC', 'full', [record('fail')]);

    cache.invalidateUnder('/repo/clients/vscode');

    expect(cache.get('/repo/clients/vscode/src/chat/runStatusOf.test.ts', 'hashA', 'full')).toBeUndefined();
    expect(cache.get('/repo/clients/vscode/src/other.ts', 'hashB', 'full')).toBeUndefined();
    expect(cache.get('/repo/packages/agent-tools/src/seedCode.ts', 'hashC', 'full')).toBeDefined();
  });

  it('normalises Windows separators so a backslash dir matches forward-slash keys', () => {
    const cache = makeCache();
    cache.set('C:/repo/clients/vscode/src/chat/runStatusOf.test.ts', 'hashA', 'full', [record('pass')]);

    cache.invalidateUnder('C:\\repo\\clients\\vscode');

    expect(cache.get('C:/repo/clients/vscode/src/chat/runStatusOf.test.ts', 'hashA', 'full')).toBeUndefined();
  });

  it('does not drop a sibling package that merely shares a path prefix', () => {
    const cache = makeCache();
    cache.set('/repo/clients/vscode-extra/src/x.ts', 'hashA', 'full', [record('pass')]);

    cache.invalidateUnder('/repo/clients/vscode');

    expect(cache.get('/repo/clients/vscode-extra/src/x.ts', 'hashA', 'full')).toBeDefined();
  });
});
