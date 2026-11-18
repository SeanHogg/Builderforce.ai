import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ApplicationRuntime, ServiceSnapshot } from '@seanhogg/builderforce-webcontainers/app';

const loadLivePreview = vi.hoisted(() => vi.fn());
vi.mock('@/lib/siteApi', () => ({ loadLivePreview }));

const { browserRunSession, toRunService } = await import('./browserRunSession');
const { containerRunTarget, containerServices } = await import('./containerRunTarget');

const context = { projectId: '7', executionId: 12, loadFiles: async () => ({ files: {}, unreadable: [] }) };

beforeEach(() => { loadLivePreview.mockReset(); });

describe('browser session', () => {
  const snapshot = (overrides: Partial<ServiceSnapshot>): ServiceSnapshot => ({
    id: 'web', type: 'application', runtime: 'node', role: 'frontend', state: 'running', restarts: 0, ...overrides,
  });

  it('states the runtime lifecycle in the surface’s four states', () => {
    expect(toRunService(snapshot({ state: 'preparing' })).state).toBe('starting');
    expect(toRunService(snapshot({ state: 'ready', port: 5173, url: 'https://p/x' }))).toEqual({
      id: 'web', label: 'web', state: 'live', previewable: true, url: 'https://p/x',
    });
    expect(toRunService(snapshot({ state: 'stopping' })).state).toBe('stopped');
    expect(toRunService(snapshot({
      state: 'failed', error: { serviceId: 'web', phase: 'exit', message: 'exit 1', willRestart: false },
    }))).toMatchObject({ state: 'failed', error: 'exit 1' });
  });

  it('never offers a database or a one-off step as a page', () => {
    expect(toRunService(snapshot({ id: 'db', type: 'database', runtime: 'pglite', port: 5432 })).previewable).toBe(false);
    expect(toRunService(snapshot({ id: 'db-migrate' })).previewable).toBe(false);
  });

  it('drives the application runtime: restart one service, dispose on stop, logs as lines', async () => {
    const entries = new ReadableStream({
      start(controller) {
        controller.enqueue({ serviceId: 'api', source: 'output', text: 'listening', at: 1 });
        controller.close();
      },
    });
    const app = {
      listServices: () => [snapshot({ id: 'api', role: 'backend', port: 8000 })],
      getUrl: () => 'https://p/api',
      logs: vi.fn(() => entries),
      restart: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      onStateChange: vi.fn(() => () => undefined),
      onError: vi.fn(() => () => undefined),
    } as unknown as ApplicationRuntime;
    const onStop = vi.fn();
    const { session } = browserRunSession(app, onStop);
    expect(session.targetId).toBe('browser');
    expect(session.url('api')).toBe('https://p/api');
    await session.restart('api');
    expect(app.restart).toHaveBeenCalledWith('api');
    const reader = session.logs('api').getReader();
    expect((await reader.read()).value).toEqual({ serviceId: 'api', text: 'listening', at: 1 });
    await session.stop();
    expect(app.dispose).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
  });

  it('when revoked, disposes the app, reads stopped and tells its listeners', async () => {
    const app = {
      listServices: () => [snapshot({ id: 'web', port: 5173, url: 'https://p/web' })],
      getUrl: () => 'https://p/web',
      restart: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      onStateChange: vi.fn(() => () => undefined),
      onError: vi.fn(() => () => undefined),
    } as unknown as ApplicationRuntime;
    const handle = browserRunSession(app);
    const changed = vi.fn();
    handle.session.onState(changed);
    await handle.revoke();
    expect(app.dispose).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalled();
    expect(handle.session.services()).toEqual([{ id: 'web', label: 'web', previewable: true, state: 'stopped' }]);
    expect(handle.session.url('web')).toBeUndefined();
    await handle.session.restart('web');
    expect(app.restart).not.toHaveBeenCalled();
    await handle.session.stop();
    expect(app.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('container target', () => {
  const link = { url: 'https://preview.test/app', expiresInSeconds: 600, status: 'live' as const };

  it('declines with the existing reason when no container holds a preview', async () => {
    loadLivePreview.mockResolvedValue(null);
    expect(await containerRunTarget.start(null, context)).toEqual({ ok: false, code: 'noContainerPreview' });
    expect(loadLivePreview).toHaveBeenCalledWith({ projectId: '7', executionId: 12 });
  });

  it('shows the container’s one app, or its named services', () => {
    expect(containerServices(link)).toEqual([{ id: 'app', url: link.url, state: 'live', previewable: true }]);
    expect(containerServices({ ...link, status: 'starting', services: [{ id: 'api', label: 'API', url: 'https://preview.test/api' }] }))
      .toEqual([{ id: 'api', label: 'API', url: 'https://preview.test/api', state: 'starting', previewable: true }]);
  });

  it('restarts by minting a new ticket', async () => {
    loadLivePreview.mockResolvedValueOnce(link).mockResolvedValueOnce({ ...link, url: 'https://preview.test/new' });
    const started = await containerRunTarget.start(null, context);
    if (!started.ok) throw new Error('expected a session');
    const changed = vi.fn();
    started.session.onState(changed);
    await started.session.restart('app');
    expect(loadLivePreview).toHaveBeenCalledTimes(2);
    expect(started.session.url('app')).toBe('https://preview.test/new');
    expect(changed).toHaveBeenCalled();
  });

  it('lets a plan-limit rejection through', async () => {
    const limit = new Error('402');
    loadLivePreview.mockRejectedValue(limit);
    await expect(containerRunTarget.start(null, context)).rejects.toBe(limit);
  });
});
