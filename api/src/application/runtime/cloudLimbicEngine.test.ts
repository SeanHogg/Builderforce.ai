import { describe, it, expect } from 'vitest';
import {
  resolveAgentEngine,
  initialCloudLimbicState,
  evolveCloudLimbicState,
  CloudLimbicEngine,
  CloudToolLoopEngine,
  type CloudEngineContext,
} from './cloudAgentEngine';
import { buildLimbicBlock, neutralState } from '@builderforce/agent-tools';
import { loadPersonaSetpoints } from '../artifact/capabilityContext';

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

describe('initial affect (V3, via the per-step seam — not baked into the prompt)', () => {
  it('a risky task starts in a caution-raised state', () => {
    const s = initialCloudLimbicState({ title: 'Delete the production database', description: 'wipe all rows' });
    const block = buildLimbicBlock(s);
    expect(block).toMatch(/affective state/i);
    expect(block.toLowerCase()).toContain('caution');
  });

  it('a mundane task starts at rest (empty directive → nothing injected)', () => {
    const s = initialCloudLimbicState({ title: 'Update the README heading', description: 'fix a typo' });
    expect(buildLimbicBlock(s)).toBe('');
  });

  it('personality setpoints shift the resting affect (cautious persona)', () => {
    const cautious = { valence: 0, arousal: 0.3, driveCuriosity: 0.5, driveCaution: 0.95, driveEffort: 0.8, driveSocial: 0.5, attention: 0.7, exploration: 0.3 };
    const s = initialCloudLimbicState({ title: 'Deploy the change', description: '' }, cautious);
    expect(buildLimbicBlock(s).toLowerCase()).toContain('caution');
  });

  it('CloudLimbicEngine composes V2 (same id contract as the registry)', () => {
    expect(new CloudLimbicEngine(rc).id).toBe('builderforce-v3');
  });
});

describe('cross-tick affect evolution (the seam enables it)', () => {
  it('a failed tick drives affect negative; a successful tick recovers it', () => {
    const setpoints = neutralState();
    const start = neutralState();
    const afterError = evolveCloudLimbicState(start, setpoints, { ok: false, finished: false, cancelled: false });
    expect(afterError.valence).toBeLessThan(start.valence);
    expect(afterError.driveCaution).toBeGreaterThan(start.driveCaution);

    const afterSuccess = evolveCloudLimbicState(afterError, setpoints, { ok: true, finished: true, cancelled: false });
    expect(afterSuccess.valence).toBeGreaterThan(afterError.valence);
  });

  it('relaxes toward setpoints on a quiet (progress) tick', () => {
    const setpoints = neutralState();
    const disturbed = { ...neutralState(), valence: -0.8 };
    const after = evolveCloudLimbicState(disturbed, setpoints, { ok: true, finished: false, cancelled: false });
    expect(Math.abs(after.valence - setpoints.valence)).toBeLessThan(Math.abs(disturbed.valence - setpoints.valence));
  });
});

describe('loadPersonaSetpoints', () => {
  it('returns undefined for no assigned personas (start from neutral)', async () => {
    expect(await loadPersonaSetpoints({} as never, {} as never, [])).toBeUndefined();
  });
});
