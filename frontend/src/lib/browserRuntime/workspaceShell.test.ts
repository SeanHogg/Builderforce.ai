import { describe, expect, it, vi } from 'vitest';
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import { createWorkspaceShell, MAX_COMMAND_OUTPUT_CHARS, type WorkspaceShellResult } from './workspaceShell';

/** A store whose `list()` names files WITHOUT content, the way the durable one does. */
function memoryStore(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const store: WorkspaceFileStore = {
    id: 7,
    kind: 'server',
    list: async () => [...files.keys()].map((path) => ({ path, content: '', type: 'file' as const })),
    read: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    write: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
    remove: vi.fn(async (path: string) => { files.delete(path); }),
    search: async () => ({ matches: [], truncated: false }),
  };
  return { store, files };
}

type Behaviour = (fs: Map<string, string | Uint8Array>, emit: (text: string) => void) => number | 'hang';

/** Just enough of the runtime: a flat fs keyed `/path`, `writeTree`, and a scripted `run`. */
function fakeRuntime(behaviour: Behaviour, initialFs: Record<string, string> = {}) {
  const fs = new Map<string, string | Uint8Array>(Object.entries(initialFs));
  const spawned: Array<{ command: string; args: string[] }> = [];
  const kill = vi.fn();
  const runtime = {
    fs: {
      list: () => [...fs.keys()].sort(),
      readFile: (path: string) => fs.get(path),
      rm: (path: string) => { fs.delete(path); },
    },
    writeTree: (files: Record<string, string>) => {
      for (const [path, content] of Object.entries(files)) fs.set(`/${path}`, content);
    },
    run: (command: string, args: string[]) => {
      spawned.push({ command, args });
      let push!: (text: string) => void;
      let close!: () => void;
      const output = new ReadableStream<string>({
        start(controller) {
          push = (text) => controller.enqueue(text);
          close = () => controller.close();
        },
      });
      let finish!: (code: number) => void;
      const exit = new Promise<number>((resolve) => { finish = (code) => { close(); resolve(code); }; });
      kill.mockImplementation(() => finish(143));
      const outcome = behaviour(fs, (text) => push(text));
      if (outcome !== 'hang') queueMicrotask(() => finish(outcome));
      return { pid: 1000, combinedOutput: output, stdin: new WritableStream<string>(), wait: () => exit, kill, resizeTerminal: () => {} };
    },
  };
  return { runtime: runtime as unknown as PreviewRuntime, fs, spawned, kill };
}

const run = (shell: ReturnType<typeof createWorkspaceShell>, command: string) => shell.run(command) as Promise<WorkspaceShellResult>;

describe('createWorkspaceShell', () => {
  it('writes the workspace and runs the line through bfsh -c, returning output and exit code', async () => {
    const { store } = memoryStore({ 'package.json': '{"name":"app"}', 'src/App.jsx': 'export default 1;' });
    const fake = fakeRuntime((fs, emit) => {
      emit(`files: ${[...fs.keys()].join(',')}\n`);
      return 0;
    });
    const result = await run(createWorkspaceShell(store, { boot: async () => fake.runtime }), 'npm test && echo done');
    expect(fake.spawned).toEqual([{ command: 'bfsh', args: ['-c', 'npm test && echo done'] }]);
    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.stdout).toContain('/package.json');
    expect(result.stdout).toContain('/src/App.jsx');
    expect(result.changedFiles).toBeUndefined();
  });

  it('reports a failing command as not ok, with its exit code and output', async () => {
    const { store } = memoryStore({ 'a.js': 'x' });
    const fake = fakeRuntime((_fs, emit) => { emit('error TS2304: Cannot find name'); return 2; });
    const result = await run(createWorkspaceShell(store, { boot: async () => fake.runtime }), 'npx tsc --noEmit');
    expect(result).toMatchObject({ ok: false, exitCode: 2, error: 'Exited with code 2.' });
    expect(result.stdout).toContain('TS2304');
  });

  it('saves back a changed and a new file, removes a deleted one, and ignores node_modules', async () => {
    const { store, files } = memoryStore({ 'package.json': '{"name":"app"}', 'src/old.js': 'old', 'src/keep.js': 'keep' });
    const fake = fakeRuntime((fs) => {
      fs.set('/package.json', '{"name":"app","dependencies":{"zod":"^3.0.0"}}');
      fs.set('/src/new.js', 'export const n = 1;');
      fs.delete('/src/old.js');
      fs.set('/node_modules/zod/index.js', 'module.exports = {}');
      fs.set('/dist/index.html', '<html></html>');
      return 0;
    });
    const onFilesChanged = vi.fn();
    const result = await run(createWorkspaceShell(store, { boot: async () => fake.runtime, onFilesChanged }), 'npm install zod');
    expect(result.changedFiles?.sort()).toEqual(['package.json', 'src/new.js']);
    expect(result.removedFiles).toEqual(['src/old.js']);
    expect(files.get('package.json')).toContain('zod');
    expect(files.get('src/new.js')).toBe('export const n = 1;');
    expect(files.has('src/old.js')).toBe(false);
    expect(files.get('src/keep.js')).toBe('keep');
    expect([...files.keys()].some((path) => path.startsWith('node_modules/') || path.startsWith('dist/'))).toBe(false);
    expect(onFilesChanged).toHaveBeenCalledWith(7, expect.arrayContaining(['package.json', 'src/new.js', 'src/old.js']));
  });

  it('keeps installed node_modules across runs but replaces the previous project files', async () => {
    const { store } = memoryStore({ 'a.js': 'a' });
    const fake = fakeRuntime(() => 0, { '/node_modules/react/index.js': 'r', '/stale-from-another-project.js': 's' });
    await run(createWorkspaceShell(store, { boot: async () => fake.runtime }), 'ls');
    expect(fake.fs.has('/node_modules/react/index.js')).toBe(true);
    expect(fake.fs.has('/stale-from-another-project.js')).toBe(false);
    expect(fake.fs.get('/a.js')).toBe('a');
  });

  it('does not save binary or oversized output, and says so', async () => {
    const { store, files } = memoryStore({ 'a.js': 'a' });
    const fake = fakeRuntime((fs) => {
      fs.set('/logo.png', new Uint8Array([137, 80, 78, 71]));
      fs.set('/huge.txt', 'x'.repeat(1_000_001));
      return 0;
    });
    const result = await run(createWorkspaceShell(store, { boot: async () => fake.runtime }), 'node gen.js');
    expect(files.has('logo.png')).toBe(false);
    expect(files.has('huge.txt')).toBe(false);
    expect(result.unsavedFiles?.map((file) => file.path).sort()).toEqual(['huge.txt', 'logo.png']);
  });

  it('keeps only the tail of long output and says it was truncated', async () => {
    const { store } = memoryStore({ 'a.js': 'a' });
    const fake = fakeRuntime((_fs, emit) => {
      emit('HEAD-MARKER\n');
      for (let i = 0; i < 40; i += 1) emit('y'.repeat(1_000));
      emit('\nTAIL-MARKER');
      return 0;
    });
    const result = await run(createWorkspaceShell(store, { boot: async () => fake.runtime }), 'npm install');
    expect(result.stdout).toContain('TAIL-MARKER');
    expect(result.stdout).not.toContain('HEAD-MARKER');
    expect(result.stdout).toContain('truncated');
    expect(result.stdout!.length).toBeLessThan(MAX_COMMAND_OUTPUT_CHARS + 200);
  });

  it('answers a runtime that cannot boot with ok:false, never a throw', async () => {
    const { store } = memoryStore({ 'a.js': 'a' });
    const result = await run(createWorkspaceShell(store, { boot: async () => { throw new Error('service workers are disabled'); } }), 'npm test');
    expect(result).toEqual({ ok: false, error: 'The in-browser runtime is unavailable: service workers are disabled' });
  });

  it('kills a command that outlives the timeout and reports it', async () => {
    const { store } = memoryStore({ 'a.js': 'a' });
    const fake = fakeRuntime((_fs, emit) => { emit('VITE ready'); return 'hang'; });
    const result = await run(createWorkspaceShell(store, { boot: async () => fake.runtime, timeoutMs: 20 }), 'npm run dev');
    expect(fake.kill).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, timedOut: true, exitCode: 143 });
    expect(result.error).toContain('Timed out');
    expect(result.stdout).toContain('VITE ready');
  });

  it('runs one command at a time on the page', async () => {
    const { store } = memoryStore({ 'a.js': 'a' });
    let running = 0;
    let overlapped = false;
    const fake = fakeRuntime(() => {
      running += 1;
      if (running > 1) overlapped = true;
      return 'hang';
    });
    // Each command ends at the timeout; a second spawn before the first exit would overlap.
    const shell = createWorkspaceShell(store, {
      boot: async () => {
        running = 0;
        return fake.runtime;
      },
      timeoutMs: 10,
    });
    await Promise.all([run(shell, 'one'), run(shell, 'two')]);
    expect(fake.spawned.map((entry) => entry.args[1])).toEqual(['one', 'two']);
    expect(overlapped).toBe(false);
  });
});
