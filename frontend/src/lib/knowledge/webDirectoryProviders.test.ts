import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  peek: vi.fn(),
  providers: vi.fn(),
  report: vi.fn(),
}));
vi.mock('@/lib/browserRuntime/previewRuntime', () => ({ peekSharedPreviewRuntime: mocks.peek }));
vi.mock('@/lib/driveApi', () => ({ driveApi: { providers: mocks.providers, list: vi.fn(), fetchFile: vi.fn() } }));
vi.mock('./webHost', async () => {
  const { hostRootId } = await import('@builderforce/knowledge-browser');
  return {
    WEB_HOST: 'web',
    webRootId: (kind: string, ...parts: Array<string | number>) => hostRootId('web', kind, ...parts),
    reportKnowledgeDegraded: mocks.report,
  };
});

import { webDirectoryProviders } from './webDirectoryProviders';

const OPTIONS = { projectId: 7, workspaceTitle: 'Workspace files' };

const runtimeWith = (paths: string[]) => Promise.resolve({
  fs: { list: () => paths, readText: () => 'text', watch: () => () => undefined },
});

const connection = (id: number, status = 'connected') => ({
  id, provider: 'google' as const, accountEmail: `u${id}@example.com`, displayName: id === 1 ? 'Legal drive' : '', status, lastError: null,
});

beforeEach(() => {
  mocks.peek.mockReset().mockReturnValue(null);
  mocks.providers.mockReset().mockResolvedValue({ providers: [], connections: [] });
  mocks.report.mockReset();
});

describe('web directory providers', () => {
  it('offers only the folder upload when no workspace runtime is running and no drive is connected', async () => {
    const out = await webDirectoryProviders(OPTIONS);
    expect(out.map((p) => p.kind)).toEqual(['upload']);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('offers the workspace first when its runtime is already running with files, and never boots one', async () => {
    mocks.peek.mockReturnValue(runtimeWith(['/index.html']));
    const out = await webDirectoryProviders(OPTIONS);
    expect(out.map((p) => p.kind)).toEqual(['workspace', 'upload']);
    expect(out[0]!.id).toBe('workspace');
    const workspace = out[0]!;
    expect(workspace.kind).toBe('workspace');
    const source = (await workspace.open())!;
    expect(source.title).toBe('Workspace files');
    expect(source.rootId).toContain('vfs');
    expect(source.rootId).toContain('7');
    expect(mocks.peek).toHaveBeenCalledTimes(1);
  });

  it('re-opens the workspace for its own root without a picker, and no other root', async () => {
    mocks.peek.mockReturnValue(runtimeWith(['/index.html']));
    const workspace = (await webDirectoryProviders(OPTIONS))[0]!;
    const rootId = (await workspace.open())!.rootId;
    expect((await workspace.reopen!(rootId))?.rootId).toBe(rootId);
    expect(await workspace.reopen!('web:vfs:99')).toBeNull();
  });

  it('offers no workspace for an empty runtime', async () => {
    mocks.peek.mockReturnValue(runtimeWith([]));
    expect((await webDirectoryProviders(OPTIONS)).map((p) => p.kind)).toEqual(['upload']);
  });

  it('reports a runtime that failed to boot and carries on without the workspace', async () => {
    const failure = new Error('relay unreachable');
    mocks.peek.mockReturnValue(Promise.reject(failure));
    const out = await webDirectoryProviders(OPTIONS);
    expect(out.map((p) => p.kind)).toEqual(['upload']);
    expect(mocks.report).toHaveBeenCalledWith('workspace runtime', failure);
  });

  it('offers each CONNECTED drive, titled by its name or its account, and re-opens it by root', async () => {
    mocks.providers.mockResolvedValue({ providers: [], connections: [connection(1), connection(2), connection(3, 'expired')] });
    const out = await webDirectoryProviders(OPTIONS);
    const drives = out.filter((p) => p.kind === 'drive');
    expect(drives.map((p) => p.id)).toEqual(['drive:1', 'drive:2']);
    expect(drives.map((p) => p.title)).toEqual(['Legal drive', 'u2@example.com']);

    const first = drives[0]!;
    const rootId = (await first.open())!.rootId;
    expect((await first.reopen!(rootId))?.rootId).toBe(rootId);
    expect(await first.reopen!((await drives[1]!.open())!.rootId)).toBeNull();
  });

  it('reports a drive listing that fails and still offers the rest', async () => {
    const failure = new Error('offline');
    mocks.providers.mockRejectedValue(failure);
    const out = await webDirectoryProviders(OPTIONS);
    expect(out.map((p) => p.kind)).toEqual(['upload']);
    expect(mocks.report).toHaveBeenCalledWith('drive connections', failure);
  });
});
