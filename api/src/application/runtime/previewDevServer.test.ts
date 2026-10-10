import { describe, it, expect, vi, beforeEach } from 'vitest';

const hasFeature = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../tenant/featureEntitlements', () => ({ tenantHasFeature: hasFeature }));

import {
  buildPreviewDevServerStep,
  capacityMessage,
  previewStepForRun,
  PREVIEW_PORT,
  PREVIEW_PUBLIC_ORIGIN,
} from './previewDevServer';
import { PREVIEW_TENANT_CONCURRENCY_CAP } from './previewSessions';
import type { Env } from '../../env';

/**
 * The roadmap item this closes was explicit that the dev-server host tuning must be
 * SHIPPED, not described in a comment — a Vite server behind a public origin 403s on the
 * Host header and its HMR client dials a port the phone cannot reach. These tests are
 * what keep that true: they assert the emitted config, not the prose around it.
 */
describe('buildPreviewDevServerStep', () => {
  const step = buildPreviewDevServerStep();

  it('binds the port the container passthrough proxies to', () => {
    expect(step.port).toBe(PREVIEW_PORT);
    expect(step.env.PREVIEW_PORT).toBe(String(PREVIEW_PORT));
    expect(step.env.HOST).toBe('0.0.0.0');
  });

  it('emits a Vite config that accepts the public origin and points HMR back through it', () => {
    const vite = step.files.find((f) => f.path.endsWith('.mjs'));
    expect(vite).toBeTruthy();
    expect(vite!.contents).toContain('allowedHosts');
    expect(vite!.contents).toContain('preview.builderforce.ai');
    // The three HMR facts that make a phone reconnect: TLS, the PUBLIC host, port 443.
    expect(vite!.contents).toContain("protocol: 'wss'");
    expect(vite!.contents).toContain('clientPort: 443');
    // strictPort, or a port collision silently serves nothing through the passthrough.
    expect(vite!.contents).toContain('strictPort: true');
    // Merged over the project's own config — never a replacement.
    expect(vite!.contents).toContain('mergeConfig');
  });

  it('tells Metro/Expo the packager host so bundle URLs resolve from a phone', () => {
    expect(step.env.REACT_NATIVE_PACKAGER_HOSTNAME).toBe('preview.builderforce.ai');
    expect(step.env.EXPO_PACKAGER_PROXY_URL).toBe(PREVIEW_PUBLIC_ORIGIN);
    expect(step.files.some((f) => f.path.startsWith('metro.config'))).toBe(true);
  });

  it('always has a start candidate, and puts Wrangler ahead of the generic dev script', () => {
    expect(step.candidates.length).toBeGreaterThan(1);
    // Wrangler is first (for Cloudflare Workers), then Expo, then Vite/Next, then fallback
    expect(step.candidates[0]?.when).toContain('wrangler.toml');
    // The last candidate must match unconditionally, or a project with no marker file
    // would produce no command at all.
    expect(step.candidates[step.candidates.length - 1]?.when).toBeUndefined();
  });

  it('includes an install command to run before starting the dev server', () => {
    expect(step.installCommand).toBeTruthy();
    expect(step.installCommand).toContain('npm install');
  });

  it('includes Wrangler as a start candidate for Cloudflare Workers', () => {
    const wranglerCandidate = step.candidates.find((c) => [c.when ?? []].flat().includes('wrangler.toml'));
    expect(wranglerCandidate).toBeTruthy();
    expect(wranglerCandidate?.command).toContain('wrangler');
  });

  it('keys every framework off the PROJECT config, never a file the step generates', () => {
    // The generated overrides exist in EVERY workspace; a marker on one of them selected
    // that framework for every project (a Next app with a `dev` script started Vite).
    const generated = new Set(step.files.map((f) => f.path));
    for (const c of step.candidates) {
      for (const marker of [c.when ?? []].flat()) expect(generated.has(marker)).toBe(false);
    }
    const vite = step.candidates.find((c) => c.command.includes('npx vite'));
    expect([vite?.when ?? []].flat()).toEqual(expect.arrayContaining(['vite.config.ts', 'vite.config.js']));
    const next = step.candidates.find((c) => c.command.includes('next dev'));
    expect([next?.when ?? []].flat()).toEqual(expect.arrayContaining(['next.config.mjs', 'next.config.ts']));
  });

  it('starts bare React Native through the generated Metro override', () => {
    const metro = step.files.find((f) => f.path.startsWith('metro.config'))!;
    expect(step.candidates.some((c) => c.command.includes(`--config ${metro.path}`))).toBe(true);
  });

  it("loads the project's Vite config through Vite's own loader (TypeScript configs included)", () => {
    const vite = step.files.find((f) => f.path.endsWith('.mjs'))!;
    expect(vite.contents).toContain('loadConfigFromFile');
  });
});

describe('previewStepForRun', () => {
  const container = {} as Env['AGENT_CONTAINER'];
  beforeEach(() => { hasFeature.mockReset(); hasFeature.mockResolvedValue(true); });

  it('is inert until the flag AND the container binding are both present', async () => {
    // Mock db and secrets - should return null when feature is off
    const mockDb = {} as any;
    expect(await previewStepForRun({ AGENT_CONTAINER: container } as Env, mockDb, 1, 1)).toBeNull();
    expect(await previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'true' } as Env, mockDb, 1, 1)).toBeNull();
    expect(await previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'false', AGENT_CONTAINER: container } as Env, mockDb, 1, 1)).toBeNull();
  });

  it('produces the step once the operator turns it on', async () => {
    // Mock db that returns empty secrets
    const mockDb = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as any;
    const step = await previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'true', AGENT_CONTAINER: container } as Env, mockDb, 1, 1);
    expect(step?.port).toBe(PREVIEW_PORT);
  });

  it('gives a tenant whose plan lacks livePreview no step, so its run never starts a dev server', async () => {
    hasFeature.mockResolvedValue(false);
    const step = await previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'true', AGENT_CONTAINER: container } as Env, {} as any, 1, 1);
    expect(step).toBeNull();
    expect(hasFeature).toHaveBeenCalledWith(expect.anything(), 1, null, 'livePreview');
  });

  it('builds a step without secrets for a run that has no project', async () => {
    const step = await previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'true', AGENT_CONTAINER: container } as Env, {} as any, 1, null);
    expect(step?.port).toBe(PREVIEW_PORT);
  });
});

describe('capacityMessage', () => {
  it('tells a tenant at its own cap what to do, and never blames them for the global one', () => {
    const mine = capacityMessage({ ok: false, reason: 'tenant_cap', limit: PREVIEW_TENANT_CONCURRENCY_CAP });
    expect(mine).toContain(String(PREVIEW_TENANT_CONCURRENCY_CAP));
    expect(capacityMessage({ ok: false, reason: 'global_budget', limit: 15 })).not.toContain('workspace');
  });
});
