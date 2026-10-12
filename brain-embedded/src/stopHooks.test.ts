import { describe, expect, it } from 'vitest';
import { askStopHook, MAX_STOP_HOOK_ROUNDS, type RunStopInput } from './stopHooks';

const input = (round = 0): RunStopInput => ({ codeChanged: true, touchedFiles: ['a.ts'], requestText: 'fix it', round });

describe('askStopHook', () => {
  it('lets the run settle with no hook', async () => {
    expect(await askStopHook(undefined, input())).toBeNull();
  });

  it('returns the trimmed instruction that holds the run', async () => {
    expect(await askStopHook(async () => '  update README  ', input())).toBe('update README');
  });

  it('treats an empty answer as settle', async () => {
    expect(await askStopHook(async () => '   ', input())).toBeNull();
    expect(await askStopHook(async () => null, input())).toBeNull();
  });

  it('stops asking once the per-run bound is spent', async () => {
    let asked = 0;
    const hook = async () => {
      asked += 1;
      return 'again';
    };
    expect(await askStopHook(hook, input(MAX_STOP_HOOK_ROUNDS))).toBeNull();
    expect(asked).toBe(0);
  });

  it('never fails the run when the hook throws', async () => {
    expect(await askStopHook(async () => { throw new Error('boom'); }, input())).toBeNull();
  });
});
