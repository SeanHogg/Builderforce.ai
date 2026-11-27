import { describe, expect, it, vi } from 'vitest';
import { RUNTIME_TOOL_IDS, runtimeToolFunctionName } from '@builderforce/creation-canvas-contract';
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import { runBrowserRuntimeTool, type BrowserToolDeps } from './browserRuntimeTools';
import { callBrowserRuntimeMcp } from './browserRuntimeMcp';
import { readLogTail } from './logTail';
import { executeRuntimeTool, localRuntimeToolRouter, type RuntimeToolRoutes } from './runtimeToolRouter';
import { createRuntimeToolHost } from './runtimeToolHost';
import { blueprint, service } from '../blueprintFixtures';
import type { ActiveRun } from '../activeRun';
import type { RunLogLine, RunService, RunSession } from '../runTarget';

function logStream(lines: string[], keepOpen = false): ReadableStream<RunLogLine> {
  return new ReadableStream({
    start(controller) {
      lines.forEach((text, i) => controller.enqueue({ serviceId: 'api', text, at: i }));
      if (!keepOpen) controller.close();
    },
  });
}

function session(targetId: RunSession['targetId'], services: RunService[], logs: string[] = []): RunSession {
  return {
    targetId,
    services: () => services,
    url: (id) => services.find((s) => s.id === id)?.url,
    logs: () => logStream(logs, true),
    restart: vi.fn(async () => undefined),
    stop: async () => undefined,
    onState: () => () => undefined,
  };
}

const SERVICES: RunService[] = [
  { id: 'db', label: 'db', state: 'live', previewable: false },
  { id: 'web', label: 'web', state: 'live', previewable: true, url: 'https://p/web' },
  { id: 'api', label: 'api', state: 'failed', previewable: true, url: 'https://p/api', error: 'exit 1' },
];

const browserRun = (logs: string[] = []): ActiveRun => ({
  projectId: '7',
  session: session('browser', SERVICES, logs),
  declined: [],
  blueprint: blueprint({
    services: [
      service({ id: 'web', kind: 'vite-react', rootDir: 'web', isPrimary: true }),
      service({ id: 'api', kind: 'node', rootDir: 'api', verifyCommand: 'npx tsc --noEmit' }),
    ],
  }),
});

function fakeRuntime(exit: Promise<number>, output = 'out') {
  const kill = vi.fn();
  const run = vi.fn(() => ({
    combinedOutput: new ReadableStream<string>({ start(c) { c.enqueue(output); c.close(); } }),
    wait: () => exit,
    kill,
  }));
  return { runtime: { run } as unknown as PreviewRuntime, run, kill };
}

function deps(overrides: Partial<BrowserToolDeps> = {}): BrowserToolDeps {
  return {
    capture: vi.fn(async (url: string) => ({ imageDataUrl: 'data:image/jpeg;base64,AA', width: 1280, height: 800, url })),
    runtime: () => null,
    ownsRuntime: () => true,
    logIdleMs: 5,
    ...overrides,
  };
}

describe('browser executor', () => {
  it('states the target, every service and the declines', async () => {
    const out = await runBrowserRuntimeTool(browserRun(), 'runtime.preview_status', { projectId: 7 }, deps());
    expect(out).toMatchObject({ ok: true, target: 'browser', declined: [], holdsRuntime: true });
    expect(out.services).toEqual([
      { id: 'db', state: 'live' },
      { id: 'web', state: 'live', url: 'https://p/web' },
      { id: 'api', state: 'failed', url: 'https://p/api', error: 'exit 1' },
    ]);
  });

  it('defaults to the first service that serves pages', async () => {
    expect(await runBrowserRuntimeTool(browserRun(), 'runtime.preview_url', { projectId: 7 }, deps())).toMatchObject({ ok: true, serviceId: 'web', url: 'https://p/web' });
  });

  it('reads the log tail without waiting for a stream that stays open', async () => {
    const out = await runBrowserRuntimeTool(browserRun(['one', 'two', 'three']), 'runtime.preview_logs', { projectId: 7, serviceId: 'api', lines: 2 }, deps());
    expect(out).toMatchObject({ ok: true, lines: ['two', 'three'] });
  });

  it('restarts one service through the session', async () => {
    const run = browserRun();
    expect(await runBrowserRuntimeTool(run, 'runtime.preview_restart', { projectId: 7, serviceId: 'web' }, deps())).toMatchObject({ ok: true, restarted: true, serviceId: 'web' });
    expect(run.session.restart).toHaveBeenCalledWith('web');
  });

  it('refuses to act once the editor took the runtime', async () => {
    const run = browserRun();
    const d = deps({ ownsRuntime: () => false });
    for (const tool of ['runtime.preview_restart', 'runtime.run_verify', 'runtime.preview_screenshot'] as const) {
      expect(await runBrowserRuntimeTool(run, tool, { projectId: 7 }, d)).toMatchObject({ ok: false, stopped: true });
    }
    expect(run.session.restart).not.toHaveBeenCalled();
  });

  it('captures the service’s page from inside it, and relays a capture failure', async () => {
    const d = deps();
    const out = await runBrowserRuntimeTool(browserRun(), 'runtime.preview_screenshot', { projectId: 7, viewport: 'mobile' }, d);
    expect(d.capture).toHaveBeenCalledWith('https://p/web', 'mobile');
    expect(out).toMatchObject({ ok: true, target: 'browser', imageDataUrl: 'data:image/jpeg;base64,AA' });
    const failing = deps({ capture: vi.fn(async () => { throw new Error('not supported in this browser'); }) });
    expect(await runBrowserRuntimeTool(browserRun(), 'runtime.preview_screenshot', { projectId: 7 }, failing))
      .toMatchObject({ ok: false, reason: 'not supported in this browser' });
  });

  it('uses MCP for a browser call while keeping screenshot attachments intact', async () => {
    const run = browserRun();
    const screenshot = 'data:image/jpeg;base64,' + 'A'.repeat(40_000);
    const d = deps({ capture: vi.fn(async () => ({ imageDataUrl: screenshot, width: 800, height: 600, url: 'https://p/web' })) });
    expect(await callBrowserRuntimeMcp(run, 'runtime.preview_screenshot', { projectId: 7 }, d))
      .toMatchObject({ ok: true, target: 'browser', width: 800, imageDataUrl: screenshot });
    expect(await callBrowserRuntimeMcp(run, 'runtime.preview_restart', { projectId: 7, serviceId: 'web' }, d))
      .toMatchObject({ ok: true, restarted: true });
    expect(run.session.restart).toHaveBeenCalledExactlyOnceWith('web');
  });

  it('runs the declared verify command in its service root', async () => {
    const { runtime, run } = fakeRuntime(Promise.resolve(2), 'error TS2322');
    const out = await runBrowserRuntimeTool(browserRun(), 'runtime.run_verify', { projectId: 7 }, deps({ runtime: () => Promise.resolve(runtime) }));
    expect(run).toHaveBeenCalledWith('npx', ['tsc', '--noEmit'], { cwd: '/api' });
    expect(out).toMatchObject({ ok: false, results: [{ command: 'npx tsc --noEmit', ok: false, exitCode: 2, output: 'error TS2322' }] });
  });

  it('runs an ad-hoc command in the primary service root, not the project root', async () => {
    const { runtime, run } = fakeRuntime(Promise.resolve(0));
    await runBrowserRuntimeTool(browserRun(), 'runtime.run_verify', { projectId: 7, command: 'npm test' }, deps({ runtime: () => Promise.resolve(runtime) }));
    expect(run).toHaveBeenCalledWith('npm', ['test'], { cwd: '/web' });
  });

  it('kills a verify command at its deadline', async () => {
    const { runtime, kill } = fakeRuntime(new Promise<number>(() => undefined));
    const out = await runBrowserRuntimeTool(browserRun(), 'runtime.run_verify', { projectId: 7 }, deps({ runtime: () => Promise.resolve(runtime), verifyCommandMs: 20 }));
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(out).toMatchObject({ ok: false, results: [{ timedOut: true }] });
  });
});

describe('readLogTail', () => {
  it('stops at the end of a closed stream', async () => {
    expect((await readLogTail(logStream(['a', 'b']), 10, { idleMs: 5 })).map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('caps each line, the total read and the time spent on a stream that never goes quiet', async () => {
    let n = 0;
    const busy = new ReadableStream<RunLogLine>({ pull(c) { c.enqueue({ serviceId: 's', text: n++ === 0 ? 'x'.repeat(50) : 'y', at: n }); } });
    const out = await readLogTail(busy, 3, { idleMs: 50, deadlineMs: 1_000, maxRead: 10, lineChars: 10 });
    expect(n).toBeLessThanOrEqual(12);
    expect(out).toHaveLength(3);
    const first = await readLogTail(new ReadableStream<RunLogLine>({ start(c) { c.enqueue({ serviceId: 's', text: 'x'.repeat(50), at: 0 }); c.close(); } }), 3, { idleMs: 5, lineChars: 10 });
    expect(first[0]!.text).toBe(`${'x'.repeat(10)}…`);
  });
});

describe('routing: one name, the executor of the target the app runs on', () => {
  function routes(run: ActiveRun | undefined, elsewhere: unknown = undefined): RuntimeToolRoutes & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      activeRunFor: (projectId) => (projectId === '7' ? run : undefined),
      ask: async (tool) => {
        calls.push(`ask:${tool}`);
        return elsewhere === undefined ? { answered: false } : { answered: true, result: elsewhere };
      },
      executors: {
        browser: async (tool) => { calls.push(`browser:${tool}`); return { ok: true }; },
        container: async (tool) => { calls.push(`server:${tool}`); return { ok: true }; },
      },
    };
  }

  it('answers a browser run in this tab here', async () => {
    const r = routes(browserRun());
    await executeRuntimeTool('runtime.preview_status', { projectId: 7 }, r);
    expect(r.calls).toEqual(['browser:runtime.preview_status']);
  });

  it('asks the other tabs before the server, and takes their answer', async () => {
    const r = routes(undefined, { ok: true, target: 'browser', from: 'another tab' });
    expect(await executeRuntimeTool('runtime.preview_logs', { projectId: 7 }, r)).toEqual({ ok: true, target: 'browser', from: 'another tab' });
    expect(r.calls).toEqual(['ask:runtime.preview_logs']);
  });

  it('sends a container run, or a run no tab holds, to the server', async () => {
    const container = routes({ ...browserRun(), session: session('container', SERVICES) });
    await executeRuntimeTool('runtime.preview_screenshot', { projectId: 7 }, container);
    const none = routes(undefined);
    await executeRuntimeTool('runtime.preview_screenshot', { projectId: 7 }, none);
    expect([...container.calls, ...none.calls]).toEqual(['server:runtime.preview_screenshot', 'ask:runtime.preview_screenshot', 'server:runtime.preview_screenshot']);
  });

  it('the tool host advertises every runtime tool and routes by function name', async () => {
    const r = routes(browserRun());
    const host = createRuntimeToolHost(r);
    expect(host.schemas().map((s) => s.function.name)).toEqual(RUNTIME_TOOL_IDS.map(runtimeToolFunctionName));
    await host.execute('runtime_preview_logs', { projectId: 7 });
    expect(r.calls).toEqual(['browser:runtime.preview_logs']);
    expect(await host.execute('nope', {})).toMatchObject({ ok: false });
  });

  it('claims only the built-in runtime tools for the Brain', () => {
    expect(localRuntimeToolRouter({ extensionId: 'builtin', tool: 'runtime.preview_status' })).toBeTypeOf('function');
    expect(localRuntimeToolRouter({ extensionId: 'builtin', tool: 'tasks.list' })).toBeUndefined();
    expect(localRuntimeToolRouter({ extensionId: 'acme', tool: 'runtime.preview_status' })).toBeUndefined();
  });
});
