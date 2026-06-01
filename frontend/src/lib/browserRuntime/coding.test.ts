import { describe, it, expect, vi } from 'vitest';
import { runCodingDispatch, parseProposedChanges, type CodingDeps, type ProposedChanges } from './coding';
import type { BrowserGitClient } from './gitClient';

describe('parseProposedChanges', () => {
  it('parses plain JSON with files', () => {
    const out = parseProposedChanges(
      JSON.stringify({ branch: 'b', commitMessage: 'm', files: [{ path: 'a.ts', content: 'x' }], summary: 's' }),
      { fallbackBranch: 'fb' },
    );
    expect(out).toEqual({ branch: 'b', commitMessage: 'm', files: [{ path: 'a.ts', content: 'x' }], summary: 's' });
  });

  it('parses fenced ```json blocks', () => {
    const out = parseProposedChanges('```json\n{"files":[{"path":"a","content":"c"}]}\n```', { fallbackBranch: 'fb' });
    expect(out.files).toEqual([{ path: 'a', content: 'c' }]);
    expect(out.branch).toBe('fb');
    expect(out.commitMessage).toBe('chore: agent changes');
  });

  it('drops malformed file entries', () => {
    const out = parseProposedChanges(JSON.stringify({ files: [{ path: 'a', content: 'c' }, { path: 1 }, {}] }), {
      fallbackBranch: 'fb',
    });
    expect(out.files).toEqual([{ path: 'a', content: 'c' }]);
  });

  it('throws on non-JSON so the dispatch fails rather than pushing nothing', () => {
    expect(() => parseProposedChanges('I cannot do that', { fallbackBranch: 'fb' })).toThrow(/valid JSON/);
  });
});

function fakeGit() {
  return {
    clone: vi.fn(async () => {}),
    createBranch: vi.fn(async () => {}),
    writeFiles: vi.fn(async () => {}),
    commitAll: vi.fn(async () => 'sha1'),
    push: vi.fn(async () => ({ ok: true })),
  } as unknown as BrowserGitClient;
}

const changes = (over: Partial<ProposedChanges> = {}): ProposedChanges => ({
  branch: 'claw/task-1',
  commitMessage: 'feat: implement',
  files: [{ path: 'src/x.ts', content: 'export const x = 1;' }],
  summary: 'did the thing',
  ...over,
});

const dispatch = { role: 'implementer', input: 'do it' };
const repo = { repoId: 'r1', defaultBranch: 'main' };

describe('runCodingDispatch', () => {
  it('clones, branches, writes, commits and pushes the agent changes', async () => {
    const git = fakeGit();
    const deps: CodingDeps = { git, propose: vi.fn(async () => changes()) };
    const res = await runCodingDispatch(dispatch, repo, deps);

    expect(git.clone).toHaveBeenCalledWith('main');
    expect(git.createBranch).toHaveBeenCalledWith('claw/task-1');
    expect(git.writeFiles).toHaveBeenCalledWith(changes().files);
    expect(git.commitAll).toHaveBeenCalledWith('feat: implement');
    expect(git.push).toHaveBeenCalledWith('claw/task-1');
    expect(res).toMatchObject({ pushed: true, branch: 'claw/task-1', commitSha: 'sha1' });
  });

  it('does nothing destructive when the model proposes no files', async () => {
    const git = fakeGit();
    const deps: CodingDeps = { git, propose: vi.fn(async () => changes({ files: [] })) };
    const res = await runCodingDispatch(dispatch, repo, deps);
    expect(git.clone).not.toHaveBeenCalled();
    expect(git.push).not.toHaveBeenCalled();
    expect(res.pushed).toBe(false);
  });

  it('runs the build gate and PUSHES when it passes', async () => {
    const git = fakeGit();
    const build = vi.fn(async () => ({ ok: true, output: 'tests pass' }));
    const res = await runCodingDispatch(dispatch, repo, { git, propose: async () => changes(), build });
    expect(build).toHaveBeenCalled();
    expect(git.push).toHaveBeenCalled();
    expect(res).toMatchObject({ pushed: true, buildOk: true });
  });

  it('does NOT push when the build gate fails (no broken branches)', async () => {
    const git = fakeGit();
    const build = vi.fn(async () => ({ ok: false, output: 'tsc error' }));
    const res = await runCodingDispatch(dispatch, repo, { git, propose: async () => changes(), build });
    expect(git.writeFiles).toHaveBeenCalled(); // changes were applied to the tree
    expect(git.commitAll).not.toHaveBeenCalled();
    expect(git.push).not.toHaveBeenCalled();
    expect(res).toMatchObject({ pushed: false, buildOk: false });
    expect(res.summary).toContain('tsc error');
  });

  it('clones the repo HEAD when no default branch is known', async () => {
    const git = fakeGit();
    await runCodingDispatch(dispatch, { repoId: 'r1', defaultBranch: null }, { git, propose: async () => changes() });
    expect(git.clone).toHaveBeenCalledWith(undefined);
  });
});
