import { describe, it, expect, vi } from 'vitest';
import { BrowserGitClient, type GitOps, type FsLike } from './gitClient';

function fakeOps(): GitOps {
  return {
    clone: vi.fn(async () => {}),
    branch: vi.fn(async () => {}),
    add: vi.fn(async () => {}),
    commit: vi.fn(async () => 'sha123'),
    push: vi.fn(async () => ({ ok: true })),
  };
}
function fakeFs(): FsLike & { writes: Record<string, string>; dirs: string[] } {
  const writes: Record<string, string> = {};
  const dirs: string[] = [];
  return {
    writes,
    dirs,
    promises: {
      writeFile: vi.fn(async (path: string, data: string) => {
        writes[path] = data;
      }),
      mkdir: vi.fn(async (path: string) => {
        dirs.push(path);
      }),
    },
  };
}

const base = (ops: GitOps, fs: FsLike) =>
  new BrowserGitClient({ ops, fs, url: 'https://api/api/git-proxy/r1', dir: '/repo', headers: { Authorization: 'Bearer t' } });

describe('BrowserGitClient', () => {
  it('clones the base branch shallow/single-branch through the proxy with auth headers', async () => {
    const ops = fakeOps();
    await base(ops, fakeFs()).clone('main');
    expect(ops.clone).toHaveBeenCalledWith({
      dir: '/repo',
      url: 'https://api/api/git-proxy/r1',
      ref: 'main',
      singleBranch: true,
      depth: 1,
      headers: { Authorization: 'Bearer t' },
    });
  });

  it('creates and checks out a working branch', async () => {
    const ops = fakeOps();
    await base(ops, fakeFs()).createBranch('agentHost/task-1');
    expect(ops.branch).toHaveBeenCalledWith({ dir: '/repo', ref: 'agentHost/task-1', checkout: true });
  });

  it('writes files (creating parent dirs) into the working tree', async () => {
    const fs = fakeFs();
    await base(fakeOps(), fs).writeFiles([
      { path: 'src/index.ts', content: 'export const x = 1;' },
      { path: 'README.md', content: '# hi' },
    ]);
    expect(fs.dirs).toContain('/repo/src');
    expect(fs.writes['/repo/src/index.ts']).toBe('export const x = 1;');
    expect(fs.writes['/repo/README.md']).toBe('# hi');
  });

  it('commits all changes and returns the sha', async () => {
    const ops = fakeOps();
    const sha = await base(ops, fakeFs()).commitAll('feat: thing');
    expect(ops.add).toHaveBeenCalledWith({ dir: '/repo', filepath: '.' });
    expect(ops.commit).toHaveBeenCalledWith(
      expect.objectContaining({ dir: '/repo', message: 'feat: thing' }),
    );
    expect(sha).toBe('sha123');
  });

  it('pushes the branch through the proxy', async () => {
    const ops = fakeOps();
    const res = await base(ops, fakeFs()).push('agentHost/task-1');
    expect(ops.push).toHaveBeenCalledWith({
      dir: '/repo',
      url: 'https://api/api/git-proxy/r1',
      ref: 'agentHost/task-1',
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.ok).toBe(true);
  });
});
