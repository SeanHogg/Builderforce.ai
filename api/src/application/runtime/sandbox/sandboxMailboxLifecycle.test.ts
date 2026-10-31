/**
 * Two ways a runner can be left serving a run that no longer wants it: a request that was
 * aborted or timed out but is still queued (the runner would execute it), and a runner that
 * polls a Durable Object which was evicted and has forgotten the run ended.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn() }));
vi.mock('./sandboxOpenSpec', () => ({ buildSandboxOpenSpec: vi.fn() }));

import { SandboxMailbox } from './sandboxMailbox';
import { RunSandboxHost, type SandboxHostStorage } from './runSandboxHost';

afterEach(() => { vi.useRealTimers(); });

describe('SandboxMailbox: a request that is no longer awaited leaves the queue', () => {
  it('an aborted request is never handed to the runner', async () => {
    const mailbox = new SandboxMailbox();
    const abort = new AbortController();
    const pending = mailbox.request('/sandbox/run', { command: 'pnpm test' }, abort.signal);
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, error: 'cancelled' });
    await expect(mailbox.next(0)).resolves.toEqual({ idle: true });
  });

  it('a request that timed out is never handed to the runner', async () => {
    vi.useFakeTimers();
    const mailbox = new SandboxMailbox();
    const pending = mailbox.request('/sandbox/run', { command: 'pnpm test' });
    await vi.advanceTimersByTimeAsync(13 * 60_000);
    await expect(pending).resolves.toMatchObject({ ok: false, error: expect.stringContaining('did not answer') });
    const poll = mailbox.next(0);
    await vi.advanceTimersByTimeAsync(1);
    await expect(poll).resolves.toEqual({ idle: true });
  });

  it('only the abandoned request leaves: the next one in line is still served', async () => {
    const mailbox = new SandboxMailbox();
    const abort = new AbortController();
    void mailbox.request('/sandbox/run', { command: 'first' }, abort.signal);
    void mailbox.request('/sandbox/run', { command: 'second' });
    abort.abort();
    const poll = await mailbox.next(0);
    expect('request' in poll && poll.request.body).toEqual({ command: 'second' });
  });
});

describe('RunSandboxHost.handleRunnerPoll: a run that is gone', () => {
  const storage = () => {
    const data = new Map<string, unknown>();
    const impl: SandboxHostStorage = {
      get: async <T,>(key: string) => data.get(key) as T | undefined,
      put: async (key, value) => { data.set(key, value); },
    };
    return { data, impl };
  };

  it('tells a runner to stop when the run has no cursor, and does not count it as seen', async () => {
    const s = storage();
    const host = new RunSandboxHost({} as never, {} as never, s.impl);
    await expect(host.handleRunnerPoll(false)).resolves.toEqual({ close: true });
    expect(s.data.has('sandboxRunnerSeen')).toBe(false);
  });

  it('serves a runner of a live run, including one parked on a question (its cursor is kept)', async () => {
    const s = storage();
    const host = new RunSandboxHost({} as never, {} as never, s.impl);
    const mailbox = (host as unknown as { mailbox: SandboxMailbox }).mailbox;
    void mailbox.request('/sandbox/checks', {});
    const poll = await host.handleRunnerPoll(true);
    expect('request' in poll && poll.request.path).toBe('/sandbox/checks');
    expect(s.data.get('sandboxRunnerSeen')).toBe(true);
  });
});
