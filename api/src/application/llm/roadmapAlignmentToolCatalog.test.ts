import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  resolveDefaultRepoForProject: vi.fn(),
  resolveRepoCredential: vi.fn(),
  readRepoFile: vi.fn(),
  resolveRepoCommitSha: vi.fn(),
  findPage: vi.fn(),
  getOrSetCached: vi.fn(),
}));

vi.mock('../repos/resolveDefaultRepo', () => ({ resolveDefaultRepoForProject: repo.resolveDefaultRepoForProject }));
vi.mock('../repos/resolveRepoCredential', () => ({
  resolveRepoCredential: repo.resolveRepoCredential,
  isResolveError: (v: object) => 'error' in v,
}));
vi.mock('../repos/readRepoContents', () => ({ readRepoFile: repo.readRepoFile, resolveRepoCommitSha: repo.resolveRepoCommitSha }));
vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../../infrastructure/repositories/TaskRepository', () => ({
  TaskRepository: function () { return { findPage: repo.findPage }; },
}));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ getOrSetCached: repo.getOrSetCached }));

import { ROADMAP_ALIGNMENT_TOOLS } from './roadmapAlignmentToolCatalog';
import type { BuiltinCtx } from './builtinToolContext';

const tool = ROADMAP_ALIGNMENT_TOOLS.find((t) => t.tool === 'roadmap.align_tickets')!;

const ROADMAP = [
  '## Consolidated Gap Register',
  '## 🔨 Make — Build',
  '- **[agents] Desktop index search is brute force,** port it. [make.md › Index](./docs/specs/make.md#knowledge-index)',
  '- **[agents] Stale link gap,** body. [make.md › Gone](./docs/specs/make.md#gone)',
].join('\n');

const FILES: Record<string, string> = {
  'docs/ROADMAP.md': ROADMAP,
  'docs/docs/specs/make.md': '## Knowledge index\n',
};

const plainTask = (row: Record<string, unknown>) => ({ toPlain: () => row });

function ctxFor(env: Record<string, unknown> = {}): BuiltinCtx {
  return { tenantId: 7, db: {}, env } as unknown as BuiltinCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.resolveDefaultRepoForProject.mockResolvedValue({ repoId: 'r1', provider: 'github', owner: 'o', repo: 'x', defaultBranch: 'main' });
  repo.resolveRepoCredential.mockResolvedValue({ repo: { provider: 'github', host: null, owner: 'o', repo: 'x', defaultBranch: 'main' }, token: 't' });
  repo.readRepoFile.mockImplementation(async (_ctx: unknown, path: string) =>
    FILES[path] != null ? { ok: true, path, content: FILES[path], truncated: false } : { ok: false, reason: `file not found on main: ${path}` });
  repo.resolveRepoCommitSha.mockResolvedValue({ ok: true, sha: 'a'.repeat(40) });
  repo.getOrSetCached.mockImplementation(async (_env: unknown, _key: string, loader: () => Promise<unknown>) => loader());
  repo.findPage.mockResolvedValue({
    total: 2,
    tasks: [
      plainTask({ id: 1, title: 'Desktop index search is brute force', description: null, status: 'backlog', parentTaskId: null, taskType: 'task' }),
      plainTask({ id: 2, title: 'Polish the footer', description: null, status: 'todo', parentTaskId: null, taskType: 'task' }),
    ],
  });
});

describe('roadmap.align_tickets', () => {
  it('reads the roadmap and its linked specs from the project repo and joins open tickets in one SQL read', async () => {
    const res = await tool.run(ctxFor(), { projectId: 11, roadmapPath: 'docs/ROADMAP.md' }) as Record<string, any>;
    expect(tool.mutates).toBe(false);
    expect(repo.findPage).toHaveBeenCalledTimes(1);
    expect(repo.findPage).toHaveBeenCalledWith(7, { scope: 'open', projectId: 11, isFanoutCopy: false }, { limit: 5000, offset: 0 });
    // Spec links resolve relative to the roadmap's directory.
    expect(repo.readRepoFile.mock.calls.map((c) => c[1]).sort()).toEqual(['docs/ROADMAP.md', 'docs/docs/specs/make.md']);
    expect(res.gaps).toBe(2);
    expect(res.matched.items).toEqual([{ gapId: 'make/desktop-index-search-is-brute-force', taskIds: [1], childTaskIds: [] }]);
    expect(res.ticketsWithoutGap.items).toEqual([{ id: 2, title: 'Polish the footer' }]);
    expect(res.danglingSpecLinks.items).toEqual([{ gapId: 'make/stale-link-gap', file: 'docs/specs/make.md', anchor: 'gone' }]);
    expect(res.cachedBy).toBe('commit-sha');
    expect(repo.getOrSetCached.mock.calls[0]![1]).toBe(`roadmap-align:v2:7:r1:${'a'.repeat(40)}:docs/ROADMAP.md:`);
  });

  it('reads every call without a cache when the provider has no commit sha', async () => {
    repo.resolveRepoCommitSha.mockResolvedValue({ ok: false, reason: 'not github' });
    const res = await tool.run(ctxFor(), { projectId: 11, roadmapPath: 'docs/ROADMAP.md' }) as Record<string, any>;
    expect(repo.getOrSetCached).not.toHaveBeenCalled();
    expect(res.cachedBy).toBeNull();
    expect(res.gaps).toBe(2);
  });

  it('returns an error naming both sources when there is no repo and no attachment', async () => {
    repo.resolveDefaultRepoForProject.mockResolvedValue(null);
    const res = await tool.run(ctxFor(), { projectId: 11 }) as { error: string };
    expect(res.error).toMatch(/no connected repository/);
    expect(res.error).toMatch(/roadmapAttachmentKey/);
  });

  it('reads the roadmap from a tenant-owned attachment and skips the spec check without a repo', async () => {
    repo.resolveDefaultRepoForProject.mockResolvedValue(null);
    const get = vi.fn(async () => ({ text: async () => ROADMAP }));
    const res = await tool.run(ctxFor({ UPLOADS: { get } }), { projectId: 11, roadmapAttachmentKey: '7/u1/roadmap.md' }) as Record<string, any>;
    expect(get).toHaveBeenCalledWith('7/u1/roadmap.md');
    expect(res.gaps).toBe(2);
    expect(res.danglingSpecLinks.total).toBe(0);
    expect(res.specCheck).toMatch(/skipped/);
  });

  it('falls back to the attachment when the repo credential fails', async () => {
    repo.resolveRepoCredential.mockResolvedValue({ error: 'Credential is disabled', status: 400 });
    const get = vi.fn(async () => ({ text: async () => ROADMAP }));
    const res = await tool.run(ctxFor({ UPLOADS: { get } }), { projectId: 11, roadmapAttachmentKey: '7/u1/roadmap.md' }) as Record<string, any>;
    expect(res.error).toBeUndefined();
    expect(res.gaps).toBe(2);
    expect(res.specCheck).toMatch(/Credential is disabled/);
  });

  it('returns the repo error when the credential fails and there is no attachment', async () => {
    repo.resolveRepoCredential.mockResolvedValue({ error: 'Credential is disabled', status: 400 });
    const res = await tool.run(ctxFor(), { projectId: 11 }) as { error: string };
    expect(res.error).toMatch(/Credential is disabled/);
  });

  it('reads the roadmap at 1M chars and specs at 250k, and lists a too-large spec as unreadable, not missing', async () => {
    repo.readRepoFile.mockImplementation(async (_ctx: unknown, path: string) =>
      path === 'docs/ROADMAP.md'
        ? { ok: true, path, content: ROADMAP, truncated: false }
        : { ok: false, reason: 'file too large for the contents API' });
    const res = await tool.run(ctxFor(), { projectId: 11, roadmapPath: 'docs/ROADMAP.md' }) as Record<string, any>;
    const caps = Object.fromEntries(repo.readRepoFile.mock.calls.map((c) => [c[1], (c[0] as { maxFileChars: number }).maxFileChars]));
    expect(caps).toEqual({ 'docs/ROADMAP.md': 1_000_000, 'docs/docs/specs/make.md': 250_000 });
    expect(res.unreadableFiles).toEqual({ 'docs/docs/specs/make.md': 'file too large for the contents API' });
    expect(res.specFilesMissing.total).toBe(0);
    expect(res.danglingSpecLinks.total).toBe(0);
  });

  it('reads at most 6 spec files at once', async () => {
    let inFlight = 0;
    let peak = 0;
    repo.readRepoFile.mockImplementation(async (_ctx: unknown, path: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return path === 'docs/ROADMAP.md' ? { ok: true, path, content: ROADMAP, truncated: false } : { ok: true, path, content: '# x\n', truncated: false };
    });
    const specPaths = Array.from({ length: 15 }, (_, i) => `docs/specs/s${i}.md`);
    await tool.run(ctxFor(), { projectId: 11, roadmapPath: 'docs/ROADMAP.md', specPaths });
    expect(repo.readRepoFile).toHaveBeenCalledTimes(17);
    expect(peak).toBe(6);
  });

  it('refuses another tenant\'s attachment', async () => {
    const get = vi.fn();
    const res = await tool.run(ctxFor({ UPLOADS: { get } }), { projectId: 11, roadmapAttachmentKey: '8/u1/roadmap.md' }) as { error: string };
    expect(res.error).toBe('attachment not found');
    expect(get).not.toHaveBeenCalled();
  });

  it('surfaces an unreadable roadmap as an error', async () => {
    const res = await tool.run(ctxFor(), { projectId: 11, roadmapPath: 'MISSING.md' }) as { error: string };
    expect(res.error).toMatch(/cannot read MISSING\.md/);
  });
});
