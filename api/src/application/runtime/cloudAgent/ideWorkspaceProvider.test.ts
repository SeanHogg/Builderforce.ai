/**
 * A repo-less run's working tree is its project's IDE workspace (ticket 3089). This
 * backing used to exist only in the container image's `write` op; the one engine now
 * gives it to every run, through the same shared tools and the same coordination lease.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityProvider, RepoWriteCapability } from '@builderforce/agent-tools';

const h = vi.hoisted(() => ({
  blocked: false,
  notify: vi.fn(),
  record: vi.fn(async () => undefined),
  list: vi.fn(async () => ({ ok: true, ref: 'workspace', paths: ['index.html'] })),
  read: vi.fn(async () => ({ ok: true, path: 'index.html', content: '<h1/>' })),
  search: vi.fn(async () => ({ ok: true, query: 'h1', total: 1, matches: [] })),
  write: vi.fn(async () => ({ ok: true, branch: 'workspace', change: 'created' as const })),
  edit: vi.fn(async () => ({ ok: true, branch: 'workspace', change: 'modified' as const, replaced: 1 })),
  del: vi.fn(async () => ({ ok: true, deleted: true })),
}));

vi.mock('./ideWorkspaceCoding', () => ({
  listIdeWorkspaceFiles: h.list, readIdeWorkspaceFile: h.read, searchIdeWorkspace: h.search,
  writeIdeWorkspaceFile: h.write, editIdeWorkspaceFile: h.edit, deleteIdeWorkspaceFile: h.del,
}));
vi.mock('../executionEvents', () => ({ notifyExecutionSubscribers: h.notify }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../../coordination/coordinationCapability', () => ({
  // The lease gate: refuse every write while `blocked`, naming the holder.
  guardRepoWrite: (inner: RepoWriteCapability, args: { holder: unknown; onRefused?: (p: string, by: string) => void }) => {
    const gate = <T>(path: string, go: () => Promise<T>) => {
      if (!h.blocked) return go();
      args.onRefused?.(path, 'agent-2');
      return Promise.resolve({ ok: false, error: 'held by agent-2' });
    };
    (globalThis as { leaseHolder?: unknown }).leaseHolder = args.holder;
    return {
      writeFile: (p: string, c: string, s?: string) => gate(p, () => inner.writeFile(p, c, s)),
      editFile: (p: string, o: string, n: string, r?: boolean) => gate(p, () => inner.editFile(p, o, n, r)),
      deleteFile: (p: string, r?: string) => gate(p, () => inner.deleteFile(p, r)),
    };
  },
}));

import { withIdeWorkspace } from './ideWorkspaceProvider';

const ide = { bucket: {} as R2Bucket, projectId: 12, projectName: 'Landing page' };
const base = { capabilities: new Set(['repo.read', 'repo.write']) } as unknown as CapabilityProvider;

function provider() {
  const writtenPaths = new Set<string>();
  const p = withIdeWorkspace(base, ide, { tenantId: 1, taskId: 5, executionId: 77, agentLabel: 'Agent', cloudAgentRef: 'a1', writtenPaths }, { env: {} as never, db: {} as never });
  return { p, writtenPaths };
}

beforeEach(() => {
  h.blocked = false;
  for (const f of [h.notify, h.record, h.list, h.read, h.search, h.write, h.edit, h.del]) f.mockClear();
});

describe('withIdeWorkspace', () => {
  it('reads, lists and searches the workspace', async () => {
    const { p } = provider();
    await expect(p.repoRead!.readFile('index.html')).resolves.toMatchObject({ ok: true, content: '<h1/>' });
    await p.repoRead!.listFiles('src', '*.ts');
    await p.repoRead!.searchCode('h1', 'src');
    expect(h.read).toHaveBeenCalledWith(ide.bucket, 12, 'index.html');
    expect(h.list).toHaveBeenCalledWith(ide.bucket, 12, 'src', '*.ts');
    expect(h.search).toHaveBeenCalledWith(ide.bucket, 12, 'h1', 'src');
  });

  it('writes the workspace, records the path and notifies the live run', async () => {
    const { p, writtenPaths } = provider();
    await expect(p.repoWrite!.writeFile('index.html', '<h1>Hi</h1>')).resolves.toMatchObject({ ok: true });
    expect(h.write).toHaveBeenCalledWith(expect.anything(), ide, expect.objectContaining({ tenantId: 1, taskId: 5, executionId: 77, agent: 'Agent', path: 'index.html', content: '<h1>Hi</h1>' }));
    expect([...writtenPaths]).toEqual(['index.html']);
    expect(h.notify).toHaveBeenCalledWith(77, expect.objectContaining({ type: 'file_change', path: 'index.html', change: 'created' }));
  });

  it('edits through the shared edit core and deletes, keeping writtenPaths true', async () => {
    const { p, writtenPaths } = provider();
    await p.repoWrite!.editFile('index.html', '<h1/>', '<h2/>', true);
    expect(h.edit).toHaveBeenCalledWith(expect.anything(), ide, expect.objectContaining({ path: 'index.html', oldString: '<h1/>', newString: '<h2/>', replaceAll: true }));
    expect(writtenPaths.has('index.html')).toBe(true);
    await p.repoWrite!.deleteFile('index.html');
    expect(writtenPaths.has('index.html')).toBe(false);
    expect(h.notify).toHaveBeenLastCalledWith(77, expect.objectContaining({ change: 'deleted' }));
  });

  it('a delete of a file that was never there changes nothing', async () => {
    h.del.mockResolvedValueOnce({ ok: true, deleted: false } as never);
    const { p, writtenPaths } = provider();
    writtenPaths.add('keep.ts');
    await p.repoWrite!.deleteFile('ghost.ts');
    expect([...writtenPaths]).toEqual(['keep.ts']);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('takes the coordination lease on the workspace, and records a refusal', async () => {
    const { p, writtenPaths } = provider();
    expect((globalThis as { leaseHolder?: Record<string, unknown> }).leaseHolder).toMatchObject({ repoSlug: 'workspace:12', branch: 'workspace', taskId: 5, executionId: 77 });
    h.blocked = true;
    await expect(p.repoWrite!.writeFile('index.html', 'x')).resolves.toMatchObject({ ok: false });
    expect(h.write).not.toHaveBeenCalled();
    expect(writtenPaths.size).toBe(0);
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toolName: 'coordination.refused', detail: { path: 'index.html', heldBy: 'agent-2' } }));
  });

  it('a failed workspace write leaves writtenPaths alone', async () => {
    h.write.mockResolvedValueOnce({ ok: false, error: 'rejected' } as never);
    const { p, writtenPaths } = provider();
    await p.repoWrite!.writeFile('x.ts', 'y');
    expect(writtenPaths.size).toBe(0);
  });
});
