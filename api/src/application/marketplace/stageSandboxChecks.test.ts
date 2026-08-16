import { describe, expect, it } from 'vitest';
import { STAGE_SANDBOX_LIMIT_CODE } from '@builderforce/creation-canvas-contract';
import { sandboxChecks, type StageSandboxState } from './stageSandboxChecks';

function state(overrides: Partial<StageSandboxState>): StageSandboxState {
  return {
    status: 'missing', runId: null, findings: [], summary: null, errorMessage: null, lastVerifiedAt: null,
    ...overrides,
  };
}

describe('sandboxChecks — the publish-gate severity table', () => {
  it('null state (harness not sandbox-applicable) reads as the standing warn', () => {
    const [check] = sandboxChecks('paged', null);
    expect(check?.code).toBe(STAGE_SANDBOX_LIMIT_CODE);
    expect(check?.severity).toBe('warn');
  });

  it('wording is reworded per harness while the code stays fixed', () => {
    const paged = sandboxChecks('paged', null)[0];
    const system = sandboxChecks('system', null)[0];
    expect(paged?.code).toBe(system?.code);
    expect(paged?.detail).not.toBe(system?.detail);
  });

  it('missing → block', () => {
    const [check] = sandboxChecks('runtime', state({ status: 'missing' }));
    expect(check?.code).toBe('sandbox.missing');
    expect(check?.severity).toBe('block');
  });

  it('missing with a prior verified version mentions it in the detail, never the severity', () => {
    const [check] = sandboxChecks('runtime', state({ status: 'missing', lastVerifiedAt: '2026-08-01T00:00:00Z' }));
    expect(check?.severity).toBe('block');
    expect(check?.detail).toContain('2026-08-01T00:00:00Z');
  });

  it('queued and running → block', () => {
    for (const status of ['queued', 'running'] as const) {
      const [check] = sandboxChecks('runtime', state({ status }));
      expect(check?.code).toBe('sandbox.pending');
      expect(check?.severity).toBe('block');
    }
  });

  it('passed → the container\'s own findings, prefixed with a verified pass', () => {
    const checks = sandboxChecks('runtime', state({
      status: 'passed',
      summary: 'All good',
      findings: [{ code: 'runtime.touch', group: 'runs', severity: 'pass', label: 'Responds to touch' }],
    }));
    expect(checks.map((c) => c.code)).toEqual(['sandbox.verified', 'runtime.touch']);
    expect(checks[0]?.severity).toBe('pass');
  });

  it('failed → exactly the container\'s own findings, at their own severities', () => {
    const checks = sandboxChecks('runtime', state({
      status: 'failed',
      findings: [{ code: 'runtime.crash', group: 'runs', severity: 'block', label: 'Threw' }],
    }));
    expect(checks).toEqual([{ code: 'runtime.crash', group: 'runs', severity: 'block', label: 'Threw' }]);
  });

  it('failed with no findings still surfaces SOMETHING, at block', () => {
    const [check] = sandboxChecks('runtime', state({ status: 'failed', summary: 'It broke' }));
    expect(check?.severity).toBe('block');
    expect(check?.label).toBe('It broke');
  });

  it('error → fails OPEN (warn, never block)', () => {
    const [check] = sandboxChecks('runtime', state({ status: 'error', errorMessage: 'timed out' }));
    expect(check?.code).toBe('sandbox.unavailable');
    expect(check?.severity).toBe('warn');
  });

  it('capped → fails OPEN (warn, never block) — the locked product decision', () => {
    const [check] = sandboxChecks('runtime', state({ status: 'capped' }));
    expect(check?.code).toBe('sandbox.capped');
    expect(check?.severity).toBe('warn');
  });
});
