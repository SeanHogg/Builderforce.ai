import { afterEach, describe, expect, it, vi } from 'vitest';
import * as repo from './readRepoContents';
import { verifyWrittenFiles } from './verifyWrittenFiles';

const ctx: repo.RepoReadContext = {
  provider: 'github', host: null, owner: 'a', repo: 'b', token: 't', ref: 'builderforce/task-1',
};

afterEach(() => vi.restoreAllMocks());

describe('verifyWrittenFiles', () => {
  it('passes valid JSON/YAML, fails broken ones, skips code + truncated + unreadable', async () => {
    const files: Record<string, repo.ReadFileResult> = {
      'config.json': { ok: true, path: 'config.json', content: '{"x":1}', truncated: false },
      'broken.json': { ok: true, path: 'broken.json', content: '{x:1,}', truncated: false },
      '.github/workflows/ci.yml': { ok: true, path: '.github/workflows/ci.yml', content: 'name: CI\non: push\n', truncated: false },
      'broken.yaml': { ok: true, path: 'broken.yaml', content: 'a: [unterminated', truncated: false },
      'big.json': { ok: true, path: 'big.json', content: '{', truncated: true }, // truncated → not a real failure
      'gone.json': { ok: false, reason: 'file not found' },                       // unreadable → skip, not fail
    };
    vi.spyOn(repo, 'readRepoFile').mockImplementation(async (_c, path) => files[path] ?? { ok: false, reason: 'nope' });

    const v = await verifyWrittenFiles(ctx, [
      'config.json', 'broken.json', '.github/workflows/ci.yml', 'broken.yaml', 'big.json', 'gone.json', 'src/x.ts',
    ]);

    expect(v.ok).toBe(false);
    expect(v.checked.sort()).toEqual(['.github/workflows/ci.yml', 'config.json']);
    expect(v.errors.map((e) => e.path).sort()).toEqual(['broken.json', 'broken.yaml']);
    expect(v.skipped).toEqual(expect.arrayContaining(['src/x.ts', 'big.json', 'gone.json']));
  });

  it('ok=true with no errors when all config parses', async () => {
    vi.spyOn(repo, 'readRepoFile').mockResolvedValue({ ok: true, path: 'a.json', content: '{}', truncated: false });
    const v = await verifyWrittenFiles(ctx, ['a.json']);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.checked).toEqual(['a.json']);
  });

  it('does not read or check non-config files (no false positives on TS/JS)', async () => {
    const spy = vi.spyOn(repo, 'readRepoFile');
    const v = await verifyWrittenFiles(ctx, ['src/a.ts', 'src/b.tsx', 'README.md']);
    expect(spy).not.toHaveBeenCalled();
    expect(v.ok).toBe(true);
    expect(v.skipped.sort()).toEqual(['README.md', 'src/a.ts', 'src/b.tsx']);
  });
});
