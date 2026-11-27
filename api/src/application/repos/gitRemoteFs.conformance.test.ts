/**
 * The git-remote workspace against the shared WorkspaceFs conformance suite: the same cases every
 * adapter under the ONE coding provider answers, over fake provider functions (a Map standing in
 * for the repo on one ref) instead of REST calls.
 *
 * Where a git remote legitimately differs: it has no directory objects (a directory holding no
 * path lists EMPTY, `missingDirListing: 'empty'`), and provider code search returns text
 * fragments with no line number (`searchLineNumbers: false`).
 */
import { vi } from 'vitest';
import { runWorkspaceConformance } from '@builderforce/agent-tools/workspace-conformance';

/** The repo the faked provider functions read and commit to. Replaced per case. */
const repo = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock('./readRepoContents', () => ({
  async listRepoTree() {
    return { ok: true, paths: [...repo.files.keys()], truncated: false };
  },
  async readRepoFile(_ctx: unknown, path: string) {
    const content = repo.files.get(path);
    if (content === undefined) return { ok: false, reason: `file not found on main: ${path}` };
    return { ok: true, path, content, truncated: false };
  },
  async searchRepoCode(_ctx: unknown, query: string, opts?: { path?: string }) {
    const scope = opts?.path ? `${opts.path.replace(/\/$/, '')}/` : '';
    const matches = [...repo.files.entries()]
      .filter(([path, content]) => path.startsWith(scope) && content.includes(query))
      .map(([path, content]) => ({ path, fragments: content.split('\n').filter((line) => line.includes(query)) }));
    return { ok: true, matches, total: matches.length, truncated: false };
  },
}));

vi.mock('./commitFileAsPendingChange', () => ({
  async commitAgentFile(_ctx: unknown, path: string, content: string) {
    repo.files.set(path, content);
    return { ok: true, branch: 'task', commitUrl: null, commitSha: 'abc', existed: false };
  },
  async deleteAgentFile(_ctx: unknown, path: string) {
    if (!repo.files.delete(path)) return { ok: false, code: 'not_found', reason: `no such file: ${path}` };
    return { ok: true, branch: 'task', commitUrl: null, commitSha: 'def' };
  },
}));

// Imported after the mocks are declared (vi.mock is hoisted above every import).
import { gitRemoteFs } from './gitRemoteFs';
import type { TicketRepoContext } from './commitFileAsPendingChange';

const context = { provider: 'github', host: null, owner: 'o', repo: 'r', token: 't', branch: 'task', base: 'main', repoId: 'r1', segmentId: null } as unknown as TicketRepoContext;

runWorkspaceConformance(
  'gitRemoteFs (fake provider functions)',
  async () => {
    repo.files = new Map();
    return {
      fs: gitRemoteFs(context, { readRef: () => 'main', message: (op, path) => `${op} ${path}` }),
      async seed(files) {
        for (const [path, content] of Object.entries(files)) repo.files.set(path, content);
      },
    };
  },
  { missingDirListing: 'empty', searchLineNumbers: false, absolutePaths: 'repoRooted' },
);
