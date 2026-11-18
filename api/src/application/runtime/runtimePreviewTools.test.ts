import { describe, expect, it, vi } from 'vitest';
import { BROWSER_RUN_NOT_ATTACHED, RUNTIME_TOOL_IDS } from '@builderforce/creation-canvas-contract';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { runContainerRuntimeTool, type ContainerRuntimeDeps, type RuntimeToolCaller } from './runtimePreviewTools';
import { runWithinBudget } from './containerPreviewControl';
import { ScreenshotUnavailableError } from '../web/webScreenshot';
import { RUNTIME_PREVIEW_TOOLS } from '../llm/runtimeToolCatalog';
import { CLOUD_AGENT_PLATFORM_TOOLS } from '../llm/cloudAgentToolset';
import { TenantRole } from '../../domain/shared/types';
import type { PreviewSessionRow } from './previewSessions';

const developer = { env: {}, db: {}, tenantId: 3, role: TenantRole.DEVELOPER } as unknown as RuntimeToolCaller;
const viewer = { ...developer, role: TenantRole.VIEWER } as RuntimeToolCaller;
const LIVE = { available: true as const, url: 'https://preview.builderforce.ai/tok/', expiresInSeconds: 900, executionId: 41, status: 'live' as const };
const LEASE: PreviewSessionRow = { executionId: 41, projectId: 9, port: 5173, status: 'live', detail: null, lastSeenAt: new Date(0) };
const SECRET = 'sk_live_supersecret';

function deps(overrides: Partial<ContainerRuntimeDeps> = {}): ContainerRuntimeDeps {
  return {
    projectInTenant: vi.fn(async () => true),
    hasLivePreview: vi.fn(async () => true),
    loadPreviewSession: vi.fn(async () => LEASE),
    loadProjectPreviewSession: vi.fn(async () => LEASE),
    mintPreviewForExecution: vi.fn(async () => LIVE),
    captureWebScreenshot: vi.fn(async () => ({
      url: LIVE.url, imageDataUrl: 'data:image/jpeg;base64,AAA', mimeType: 'image/jpeg', width: 1280, height: 800,
      viewport: 'desktop' as const, fullPage: false, byteSize: 3, provider: 'cloudflare-browser-rendering' as const, capturedAt: '2026-11-18T00:00:00Z',
    })),
    getLatestBlueprint: vi.fn(async () => ({ services: [{ verifyCommand: 'npx tsc --noEmit' }, { verifyCommand: 'npx tsc --noEmit' }, { verifyCommand: null }] }) as unknown as AppBlueprint),
    secretValues: vi.fn(async () => ({ STRIPE_KEY: SECRET })),
    runInSandbox: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: 'ok' })),
    previewControl: vi.fn(async () => ({ ok: true, lines: [`booting with ${SECRET}`, 'ready'], running: true, exitCode: null })),
    ...overrides,
  };
}

describe('runtime.* catalog', () => {
  it('is one catalog row per shared tool definition, run_verify mutating', () => {
    expect(RUNTIME_PREVIEW_TOOLS.map((t) => t.tool)).toEqual([...RUNTIME_TOOL_IDS]);
    expect(RUNTIME_PREVIEW_TOOLS.find((t) => t.tool === 'runtime.run_verify')?.mutates).toBe(true);
  });

  it('is granted to cloud agents', () => {
    for (const tool of RUNTIME_TOOL_IDS) expect(CLOUD_AGENT_PLATFORM_TOOLS).toContain(tool);
  });
});

describe('runContainerRuntimeTool — gates', () => {
  it('refuses a project outside the workspace before reading anything', async () => {
    const d = deps({ projectInTenant: vi.fn(async () => false) });
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_url', { projectId: 9 }, d)).toMatchObject({ ok: false });
    expect(d.loadProjectPreviewSession).not.toHaveBeenCalled();
  });

  it('denies a viewer an ad-hoc command, but runs the declared verify commands', async () => {
    const d = deps();
    expect(await runContainerRuntimeTool(viewer, 'runtime.run_verify', { projectId: 9, command: 'curl evil' }, d)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(d.runInSandbox).not.toHaveBeenCalled();
    expect(await runContainerRuntimeTool(viewer, 'runtime.run_verify', { projectId: 9 }, d)).toMatchObject({ ok: true });
    expect(d.runInSandbox).toHaveBeenCalledWith(viewer.env, 41, 'npx tsc --noEmit', expect.any(Number));
  });

  it('lets an agent run an ad-hoc command', async () => {
    const agent = { env: {}, db: {}, tenantId: 3, isAgent: true } as unknown as RuntimeToolCaller;
    expect(await runContainerRuntimeTool(agent, 'runtime.run_verify', { projectId: 9, command: 'npm test' }, deps())).toMatchObject({ ok: true });
  });

  it('answers a plan without livePreview with a plan-limit code', async () => {
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_status', { projectId: 9 }, deps({ hasLivePreview: vi.fn(async () => false) })))
      .toMatchObject({ ok: false, code: 'plan_limit' });
  });

  it('rejects an execution that belongs to another project', async () => {
    const d = deps({ loadPreviewSession: vi.fn(async () => ({ ...LEASE, projectId: 77 })) });
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_url', { projectId: 9, executionId: 41 }, d))
      .toMatchObject({ ok: false, error: 'That run does not belong to this project.' });
    expect(d.mintPreviewForExecution).not.toHaveBeenCalled();
  });

  it('says the run is in the browser — never waits — when no container holds a preview', async () => {
    const d = deps({ loadProjectPreviewSession: vi.fn(async () => null) });
    const out = await runContainerRuntimeTool(developer, 'runtime.preview_screenshot', { projectId: 9 }, d);
    expect(out).toMatchObject({ ok: false, code: BROWSER_RUN_NOT_ATTACHED, target: null });
    expect(String(out.reason)).toMatch(/open the project and press "Run in your browser"/);
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_status', { projectId: 9 }, d))
      .toMatchObject({ ok: true, live: false, code: BROWSER_RUN_NOT_ATTACHED, declined: [{ targetId: 'container', code: 'noContainerPreview' }] });
  });
});

describe('runContainerRuntimeTool — the container target', () => {
  it('reports the container target and its service', async () => {
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_status', { projectId: 9 }, deps())).toMatchObject({
      ok: true, target: 'container', status: 'live', services: [{ id: 'app', state: 'live', url: LIVE.url }],
    });
  });

  it('screenshots the preview URL through Browser Rendering, relaying an unavailable reason', async () => {
    const d = deps();
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_screenshot', { projectId: 9, viewport: 'mobile' }, d))
      .toMatchObject({ ok: true, target: 'container', imageDataUrl: 'data:image/jpeg;base64,AAA' });
    expect(d.captureWebScreenshot).toHaveBeenCalledWith(developer.env, LIVE.url, { viewport: 'mobile' });
    const off = deps({ captureWebScreenshot: vi.fn(async () => { throw new ScreenshotUnavailableError('unconfigured', 'not set up'); }) });
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_screenshot', { projectId: 9 }, off))
      .toMatchObject({ ok: false, code: 'unconfigured', reason: 'not set up' });
  });

  it('reads the dev-server tail without minting, secrets redacted', async () => {
    const d = deps();
    const out = await runContainerRuntimeTool(developer, 'runtime.preview_logs', { projectId: 9, lines: 20 }, d);
    expect(d.previewControl).toHaveBeenCalledWith(developer.env, 41, '/sandbox/preview/logs', { lines: 20 });
    expect(d.mintPreviewForExecution).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, lines: ['booting with «redacted»', 'ready'] });
  });

  it('restarts the dev server through the container', async () => {
    const d = deps();
    expect(await runContainerRuntimeTool(developer, 'runtime.preview_restart', { projectId: 9 }, d)).toMatchObject({ ok: true, restarted: true });
    expect(d.previewControl).toHaveBeenCalledWith(developer.env, 41, '/sandbox/preview/restart');
  });

  it('runs each declared verify command once, output redacted', async () => {
    const d = deps({ runInSandbox: vi.fn(async () => ({ ok: true, exitCode: 2, stdout: `error TS2322 near ${SECRET}` })) });
    const out = await runContainerRuntimeTool(developer, 'runtime.run_verify', { projectId: 9, executionId: 41 }, d);
    expect(d.runInSandbox).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: false, results: [{ command: 'npx tsc --noEmit', ok: false, exitCode: 2, output: 'error TS2322 near «redacted»' }] });
  });
});

describe('runWithinBudget', () => {
  it('hands each command the time left and skips what the budget cannot cover', async () => {
    let clock = 0;
    const run = vi.fn(async (_command: string, timeoutMs: number) => { clock += 60_000; return timeoutMs; });
    const out = await runWithinBudget(['a', 'b', 'c'], run, 90_000, () => clock);
    expect(out).toEqual([{ command: 'a', result: 90_000 }, { command: 'b', result: 30_000 }, { command: 'c', skipped: true }]);
  });
});
