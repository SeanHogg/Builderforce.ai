import { describe, expect, it } from 'vitest';
import { dryRunSystemSteps } from './systemDryRun';
import { sandboxOutboundPort } from '../workflow/sandboxOutboundPort';
import type { CloudExecutorEnv } from '../workflow/cloudExecutor';

const env = {} as CloudExecutorEnv;

function objects(steps: unknown[]) {
  return [{ canvasData: { steps }, content: null }];
}

describe('dryRunSystemSteps', () => {
  it('returns nothing when there is no recognizable step — the caller falls back to its static declaration', async () => {
    const findings = await dryRunSystemSteps(env, objects([{ kind: 'memory', op: 'recall' }]));
    expect(findings).toEqual([]);
  });

  it('returns nothing when there are no steps at all', async () => {
    expect(await dryRunSystemSteps(env, objects([]))).toEqual([]);
  });

  it('PASSES a workflow whose outbound-capable steps all run stubbed', async () => {
    const findings = await dryRunSystemSteps(env, objects([
      { kind: 'connector', config: { connector: 'twilio', action: 'sms' } },
      { kind: 'transform', config: { expression: '' } },
    ]), sandboxOutboundPort());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'system.outbound', severity: 'pass' });
    expect(findings[0]?.label).toContain('2 outbound-capable step');
  });

  it('BLOCKS when a step genuinely throws during the dry run', async () => {
    // An empty port stubs nothing — an `mcp` step with no tenant context takes
    // its REAL path, which throws. This is what proves the aggregation logic
    // (not just the stub) actually surfaces a thrown step as a real failure.
    const findings = await dryRunSystemSteps(env, objects([
      { kind: 'mcp', config: {} },
    ]), {});
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('block');
    expect(findings[0]?.code).toBe('system.outbound');
    expect(findings[0]?.detail).toContain('mcp');
  });

  it('skips memory/knowledge/train/agent steps rather than reporting a false failure', async () => {
    const findings = await dryRunSystemSteps(env, objects([
      { kind: 'agent', config: {} },
      { kind: 'knowledge', config: {} },
    ]), sandboxOutboundPort());
    // Nothing EXECUTABLE was found — falls back to the static declaration.
    expect(findings).toEqual([]);
  });

  it('reads steps from either content or canvasData, merged', async () => {
    const found = await dryRunSystemSteps(env, [
      { content: { steps: [{ kind: 'gmail', config: {} }] }, canvasData: null },
    ], sandboxOutboundPort());
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('pass');
  });
});
