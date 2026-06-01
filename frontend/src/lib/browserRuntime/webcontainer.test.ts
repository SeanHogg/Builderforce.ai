import { describe, it, expect, vi } from 'vitest';
import { runBuildInWebContainer, type WebContainerLike } from './webcontainer';

function streamOf(chunks: string[]): ReadableStream<string> {
  let i = 0;
  return new ReadableStream<string>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

function fakeWc(exitCode: number, chunks: string[]): WebContainerLike & { mounted: unknown; spawned?: [string, string[]] } {
  const wc: WebContainerLike & { mounted: unknown; spawned?: [string, string[]] } = {
    mounted: undefined,
    mount: vi.fn(async (tree: unknown) => {
      wc.mounted = tree;
    }),
    spawn: vi.fn(async (command: string, args: string[]) => {
      wc.spawned = [command, args];
      return { output: streamOf(chunks), exit: Promise.resolve(exitCode) };
    }),
  };
  return wc;
}

describe('runBuildInWebContainer', () => {
  it('mounts the tree, spawns the command, and reports ok on exit 0', async () => {
    const wc = fakeWc(0, ['running tests\n', 'all pass\n']);
    const tree = { 'package.json': {} };
    const res = await runBuildInWebContainer({ boot: async () => wc, tree }, ['npm', 'test']);
    expect(wc.mounted).toBe(tree);
    expect(wc.spawned).toEqual(['npm', ['test']]);
    expect(res).toEqual({ ok: true, output: 'running tests\nall pass\n' });
  });

  it('reports not-ok on a non-zero exit', async () => {
    const wc = fakeWc(1, ['tsc error TS2322\n']);
    const res = await runBuildInWebContainer({ boot: async () => wc, tree: {} }, ['npm', 'run', 'build']);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('tsc error');
  });

  it('throws on an empty command', async () => {
    const wc = fakeWc(0, []);
    await expect(runBuildInWebContainer({ boot: async () => wc, tree: {} }, [])).rejects.toThrow(/empty command/);
  });
});
