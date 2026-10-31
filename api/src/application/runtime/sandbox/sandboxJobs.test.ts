/**
 * The Worker's half of the sandbox's background jobs: both transports (the container's HTTP
 * and the Actions runner's mailbox) carry `cwd` on `run`, speak the three `/sandbox/job/*`
 * paths, and map the sandbox's reply through ONE mapping (`sandboxJobsOver`) onto the
 * `ShellCapability` start / poll / kill the shared tools run on. The shell advertises
 * `shell.jobs` only when its sandbox holds jobs.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CapabilityProvider } from '@builderforce/agent-tools';

vi.mock('../cloudAgent/runContext', () => ({ SANDBOX_COMMAND_HEARTBEAT_MS: 60_000 }));

import { createContainerSandbox, SANDBOX_POLL_SLICE_MS, type RunSandbox, type SandboxTarget } from './runSandbox';
import { createMailboxSandbox, SandboxMailbox } from './sandboxMailbox';
import type { SandboxOpenSpec } from './sandboxOpenSpec';
import { SANDBOX_CAPABILITIES, SANDBOX_JOB_CAPABILITIES, sandboxShell, withSandbox } from './sandboxProvider';

const SPEC: SandboxOpenSpec = {
  executionId: 9, internalBaseUrl: 'https://api', token: 't',
  repo: { cloneUrl: 'https://api/clone.git', baseBranch: 'main', headBranch: 'bf/9' },
  toolOutputPolicy: false, postEditChecks: false,
};

type Call = { path: string; body: Record<string, unknown> };
type Server = (path: string, body: Record<string, unknown>) => unknown;

/** A transport under test: the sandbox the engine holds, and every request the sandbox saw. */
interface Harness { sandbox: RunSandbox; calls: Call[]; stop(): void }

/** The container's HTTP transport, answered by `server` (the body without its executionId). */
function containerHarness(server: Server): Harness {
  const calls: Call[] = [];
  const target: SandboxTarget = {
    fetch: async (url, init) => {
      const { executionId: _id, ...body } = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const path = new URL(url).pathname;
      calls.push({ path, body });
      return new Response(JSON.stringify(server(path, body)), { status: 200 });
    },
  };
  return { sandbox: createContainerSandbox({ target, executionId: 9, openSpec: async () => SPEC }), calls, stop: () => undefined };
}

/** The Actions runner's mailbox transport, with a runner loop answering from `server`. */
function mailboxHarness(server: Server): Harness {
  const calls: Call[] = [];
  const mailbox = new SandboxMailbox();
  void (async () => {
    for (;;) {
      const next = await mailbox.next(20);
      if ('close' in next) return;
      if ('request' in next) {
        calls.push({ path: next.request.path, body: next.request.body });
        mailbox.resolve(next.request.id, server(next.request.path, next.request.body));
      }
    }
  })();
  return { sandbox: createMailboxSandbox(mailbox), calls, stop: () => mailbox.close() };
}

const harnesses: Array<[string, (server: Server) => Harness]> = [['container', containerHarness], ['mailbox', mailboxHarness]];

describe.each(harnesses)('the %s transport', (_name, make) => {
  it('carries the working directory on a foreground command, only when one is given', async () => {
    const h = make(() => ({ ok: true, exitCode: 0, output: 'ok' }));
    await h.sandbox.run('npm test', undefined, undefined, 'app');
    await h.sandbox.run('ls');
    h.stop();
    expect(h.calls.map((c) => c.body)).toEqual([{ command: 'npm test', cwd: 'app' }, { command: 'ls' }]);
  });

  it('starts a job with its directory and returns the sandbox\'s id', async () => {
    const h = make(() => ({ ok: true, id: 'job-1' }));
    await expect(h.sandbox.jobs!.start('npm run dev', 'app')).resolves.toEqual({ ok: true, id: 'job-1' });
    await h.sandbox.jobs!.start('make');
    h.stop();
    expect(h.calls).toEqual([
      { path: '/sandbox/job/start', body: { command: 'npm run dev', cwd: 'app' } },
      { path: '/sandbox/job/start', body: { command: 'make' } },
    ]);
  });

  it('a start the sandbox refuses is a failure with its reason', async () => {
    const h = make(() => ({ ok: false, error: "cwd 'x' is not a directory in the repository" }));
    await expect(h.sandbox.jobs!.start('ls', 'x')).resolves.toEqual({ ok: false, error: "cwd 'x' is not a directory in the repository" });
    h.stop();
  });

  it('polls and kills by id, mapping the status the tools read', async () => {
    const done = { ok: true, id: 'job-1', status: 'exited', exitCode: 0, output: 'built' };
    const h = make((path) => (path === '/sandbox/job/kill' ? { ok: false, id: 'job-1', status: 'killed', output: '', error: 'stopped' } : done));
    await expect(h.sandbox.jobs!.poll('job-1', { waitMs: 500 })).resolves.toEqual(done);
    await expect(h.sandbox.jobs!.kill('job-1')).resolves.toEqual({ ok: false, id: 'job-1', status: 'killed', output: '', error: 'stopped' });
    h.stop();
    expect(h.calls.map((c) => [c.path, c.body])).toEqual([
      ['/sandbox/job/poll', { id: 'job-1', waitMs: 500 }],
      ['/sandbox/job/kill', { id: 'job-1' }],
    ]);
  });

  it('an id the sandbox does not hold is `unknown`, and a reply with no status is never guessed at', async () => {
    const h = make((path) => (path === '/sandbox/job/poll' ? { ok: false, id: 'job-7', status: 'unknown', error: 'no such job' } : { ok: false, error: 'boom' }));
    await expect(h.sandbox.jobs!.poll('job-7')).resolves.toMatchObject({ ok: false, id: 'job-7', status: 'unknown' });
    await expect(h.sandbox.jobs!.kill('job-7')).resolves.toEqual({ ok: false, id: 'job-7', status: 'unknown', error: 'boom' });
    h.stop();
  });

  it('asks a long wait in slices, so no single request holds the sandbox for the whole wait', async () => {
    let n = 0;
    const h = make(() => ({ ok: true, id: 'job-1', status: ++n < 3 ? 'running' : 'exited', exitCode: 0, output: '' }));
    const st = await h.sandbox.jobs!.poll('job-1', { waitMs: 2.5 * SANDBOX_POLL_SLICE_MS });
    h.stop();
    expect(st.status).toBe('exited');
    const waits = h.calls.map((c) => c.body.waitMs as number);
    expect(waits).toHaveLength(3);
    expect(waits[0]).toBe(SANDBOX_POLL_SLICE_MS);
    expect(waits[1]).toBe(SANDBOX_POLL_SLICE_MS);
    expect(waits[2]).toBe(0.5 * SANDBOX_POLL_SLICE_MS);
  });

  it('a wait that is still running when its time is up answers running, not another round', async () => {
    const h = make(() => ({ ok: true, id: 'job-1', status: 'running', output: 'tick' }));
    await expect(h.sandbox.jobs!.poll('job-1', { waitMs: 1_000 })).resolves.toMatchObject({ status: 'running', output: 'tick' });
    h.stop();
    expect(h.calls).toHaveLength(1);
  });

  it('an aborted wait answers with the job as it stands, and the job runs on', async () => {
    const abort = new AbortController();
    const h = make((_path, body) => {
      if (body.waitMs === 0) return { ok: true, id: 'job-1', status: 'running', output: 'so far' };
      abort.abort();
      return { ok: false, error: 'cancelled' };
    });
    const st = await h.sandbox.jobs!.poll('job-1', { waitMs: 60_000, signal: abort.signal });
    h.stop();
    expect(st).toMatchObject({ ok: true, status: 'running', output: 'so far' });
    expect(h.calls.map((c) => c.body.waitMs)).toEqual([SANDBOX_POLL_SLICE_MS, 0]);
    expect(h.calls.some((c) => c.path === '/sandbox/job/kill')).toBe(false);
  });
});

describe('the container transport and a recycled instance', () => {
  function recycled() {
    const paths: string[] = [];
    const target: SandboxTarget = {
      fetch: async (url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path === '/sandbox/open') return new Response(JSON.stringify({ ok: true }), { status: 200 });
        return paths.filter((p) => p === path).length === 1
          ? new Response(JSON.stringify({ ok: false, error: 'not_open' }), { status: 409 })
          : new Response(JSON.stringify({ ok: true, id: 'job-1' }), { status: 200 });
      },
    };
    return { sandbox: createContainerSandbox({ target, executionId: 9, openSpec: async () => SPEC }), paths };
  }

  it('a start re-opens the clone once and goes again', async () => {
    const { sandbox, paths } = recycled();
    await expect(sandbox.jobs!.start('npm run dev')).resolves.toEqual({ ok: true, id: 'job-1' });
    expect(paths).toEqual(['/sandbox/job/start', '/sandbox/open', '/sandbox/job/start']);
  });

  it('a poll or kill there does not clone a repo to look for a job that is gone: the job is `unknown`', async () => {
    const { sandbox, paths } = recycled();
    await expect(sandbox.jobs!.poll('job-1')).resolves.toMatchObject({ ok: false, id: 'job-1', status: 'unknown', error: expect.stringContaining('recycled') });
    await expect(sandbox.jobs!.kill('job-1')).resolves.toMatchObject({ status: 'unknown' });
    expect(paths).toEqual(['/sandbox/job/poll', '/sandbox/job/kill']);
  });
});

describe('the sandbox shell and background jobs', () => {
  const jobs = {
    start: vi.fn(async () => ({ ok: true, id: 'job-1' })),
    poll: vi.fn(async (id: string) => ({ ok: true, id, status: 'running' as const })),
    kill: vi.fn(async (id: string) => ({ ok: false, id, status: 'killed' as const })),
  };
  const withJobs = { run: vi.fn(), jobs } as unknown as RunSandbox;
  const withoutJobs = { run: vi.fn() } as unknown as RunSandbox;
  const base = { capabilities: new Set(['repo.read']) } as unknown as CapabilityProvider;
  const heartbeat = async () => undefined;

  it('advertises `shell.jobs` beside `shell` when the sandbox holds jobs, and not otherwise', () => {
    expect([...SANDBOX_JOB_CAPABILITIES]).toEqual(['shell.jobs']);
    expect([...SANDBOX_CAPABILITIES]).toEqual(['shell']);
    const jobbed = withSandbox(base, withJobs, { heartbeat });
    expect(jobbed.capabilities.has('shell')).toBe(true);
    expect(jobbed.capabilities.has('shell.jobs')).toBe(true);
    const plain = withSandbox(base, withoutJobs, { heartbeat });
    expect(plain.capabilities.has('shell')).toBe(true);
    expect(plain.capabilities.has('shell.jobs')).toBe(false);
  });

  it('a sandbox without jobs leaves start / poll / kill off the shell, so the tools fall back to the foreground', () => {
    const shell = sandboxShell(withoutJobs, { heartbeat });
    expect(shell.start).toBeUndefined();
    expect(shell.poll).toBeUndefined();
    expect(shell.kill).toBeUndefined();
  });

  it('hands the directory to the sandbox as its working directory, and the wait its signal', async () => {
    const shell = sandboxShell(withJobs, { heartbeat });
    await expect(shell.start!('npm run dev', { cwd: 'app' })).resolves.toEqual({ ok: true, id: 'job-1' });
    expect(jobs.start).toHaveBeenCalledWith('npm run dev', 'app');
    await shell.start!('make');
    expect(jobs.start).toHaveBeenLastCalledWith('make', undefined);
    const signal = new AbortController().signal;
    await shell.poll!('job-1', { waitMs: 5, signal });
    expect(jobs.poll).toHaveBeenCalledWith('job-1', { waitMs: 5, signal });
    await shell.kill!('job-1');
    expect(jobs.kill).toHaveBeenCalledWith('job-1');
  });

  it('a wait on a job beats the heartbeat, so the reaper never takes it for a silent run', async () => {
    vi.useFakeTimers();
    try {
      const beat = vi.fn(async () => undefined);
      let release: () => void = () => undefined;
      const slow = {
        jobs: { ...jobs, poll: () => new Promise<{ ok: boolean; id: string; status: 'running' }>((r) => { release = () => r({ ok: true, id: 'job-1', status: 'running' }); }) },
      } as unknown as RunSandbox;
      const waiting = sandboxShell(slow, { heartbeat: beat }).poll!('job-1', { waitMs: 600_000 });
      await vi.advanceTimersByTimeAsync(120_000);
      release();
      await waiting;
      expect(beat).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
