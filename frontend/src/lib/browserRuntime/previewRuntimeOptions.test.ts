import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtimeSecurityApi', () => ({ runtimeSecurityApi: { mintWorkerPolicy: vi.fn(), reportShieldIncident: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ recordedFailure: () => () => undefined }));

const RELAY = 'https://preview.builderforce.ai/__bfwc/relay.html';

async function load(perAppOrigins: boolean) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_PREVIEW_PER_APP_ORIGINS', perAppOrigins ? '' : 'false');
  return import('./previewRuntimeOptions');
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('preview shield options', () => {
  it('flag off: applications share the relay origin under the named opt-out, and no policy is minted', async () => {
    const { previewShieldOptions, prepareApplicationPolicy } = await load(false);
    const template = vi.fn();
    const options = previewShieldOptions(RELAY, () => '42', template);
    expect(options).toMatchObject({ sharedPreviewOrigin: 'unprotected', previewEgress: [] });
    expect('previewOrigin' in options).toBe(false);
    expect(template).not.toHaveBeenCalled();
    expect(options.cspReportUrl).toMatch(/^https:\/\/.+\/api\/runtime\/csp-report$/);
    const keyOf = vi.fn(() => 'k');
    await prepareApplicationPolicy('42', 'app:42:0123456789abcdef', '42', keyOf);
    expect(keyOf).not.toHaveBeenCalled();
  });

  it('flag on: each application gets its own origin under the relay host', async () => {
    const { previewShieldOptions } = await load(true);
    const template = vi.fn(() => () => 'origin');
    const options = previewShieldOptions(RELAY, () => '42', template);
    expect(template).toHaveBeenCalledWith('https://{key}-preview.builderforce.ai');
    expect('previewOrigin' in options && 'sharedPreviewOrigin' in options).toBe(false);
    expect(options.workerPolicy('app:42:0123456789abcdef')).toBeUndefined();
    expect(typeof options.security.sink.emit).toBe('function');
  });

  it('reports to the configured https API, and to production from a local http API', async () => {
    const { cspReportUrlFor } = await load(false);
    expect(cspReportUrlFor('https://api-staging.example.com')).toBe('https://api-staging.example.com/api/runtime/csp-report');
    expect(cspReportUrlFor('http://localhost:8787')).toMatch(/^https:\/\/api\.builderforce\.ai\/api\/runtime\/csp-report$/);
  });

  it('keeps the runtime id inside the package alphabet', async () => {
    const { previewRuntimeIdOf } = await load(false);
    expect(previewRuntimeIdOf('42')).toBe('42');
    expect(previewRuntimeIdOf('local:abc')).toBe('workspace');
    expect(previewRuntimeIdOf(undefined)).toBe('workspace');
  });
});
