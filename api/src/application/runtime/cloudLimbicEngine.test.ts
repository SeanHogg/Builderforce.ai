import { describe, it, expect } from 'vitest';
import {
  resolveAgentEngine,
  augmentSystemPromptWithLimbic,
  CloudLimbicEngine,
  CloudToolLoopEngine,
  type CloudEngineContext,
} from './cloudAgentEngine';

// Minimal context — the engine factories only store it; resolveAgentEngine does
// not run the loop, so the env/db are never touched here.
const rc = {
  env: {}, db: {}, executionId: 1,
  taskRow: { id: 1, title: 'Task', description: '' },
  tenantId: 1, projectId: 1, agentLabel: 'Agent', isCancelled: async () => false,
} as unknown as CloudEngineContext;

describe('cloud engine selection (V3 is additive, V2 untouched)', () => {
  it('maps builderforce-v2 → CloudToolLoopEngine', () => {
    const e = resolveAgentEngine(rc, 'builderforce-v2');
    expect(e).toBeInstanceOf(CloudToolLoopEngine);
    expect(e.id).toBe('builderforce-v2');
  });

  it('maps builderforce-v3 → CloudLimbicEngine', () => {
    const e = resolveAgentEngine(rc, 'builderforce-v3');
    expect(e).toBeInstanceOf(CloudLimbicEngine);
    expect(e.id).toBe('builderforce-v3');
  });

  it('falls back to V2 for unknown / legacy / absent ids', () => {
    expect(resolveAgentEngine(rc, 'builderforce-v1').id).toBe('builderforce-v2');
    expect(resolveAgentEngine(rc, 'nonsense').id).toBe('builderforce-v2');
    expect(resolveAgentEngine(rc, undefined).id).toBe('builderforce-v2');
  });
});

describe('augmentSystemPromptWithLimbic', () => {
  const db = {} as never; // recordCloudToolEvent rejects → swallowed by .catch

  it('appends an affective block for a risky task (heightened caution)', async () => {
    const out = await augmentSystemPromptWithLimbic(
      db,
      { tenantId: 1, executionId: 1, taskRow: { id: 1, title: 'Delete the production database', description: 'wipe all rows' } },
      'BASE PROMPT',
    );
    expect(out).toContain('BASE PROMPT');
    expect(out).toMatch(/affective state/i);
    expect(out.toLowerCase()).toContain('caution');
    expect(out.length).toBeGreaterThan('BASE PROMPT'.length);
  });

  it('leaves a neutral task prompt unchanged (state at rest → no block)', async () => {
    const out = await augmentSystemPromptWithLimbic(
      db,
      { tenantId: 1, executionId: 1, taskRow: { id: 2, title: 'Update the README heading', description: 'fix a typo' } },
      'BASE PROMPT',
    );
    expect(out).toBe('BASE PROMPT');
  });

  it('CloudLimbicEngine composes V2 (same id contract as the registry)', () => {
    expect(new CloudLimbicEngine(rc).id).toBe('builderforce-v3');
  });
});
