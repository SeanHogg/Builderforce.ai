import { afterEach, describe, expect, it, vi } from 'vitest';
import * as repo from './readRepoContents';
import { verifyWrittenFiles } from './verifyWrittenFiles';

const ctx: repo.RepoReadContext = {
  provider: 'github', host: null, owner: 'a', repo: 'b', token: 't', ref: 'builderforce/task-1',
};

afterEach(() => vi.restoreAllMocks());

describe('verifyWrittenFiles', () => {
  it('passes valid config/source, fails broken config, skips truncated + unreadable', async () => {
    const files: Record<string, repo.ReadFileResult> = {
      'config.json': { ok: true, path: 'config.json', content: '{"x":1}', truncated: false },
      'broken.json': { ok: true, path: 'broken.json', content: '{x:1,}', truncated: false },
      '.github/workflows/ci.yml': { ok: true, path: '.github/workflows/ci.yml', content: 'name: CI\non: push\n', truncated: false },
      'broken.yaml': { ok: true, path: 'broken.yaml', content: 'a: [unterminated', truncated: false },
      'big.json': { ok: true, path: 'big.json', content: '{', truncated: true }, // truncated → not a real failure
      'gone.json': { ok: false, reason: 'file not found' },                       // unreadable → skip, not fail
      'src/x.ts': { ok: true, path: 'src/x.ts', content: 'export const x = 1;', truncated: false },
    };
    vi.spyOn(repo, 'readRepoFile').mockImplementation(async (_c, path) => files[path] ?? { ok: false, reason: 'nope' });

    const v = await verifyWrittenFiles(ctx, [
      'config.json', 'broken.json', '.github/workflows/ci.yml', 'broken.yaml', 'big.json', 'gone.json', 'src/x.ts',
    ]);

    expect(v.ok).toBe(false);
    expect(v.checked.sort()).toEqual(['.github/workflows/ci.yml', 'config.json', 'src/x.ts']);
    expect(v.errors.map((e) => e.path).sort()).toEqual(['broken.json', 'broken.yaml']);
    expect(v.skipped).toEqual(expect.arrayContaining(['big.json', 'gone.json']));
  });

  it('ok=true with no errors when all config parses', async () => {
    vi.spyOn(repo, 'readRepoFile').mockResolvedValue({ ok: true, path: 'a.json', content: '{}', truncated: false });
    const v = await verifyWrittenFiles(ctx, ['a.json']);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.checked).toEqual(['a.json']);
  });

  it('checks source files and skips prose', async () => {
    const spy = vi.spyOn(repo, 'readRepoFile').mockResolvedValue({ ok: true, path: 'source', content: 'export const ok = true;', truncated: false });
    const v = await verifyWrittenFiles(ctx, ['src/a.ts', 'src/b.tsx', 'README.md']);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(v.ok).toBe(true);
    expect(v.checked.sort()).toEqual(['src/a.ts', 'src/b.tsx']);
    expect(v.skipped).toEqual(['README.md']);
  });

  it('returns structured source-policy diagnostics the agent can repair', async () => {
    vi.spyOn(repo, 'readRepoFile').mockResolvedValue({
      ok: true, path: 'src/a.tsx',
      content: 'return <Panel onChange={enabled ? (v) => save(v) : undefined} />;',
      truncated: false,
    });
    const v = await verifyWrittenFiles(ctx, ['src/a.tsx']);
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual([expect.objectContaining({
      path: 'src/a.tsx', line: 1,
      ruleId: 'typescript/explicit-conditional-jsx-callback',
    })]);
  });
});
