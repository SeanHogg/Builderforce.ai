/** D1 on the image surfaces: the `llm` op's cascade around the container's post-edit verdict. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';

const h = vi.hoisted(() => ({
  saved: undefined as unknown,
  load: vi.fn(async () => h.saved),
  save: vi.fn(async (_env: unknown, _id: number, state: unknown) => { h.saved = state; }),
  record: vi.fn(async () => undefined),
}));
vi.mock('./containerRunModelStore', () => ({ loadContainerRunCascade: h.load, saveContainerRunCascade: h.save }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../../llm/difficultyGate', () => ({
  shouldSkipWeakAttempt: vi.fn(async () => false), recordCascadeOutcome: vi.fn(async () => undefined), weakPassRate: vi.fn(async () => undefined),
}));

import { ImageCascade, imageTurnFeatures, readImageCheckVerdict } from './imageCascade';
import type { CloudRunModelState } from './cloudRunModelPolicy';

const ON = { COST_LEVER_D1_VERIFIER_CASCADE: 'on' } as never;
const OFF = { COST_LEVERS_ALL: 'off' } as never;
const ladder = { candidates: ['strong', 'weak', 'mid'], rankOf: (m: string) => ({ weak: 0, mid: 1, strong: 2 } as Record<string, number>)[m] ?? 1 };
const features = { actionType: 'bugfix', role: 'code', promptTokens: 100, toolCount: 5, turnIndex: 0 };
const run = (env: never) => ({ env, db: {} as never, tenantId: 3, executionId: 9, cloudAgentRef: 'a1', role: 'code', ladder, features });
/** The cascade decides softness from the PICK (`strict`), so one starting state serves both. */
const soft = (): CloudRunModelState => ({ policy: initialRunPolicy({ pinnedModel: 'strong', startPhase: 'code' }), stallRecoveries: 0 });

beforeEach(() => {
  h.saved = undefined;
  h.load.mockClear(); h.save.mockClear(); h.record.mockClear();
});

describe('readImageCheckVerdict', () => {
  it('tells "no verifier" from "nothing judged" from a verdict', () => {
    expect(readImageCheckVerdict(undefined)).toBeUndefined();
    expect(readImageCheckVerdict(null)).toBeNull();
    expect(readImageCheckVerdict({ verifier: 'x' })).toBeNull();
    expect(readImageCheckVerdict({ passed: false, verifier: 'post_edit_checks', reason: 'tsc exit 2' }))
      .toEqual({ passed: false, verifier: 'post_edit_checks', reason: 'tsc exit 2' });
  });
});

describe('imageTurnFeatures', () => {
  it('counts the assistant turns so far and the advertised tools', () => {
    const f = imageTurnFeatures({ taskTitle: 'Fix the login bug', taskDescription: null }, [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }], [], 'code');
    expect(f).toMatchObject({ role: 'code', toolCount: 0, turnIndex: 1 });
    expect(typeof f.actionType).toBe('string');
  });
});

describe('ImageCascade', () => {
  it('is off with the lever off, and for an image with no verifier', async () => {
    expect(await ImageCascade.open(run(OFF), null)).toBeNull();
    expect(await ImageCascade.open(run(ON), undefined)).toBeNull();
    expect(h.load).not.toHaveBeenCalled();
  });

  it('starts a soft seed weak, escalates one tier on a failed check, and persists across ops', async () => {
    const first = (await ImageCascade.open(run(ON), null))!;
    const seeded = await first.seed(soft(), false);
    expect(seeded.policy.model).toBe('weak');
    await first.end('weak');
    expect(h.save).toHaveBeenCalledWith(ON, 9, expect.objectContaining({ resolvedModel: 'weak' }));

    const second = (await ImageCascade.open(run(ON), { passed: false, verifier: 'post_edit_checks', reason: 'tsc exit 2' }))!;
    const escalated = await second.fold(seeded);
    expect(escalated.policy.model).toBe('mid');
    expect(second.steerNote()).not.toBe('');
    expect(h.record).toHaveBeenCalledWith({}, expect.objectContaining({ toolName: 'model.escalated' }));
  });

  it('leaves a strict pin alone', async () => {
    const c = (await ImageCascade.open(run(ON), null))!;
    const pinned: CloudRunModelState = { policy: initialRunPolicy({ pinnedModel: 'strong', startPhase: 'code' }), stallRecoveries: 0 };
    expect((await c.seed(pinned, true)).policy.model).toBe('strong');
  });
});
