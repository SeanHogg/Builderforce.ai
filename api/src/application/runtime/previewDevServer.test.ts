import { describe, it, expect } from 'vitest';
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

  it('always has a start candidate, and puts Expo ahead of the generic dev script', () => {
    expect(step.candidates.length).toBeGreaterThan(1);
    expect(step.candidates[0]?.when).toBe('app.json');
    // The last candidate must match unconditionally, or a project with no marker file
    // would produce no command at all.
    expect(step.candidates[step.candidates.length - 1]?.when).toBeUndefined();
  });
});

describe('previewStepForRun', () => {
  const container = {} as Env['AGENT_CONTAINER'];

  it('is inert until the flag AND the container binding are both present', () => {
    expect(previewStepForRun({ AGENT_CONTAINER: container } as Env)).toBeNull();
    expect(previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'true' } as Env)).toBeNull();
    expect(previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'false', AGENT_CONTAINER: container } as Env)).toBeNull();
  });

  it('produces the step once the operator turns it on', () => {
    const step = previewStepForRun({ PREVIEW_INGRESS_ENABLED: 'true', AGENT_CONTAINER: container } as Env);
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
