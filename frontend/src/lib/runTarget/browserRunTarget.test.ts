import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_APP } from './blueprintFixtures';
import type { RunContext, RunFiles } from './runTarget';

/** The page's one runtime, faked at the package boundary so the REAL lease runs. */
const runtime = vi.hoisted(() => ({
  files: new Map<string, string>(),
  scripts: [] as string[][],
}));
vi.mock('@seanhogg/builderforce-webcontainers', () => ({
  startPreviewRuntime: async () => ({
    fs: { list: () => [...runtime.files.keys()], rm: (p: string) => runtime.files.delete(p), writeFile: () => undefined },
    writeTree: (tree: Record<string, string>) => { for (const [p, c] of Object.entries(tree)) runtime.files.set(`/${p}`, c); },
    setPreviewScripts: (scripts: string[]) => { runtime.scripts.push(scripts); },
    onError: () => () => undefined,
    onPreviewConsole: () => () => undefined,
    listProcesses: () => [],
  }),
}));

interface FakeApp { dispose: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }
const apps = vi.hoisted(() => [] as FakeApp[]);
vi.mock('@seanhogg/builderforce-webcontainers/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seanhogg/builderforce-webcontainers/app')>()),
  createNodeProvider: () => ({ id: 'node' }),
  createPgliteProvider: () => ({ id: 'pglite' }),
  startApplicationRuntime: () => {
    const app = {
      start: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      listServices: () => [{ id: 'web', type: 'application', runtime: 'node', role: 'frontend', state: 'running', port: 5173, url: 'https://p/web', restarts: 0 }],
      getUrl: () => 'https://p/web',
      logs: () => new ReadableStream(),
      restart: vi.fn(async () => undefined),
      onStateChange: () => () => undefined,
      onError: () => () => undefined,
    };
    apps.push(app);
    return app;
  },
}));

const { startInBrowser, RUN_TARGET_OWNER } = await import('./browserRunTarget');
const { bootSharedPreviewRuntime, sharedPreviewRuntimeOwner } = await import('@/lib/browserRuntime/previewRuntime');
const { PREVIEW_CAPTURE_SCRIPT } = await import('@/lib/previewCapture/captureScript');

const FILES: RunFiles = { files: { 'package.json': '{}', 'web/index.html': '<div/>' }, unreadable: [] };
const context = (loadFiles: () => Promise<RunFiles> = async () => FILES): RunContext => ({ projectId: '7', loadFiles });

beforeEach(() => { apps.length = 0; runtime.scripts.length = 0; });

describe('startInBrowser', () => {
  it('mounts the files, installs the capture script, holds the lease and starts the app', async () => {
    const started = await startInBrowser(CANVAS_APP, context());
    expect(started.ok).toBe(true);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.start).toHaveBeenCalled();
    expect(runtime.files.get('/web/index.html')).toBe('<div/>');
    expect(runtime.scripts.at(-1)).toEqual([PREVIEW_CAPTURE_SCRIPT]);
    expect(sharedPreviewRuntimeOwner()).toBe(RUN_TARGET_OWNER);
    if (started.ok) await started.session.stop();
    expect(apps[0]!.dispose).toHaveBeenCalled();
    expect(sharedPreviewRuntimeOwner()).toBeNull();
    // The capture script leaves the preview pages with the run.
    expect(runtime.scripts.at(-1)).toEqual([]);
  });

  it('disposes the previous application before starting the next', async () => {
    await startInBrowser(CANVAS_APP, context());
    const second = await startInBrowser(CANVAS_APP, context());
    expect(apps).toHaveLength(2);
    expect(apps[0]!.dispose).toHaveBeenCalled();
    expect(apps[1]!.dispose).not.toHaveBeenCalled();
    if (second.ok) await second.session.stop();
  });

  it('serialises concurrent starts: the older one is superseded and starts nothing', async () => {
    const [first, second] = await Promise.all([startInBrowser(CANVAS_APP, context()), startInBrowser(CANVAS_APP, context())]);
    expect(first).toEqual({ ok: false, code: 'superseded' });
    expect(second.ok).toBe(true);
    expect(apps).toHaveLength(1);
    if (second.ok) await second.session.stop();
  });

  it('gives up a start superseded while its files were loading', async () => {
    let release: ((files: RunFiles) => void) | undefined;
    const slow = startInBrowser(CANVAS_APP, context(() => new Promise((resolve) => { release = resolve; })));
    const fast = startInBrowser(CANVAS_APP, context());
    await vi.waitFor(() => expect(release).toBeDefined());
    release!(FILES);
    expect(await slow).toEqual({ ok: false, code: 'superseded' });
    const winner = await fast;
    expect(winner.ok).toBe(true);
    expect(apps).toHaveLength(1);
    if (winner.ok) await winner.session.stop();
  });

  it('hands the runtime over when the workspace takes the lease: the app is disposed and reads stopped', async () => {
    const started = await startInBrowser(CANVAS_APP, context());
    if (!started.ok) throw new Error('expected a session');
    const changed = vi.fn();
    started.session.onState(changed);
    await bootSharedPreviewRuntime(); // the editor's workspace
    expect(apps[0]!.dispose).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
    expect(started.session.services().every((s) => s.state === 'stopped')).toBe(true);
    expect(sharedPreviewRuntimeOwner()).toBe('workspace');
    expect(runtime.scripts.at(-1)).toEqual([]);
  });

  it('refuses a partial tree, naming the files it could not read', async () => {
    const out = await startInBrowser(CANVAS_APP, context(async () => ({ files: { 'package.json': '{}' }, unreadable: ['a.ts', 'b.ts'] })));
    expect(out).toEqual({ ok: false, code: 'noFiles', detail: 'a.ts, b.ts' });
    expect(apps).toHaveLength(0);
  });

  it('declines without touching the runtime when the browser cannot run the blueprint', async () => {
    expect(await startInBrowser(null, context())).toEqual({ ok: false, code: 'noBlueprint' });
    expect(apps).toHaveLength(0);
  });
});
