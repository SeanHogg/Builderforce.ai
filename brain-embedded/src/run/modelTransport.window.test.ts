import { describe, expect, it } from 'vitest';
import type { LocalModel } from '@builderforce/local-inference';
import { brainModelTransport } from './modelTransport';
import { resolveContextWindow } from '../windowFit/modelWindow';
import type { BrainStreamFn } from '../runStore/runTypes';

// `window()` is SYNC, so it can never ask a probe. A declared runtime (Kimi Code) is never
// probed anyway: its window reaches the run only as a row the host already holds. Without it
// every window-sized budget (a `read_file` result's cap among them) fell back to its default.
const KIMI: LocalModel = {
  ref: 'local/kimi-code/kimi-for-coding',
  provider: 'kimi-code',
  model: 'kimi-for-coding',
  label: 'K2.7 Coding',
  contextTokens: 262_144,
};

const unused = (() => {
  throw new Error('window() must not open a turn');
}) as unknown as BrainStreamFn;

function transport(windows?: Parameters<typeof brainModelTransport>[0]['windows']) {
  return brainModelTransport({ turn: { open: () => { throw new Error('unused'); } }, stream: unused, ...(windows ? { windows } : {}) });
}

describe('brainModelTransport window()', () => {
  it("answers a local ref from the rows the host holds (Kimi Code's max_context_size)", () => {
    const t = transport({ models: () => [KIMI] });
    expect(t.window?.('local/kimi-code/kimi-for-coding')).toBe(262_144);
  });

  it('stays unknown for a local ref nobody reported, held rows or not', () => {
    expect(transport({ models: () => [KIMI] }).window?.('local/kimi-code/k9')).toBeUndefined();
    expect(transport().window?.('local/kimi-code/kimi-for-coding')).toBeUndefined();
  });

  it('keeps cloud refs on the cloud source only — the held local rows are never asked', () => {
    let asked = 0;
    const t = transport({ cloud: (ref) => (ref === 'vendor/model-a' ? 200_000 : undefined), models: () => { asked += 1; return [KIMI]; } });
    expect(t.window?.('vendor/model-a')).toBe(200_000);
    expect(t.window?.('vendor/unsized')).toBeUndefined();
    expect(asked).toBe(0);
  });

  it('feeds the async window gate the same held rows when no probe reports the model', async () => {
    await expect(resolveContextWindow('local/kimi-code/kimi-for-coding', { models: () => [KIMI], probes: async () => [] })).resolves.toBe(262_144);
  });
});
