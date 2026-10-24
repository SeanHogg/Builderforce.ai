/**
 * The shared tools over the sandbox: the shell and the working tree are the sandbox's,
 * every commit stays the provider's (lease, inspection, ledger), and the sandbox then
 * absorbs what was committed. Ported from the container image's own `write_file` /
 * `edit_file` handlers, which the one engine replaced.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityProvider } from '@builderforce/agent-tools';

vi.mock('../cloudAgent/runContext', () => ({ SANDBOX_COMMAND_HEARTBEAT_MS: 60_000 }));

import { SANDBOX_CAPABILITIES, withSandbox } from './sandboxProvider';
import type { RunSandbox, SandboxFsRequest } from './runSandbox';

afterEach(() => { vi.useRealTimers(); });

function fakeSandbox(files: Record<string, string> = {}) {
  const fsCalls: SandboxFsRequest[] = [];
  const sandbox: RunSandbox = {
    fs: vi.fn(async (req: SandboxFsRequest) => {
      fsCalls.push(req);
      if (req.op === 'read') return req.path in files ? { ok: true, content: files[req.path] } : { ok: false, error: 'read failed: ENOENT' };
      if (req.op === 'list') return { ok: true, paths: Object.keys(files) };
      return { ok: true };
    }),
    run: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: 'done' })),
    checks: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  return { sandbox, fsCalls };
}

function baseProvider(writeOk = true): CapabilityProvider & { writes: Array<[string, string]> } {
  const writes: Array<[string, string]> = [];
  return {
    writes,
    capabilities: new Set(['repo.read', 'repo.write', 'repo.edit']),
    repoRead: {
      listFiles: vi.fn(async () => ({ ok: true, paths: ['from-api.ts'] })),
      readFile: vi.fn(async () => ({ ok: true, content: 'from the api' })),
      searchCode: vi.fn(async () => ({ ok: true, matches: [] })),
    },
    repoWrite: {
      writeFile: vi.fn(async (path: string, content: string) => {
        writes.push([path, content]);
        return writeOk ? { ok: true, branch: 'bf/1', commitUrl: 'https://c', change: 'modified' as const } : { ok: false, error: 'lease held by another agent' };
      }),
      deleteFile: vi.fn(async () => ({ ok: true, deleted: true })),
      editFile: vi.fn(async () => ({ ok: false, error: 'the api edit must not be used' })),
    },
  } as never;
}

describe('withSandbox', () => {
  it('adds exactly what the sandbox backs — `shell` — and keeps every other capability', () => {
    const p = withSandbox(baseProvider(), fakeSandbox().sandbox, { heartbeat: async () => undefined });
    expect([...SANDBOX_CAPABILITIES]).toEqual(['shell']);
    expect(p.capabilities.has('shell')).toBe(true);
    expect(p.capabilities.has('repo.write')).toBe(true);
  });

  it('runs commands in the sandbox and beats the heartbeat while one runs', async () => {
    vi.useFakeTimers();
    const { sandbox } = fakeSandbox();
    let release: () => void = () => {};
    (sandbox.run as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => { release = () => r({ ok: true, exitCode: 0, stdout: 'built' }); }));
    const heartbeat = vi.fn(async () => undefined);
    const abort = new AbortController();
    const p = withSandbox(baseProvider(), sandbox, { heartbeat, signal: abort.signal });
    const ran = p.shell!.run('pnpm build');
    await vi.advanceTimersByTimeAsync(130_000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    release();
    await expect(ran).resolves.toEqual({ ok: true, exitCode: 0, stdout: 'built' });
    expect(sandbox.run).toHaveBeenCalledWith('pnpm build', abort.signal);
    // The beat stops with the command.
    await vi.advanceTimersByTimeAsync(130_000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it('reads and lists the working tree, so a file a command generated is visible', async () => {
    const base = baseProvider();
    const { sandbox } = fakeSandbox({ 'dist/out.js': 'generated' });
    const p = withSandbox(base, sandbox, { heartbeat: async () => undefined });
    await expect(p.repoRead!.readFile('dist/out.js')).resolves.toEqual({ ok: true, path: 'dist/out.js', content: 'generated' });
    await expect(p.repoRead!.listFiles()).resolves.toMatchObject({ ok: true, paths: ['dist/out.js'] });
    expect(base.repoRead!.readFile).not.toHaveBeenCalled();
    // Search stays on the provider's own backing.
    await p.repoRead!.searchCode('x');
    expect(base.repoRead!.searchCode).toHaveBeenCalledWith('x', undefined);
  });

  it('commits a write through the provider, then has the sandbox absorb the commit', async () => {
    const base = baseProvider();
    const { sandbox, fsCalls } = fakeSandbox();
    const p = withSandbox(base, sandbox, { heartbeat: async () => undefined });
    await expect(p.repoWrite!.writeFile('src/a.ts', 'export {}', 'add a')).resolves.toMatchObject({ ok: true, branch: 'bf/1' });
    expect(base.writes).toEqual([['src/a.ts', 'export {}']]);
    expect(fsCalls).toContainEqual({ op: 'write', path: 'src/a.ts', content: 'export {}', committed: true });
  });

  it('a commit the provider refused is never mirrored into the clone', async () => {
    const { sandbox, fsCalls } = fakeSandbox();
    const p = withSandbox(baseProvider(false), sandbox, { heartbeat: async () => undefined });
    await expect(p.repoWrite!.writeFile('src/a.ts', 'x')).resolves.toMatchObject({ ok: false });
    expect(fsCalls.some((c) => c.op === 'write')).toBe(false);
  });

  it('mirrors a committed delete', async () => {
    const { sandbox, fsCalls } = fakeSandbox();
    const p = withSandbox(baseProvider(), sandbox, { heartbeat: async () => undefined });
    await p.repoWrite!.deleteFile('old.ts');
    expect(fsCalls).toContainEqual({ op: 'delete', path: 'old.ts', committed: true });
  });

  it('edits the WORKING TREE with the shared edit core and commits the result through writeFile', async () => {
    const base = baseProvider();
    const { sandbox, fsCalls } = fakeSandbox({ 'src/a.ts': 'const a = 1;\nconst b = 2;\n' });
    const p = withSandbox(base, sandbox, { heartbeat: async () => undefined });
    const r = await p.repoWrite!.editFile('src/a.ts', 'const b = 2;', 'const b = 3;');
    expect(r).toMatchObject({ ok: true, change: 'modified', branch: 'bf/1', replaced: 1 });
    expect(base.writes).toEqual([['src/a.ts', 'const a = 1;\nconst b = 3;\n']]);
    expect(base.repoWrite!.editFile).not.toHaveBeenCalled();
    expect(fsCalls).toContainEqual({ op: 'write', path: 'src/a.ts', content: 'const a = 1;\nconst b = 3;\n', committed: true });
  });

  it('an edit whose old_string is missing commits nothing and says so', async () => {
    const base = baseProvider();
    const { sandbox } = fakeSandbox({ 'src/a.ts': 'const a = 1;\n' });
    const p = withSandbox(base, sandbox, { heartbeat: async () => undefined });
    const r = await p.repoWrite!.editFile('src/a.ts', 'nope', 'x');
    expect(r.ok).toBe(false);
    expect(r.error).toContain("cannot edit 'src/a.ts'");
    expect(base.writes).toEqual([]);
  });

  it('an edit of a file the tree does not hold fails before anything is committed', async () => {
    const base = baseProvider();
    const p = withSandbox(base, fakeSandbox().sandbox, { heartbeat: async () => undefined });
    await expect(p.repoWrite!.editFile('missing.ts', 'a', 'b')).resolves.toMatchObject({ ok: false });
    expect(base.writes).toEqual([]);
  });
});
