/**
 * The capacity wait: the pure backoff, and the host's prep tick carrying it across ticks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  open: vi.fn(),
  spec: vi.fn(async () => ({ executionId: 9 })),
  record: vi.fn(async (..._a: unknown[]) => undefined),
}));
vi.mock('./runSandbox', async (orig) => ({ ...(await orig<Record<string, unknown>>()), openRunSandbox: h.open }));
vi.mock('./sandboxOpenSpec', () => ({ buildSandboxOpenSpec: h.spec }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));

import { CAPACITY_WAIT_BASE_MS, CAPACITY_WAIT_CAP_MS, CAPACITY_WAIT_MAX_MS, nextCapacityWait, type SandboxOpenWait } from './sandboxOpenWait';
import { RunSandboxHost } from './runSandboxHost';

const run = { executionId: 9, tenantId: 1, projectId: 2, taskId: 3 };
const env = { AGENT_CONTAINER: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('') }) } } as never;
const FULL = { ok: false, error: 'sandbox open answered 503', capacity: true };
const host = () => new RunSandboxHost(env, {} as never, { get: async () => undefined, put: async () => undefined });

beforeEach(() => vi.clearAllMocks());

describe('nextCapacityWait', () => {
  it('starts at the base delay and doubles up to the cap', () => {
    let wait: SandboxOpenWait | undefined;
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const step = nextCapacityWait(wait, 1_000 + i);
      if (step.exhausted) throw new Error('unexpected');
      wait = step.wait; delays.push(step.delayMs);
    }
    expect(delays).toEqual([CAPACITY_WAIT_BASE_MS, 30_000, 60_000, 120_000, CAPACITY_WAIT_CAP_MS, CAPACITY_WAIT_CAP_MS]);
  });
  it('never schedules a retry past the deadline', () => {
    const step = nextCapacityWait({ since: 0, attempts: 4 }, CAPACITY_WAIT_MAX_MS - 20_000);
    expect(step).toMatchObject({ exhausted: false, delayMs: 20_000 });
  });
  it('is exhausted once the run has waited the maximum', () => {
    expect(nextCapacityWait({ since: 0, attempts: 5 }, CAPACITY_WAIT_MAX_MS - 1).exhausted).toBe(false);
    expect(nextCapacityWait({ since: 0, attempts: 5 }, CAPACITY_WAIT_MAX_MS)).toEqual({ exhausted: true, waitedMs: CAPACITY_WAIT_MAX_MS });
  });
});

describe('RunSandboxHost.prepare under a full pool', () => {
  it('waits, recording a timeline event, and the wait carries across ticks until the container opens', async () => {
    h.open.mockResolvedValueOnce(FULL).mockResolvedValueOnce(FULL).mockResolvedValueOnce({ ok: true });
    const first = await host().prepare(run, 'durable', undefined, 1_000);
    expect(first).toEqual({ wait: { since: 1_000, attempts: 1 }, delayMs: 15_000 });
    expect(h.record.mock.calls[0]![1]).toMatchObject({ toolName: 'runtime.sandbox', result: expect.stringContaining('Waiting for a sandbox') });
    const second = await host().prepare(run, 'durable', (first as { wait: SandboxOpenWait }).wait, 16_000);
    expect(second).toEqual({ wait: { since: 1_000, attempts: 2 }, delayMs: 30_000 });
    expect(await host().prepare(run, 'durable', (second as { wait: SandboxOpenWait }).wait, 50_000)).toEqual({ kind: 'container' });
  });

  it('falls back to no sandbox, saying why, once the wait is exhausted', async () => {
    h.open.mockResolvedValue(FULL);
    const out = await host().prepare(run, 'durable', { since: 0, attempts: 7 }, CAPACITY_WAIT_MAX_MS + 1);
    expect(out).toEqual({ kind: undefined });
    expect(h.record.mock.calls[0]![1]).toMatchObject({ result: expect.stringMatching(/after waiting 10 min.*no shell/) });
  });

  it('keeps today\'s no-shell fallback for a non-capacity failure (no wait)', async () => {
    h.open.mockResolvedValue({ ok: false, error: 'clone failed: auth' });
    expect(await host().prepare(run, 'durable', undefined, 1_000)).toEqual({ kind: undefined });
    expect(h.record.mock.calls[0]![1]).toMatchObject({ result: expect.stringContaining('could not open (clone failed: auth)') });
  });
});
