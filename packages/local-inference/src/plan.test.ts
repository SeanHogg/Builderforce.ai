import { describe, expect, it, vi } from 'vitest';
import { residencyOf, type CatalogView } from '@builderforce/model-catalog';
import {
  LocalFirstUnavailableError,
  localCatalogView,
  localFirstPlan,
  runLocalFirst,
  type LocalFirstAttempt,
  type LocalFirstAttemptRecord,
  type LocalRuntimeProbe,
} from './index.js';

/**
 * Local first, failover to cloud. The plan decides WHO may try (a tool turn never goes
 * to a model that cannot call tools); the runner decides WHEN trying again is safe (only
 * before the user saw output, and never after a Stop).
 */

const SYNAPSE: LocalRuntimeProbe = {
  provider: 'synapse',
  endpoint: { baseUrl: 'http://127.0.0.1:11435', token: 'k' },
  reachable: true,
  models: [{ ref: 'local/synapse/qwen3-8b', provider: 'synapse', model: 'qwen3-8b', tools: true }],
};
const OLLAMA: LocalRuntimeProbe = {
  provider: 'ollama',
  endpoint: { baseUrl: 'http://127.0.0.1:11434' },
  reachable: true,
  models: [
    { ref: 'local/ollama/gemma:2b', provider: 'ollama', model: 'gemma:2b' },
    { ref: 'local/ollama/qwen3:8b', provider: 'ollama', model: 'qwen3:8b', tools: true, contextTokens: 8_000 },
  ],
};
const BROWSER: LocalRuntimeProbe = {
  provider: 'browser',
  endpoint: { baseUrl: 'http://browser.local' },
  reachable: true,
  models: [{ ref: 'local/browser/gemini-nano', provider: 'browser', model: 'gemini-nano', tools: false, contextTokens: 6_000 }],
};
const CHAT = { agentic: false, inputTokens: 1_000, outputTokens: 800 };
const TOOL_TURN = { agentic: true, inputTokens: 1_000, outputTokens: 800 };

const refs = (plan: LocalFirstAttempt[]): string[] => plan.map((a) => (a.kind === 'local' ? a.ref : `cloud:${a.model ?? 'auto'}`));

describe('localFirstPlan', () => {
  it('tries one capable local model, Synapse first, then the cloud', () => {
    expect(refs(localFirstPlan({ probes: [OLLAMA, SYNAPSE], workload: CHAT, cloud: {} }))).toEqual([
      'local/synapse/qwen3-8b',
      'cloud:auto',
    ]);
    expect(
      refs(localFirstPlan({ probes: [OLLAMA, SYNAPSE], workload: CHAT, cloud: { model: 'x' }, maxLocalAttempts: 3 })),
    ).toEqual(['local/synapse/qwen3-8b', 'local/ollama/gemma:2b', 'local/ollama/qwen3:8b', 'cloud:x']);
  });

  it('never hands a tool turn to a model whose tool support is unknown', () => {
    expect(refs(localFirstPlan({ probes: [OLLAMA], workload: TOOL_TURN, cloud: {}, maxLocalAttempts: 5 }))).toEqual([
      'local/ollama/qwen3:8b',
      'cloud:auto',
    ]);
  });

  it('skips a model whose reported window cannot hold the call', () => {
    const big = { agentic: true, inputTokens: 7_500, outputTokens: 800 };
    expect(refs(localFirstPlan({ probes: [OLLAMA], workload: big, cloud: {} }))).toEqual(['cloud:auto']);
  });

  it('honours a preferred local ref when it is capable', () => {
    expect(
      refs(localFirstPlan({ probes: [SYNAPSE, OLLAMA], workload: CHAT, cloud: {}, preferred: 'local/ollama/qwen3:8b' })),
    ).toEqual(['local/ollama/qwen3:8b', 'cloud:auto']);
  });

  it("takes the browser's built-in model for a chat turn, after the installed runtimes", () => {
    expect(refs(localFirstPlan({ probes: [BROWSER], workload: CHAT, cloud: {} }))).toEqual([
      'local/browser/gemini-nano',
      'cloud:auto',
    ]);
    expect(refs(localFirstPlan({ probes: [BROWSER, OLLAMA], workload: CHAT, cloud: {} }))).toEqual([
      'local/ollama/gemma:2b',
      'cloud:auto',
    ]);
  });

  it("never hands the browser's built-in model a tool turn or an oversized one", () => {
    expect(refs(localFirstPlan({ probes: [BROWSER], workload: TOOL_TURN, cloud: {} }))).toEqual(['cloud:auto']);
    const long = { agentic: false, inputTokens: 5_800, outputTokens: 800 };
    expect(refs(localFirstPlan({ probes: [BROWSER], workload: long, cloud: {} }))).toEqual(['cloud:auto']);
  });

  it('ignores unreachable and hosted runtimes, and plans local-only without a cloud', () => {
    const down = { ...SYNAPSE, reachable: false };
    const kimi: LocalRuntimeProbe = {
      provider: 'kimi-code',
      endpoint: { baseUrl: 'https://api.kimi.com/coding/v1' },
      reachable: true,
      models: [{ ref: 'local/kimi-code/k3', provider: 'kimi-code', model: 'k3', tools: true }],
    };
    expect(refs(localFirstPlan({ probes: [down, kimi, OLLAMA], workload: CHAT, cloud: null }))).toEqual([
      'local/ollama/gemma:2b',
    ]);
    expect(localFirstPlan({ probes: [down, kimi], workload: CHAT, cloud: null })).toEqual([]);
  });
});

describe('localCatalogView', () => {
  const base: CatalogView = {
    vendorOf: (m) => (m === 'sonnet' ? 'anthropic' : 'kimi'),
    tierOf: (m) => (m === 'sonnet' ? 'PREMIUM' : undefined),
    priceOf: (m) => (m === 'sonnet' ? { input: 3e-6, output: 15e-6 } : undefined),
  };
  const view = localCatalogView(base);

  it('makes an on-device ref local, free and its own vendor', () => {
    expect(residencyOf(view, 'local/synapse/qwen3-8b')).toBe('local');
    expect(view.tierOf('local/ollama/qwen3:8b')).toBe('FREE');
    expect(view.vendorOf('local/ollama/qwen3:8b')).toBe('local/ollama');
    expect(view.priceOf?.('local/ollama/qwen3:8b')).toBeUndefined();
  });

  it('leaves cloud models and the hosted Kimi runtime to the base view', () => {
    expect(residencyOf(view, 'sonnet')).toBe('cloud');
    expect(view.tierOf('sonnet')).toBe('PREMIUM');
    expect(residencyOf(view, 'local/kimi-code/k3')).toBe('cloud');
    expect(view.vendorOf('local/kimi-code/k3')).toBe('kimi');
  });
});

describe('runLocalFirst', () => {
  const plan = localFirstPlan({ probes: [SYNAPSE], workload: CHAT, cloud: {} });

  it('serves from local when it answers', async () => {
    const run = vi.fn(async (a: LocalFirstAttempt) => a.kind);
    const out = await runLocalFirst(plan, run);
    expect(out.result).toBe('local');
    expect(out.attempts.map((r) => r.outcome)).toEqual(['served']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fails over to the cloud when local fails before any output, and records both', async () => {
    const seen: LocalFirstAttemptRecord[] = [];
    const out = await runLocalFirst(
      plan,
      async (a) => {
        if (a.kind === 'local') throw new Error('local_unreachable');
        return 'cloud-answer';
      },
      { onAttempt: (r) => seen.push(r) },
    );
    expect(out.result).toBe('cloud-answer');
    expect(out.served.kind).toBe('cloud');
    expect(seen.map((r) => [r.attempt.kind, r.outcome, r.detail])).toEqual([
      ['local', 'failed', 'local_unreachable'],
      ['cloud', 'served', undefined],
    ]);
  });

  it('fails over on an empty answer (a refusal), but accepts it from the last attempt', async () => {
    const out = await runLocalFirst(plan, async (a) => (a.kind === 'local' ? '' : ''), { accept: (r) => r.length > 0 });
    expect(out.attempts.map((r) => r.outcome)).toEqual(['refused', 'served']);
  });

  it('never fails over once output reached the user', async () => {
    const run = vi.fn(async (_a: LocalFirstAttempt, commit: () => void) => {
      commit();
      throw new Error('stream_cut');
    });
    await expect(runLocalFirst(plan, run)).rejects.toThrow('stream_cut');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never fails over a Stop', async () => {
    const abort = new AbortController();
    const run = vi.fn(async () => {
      abort.abort();
      throw new Error('aborted');
    });
    await expect(runLocalFirst(plan, run, { signal: abort.signal })).rejects.toThrow('aborted');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rethrows the LAST attempt's own error, unwrapped, so the host's error mapping still applies", async () => {
    const planLimit = Object.assign(new Error('plan_limit'), { status: 402 });
    await expect(
      runLocalFirst(plan, async (a) => {
        throw a.kind === 'local' ? new Error('local_down') : planLimit;
      }),
    ).rejects.toBe(planLimit);
  });

  it('refuses an empty plan with a typed error', async () => {
    await expect(runLocalFirst([], async () => 'x')).rejects.toBeInstanceOf(LocalFirstUnavailableError);
  });
});
