/**
 * The pull transport: the engine's sandbox request waits in the run's CloudRunnerDO
 * until the GitHub Actions runner polls for it and posts the result back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailboxSandbox, SandboxMailbox } from './sandboxMailbox';

afterEach(() => { vi.useRealTimers(); });

describe('SandboxMailbox', () => {
  it('round-trips one request: the engine waits, the runner polls, serves and answers', async () => {
    const mailbox = new SandboxMailbox();
    const pending = mailbox.request<{ ok: boolean; content?: string }>('/sandbox/fs', { op: 'read', path: 'a.ts' });
    const poll = await mailbox.next(0);
    expect('request' in poll && poll.request.path).toBe('/sandbox/fs');
    const id = 'request' in poll ? poll.request.id : '';
    expect(mailbox.resolve(id, { ok: true, content: 'x' })).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true, content: 'x' });
    // Answered once: a second result for the same id has nothing waiting on it.
    expect(mailbox.resolve(id, { ok: true })).toBe(false);
  });

  it('holds a poll open for a request, and answers idle when none arrives', async () => {
    vi.useFakeTimers();
    const mailbox = new SandboxMailbox();
    const idle = mailbox.next(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(idle).resolves.toEqual({ idle: true });

    const waiting = mailbox.next(1_000);
    void mailbox.request('/sandbox/run', { command: 'ls' });
    const poll = await waiting;
    expect('request' in poll && poll.request.body).toEqual({ command: 'ls' });
  });

  it('close releases every poll and every waiting request', async () => {
    vi.useFakeTimers();
    const mailbox = new SandboxMailbox();
    const poll = mailbox.next(60_000);
    const pending = mailbox.request('/sandbox/checks', {});
    mailbox.close();
    await expect(poll).resolves.toEqual({ close: true });
    await expect(pending).resolves.toEqual({ ok: false, error: 'the run sandbox is closed' });
    await expect(mailbox.next(0)).resolves.toEqual({ close: true });
    await expect(mailbox.request('/sandbox/checks', {})).resolves.toMatchObject({ ok: false });
  });

  it('an aborted request resolves as cancelled and is no longer answerable', async () => {
    const mailbox = new SandboxMailbox();
    const abort = new AbortController();
    const pending = mailbox.request('/sandbox/run', { command: 'pnpm test' }, abort.signal);
    const poll = await mailbox.next(0);
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, error: 'cancelled' });
    expect(mailbox.resolve('request' in poll ? poll.request.id : '', { ok: true })).toBe(false);
  });
});

describe('createMailboxSandbox', () => {
  it('maps a served command onto the shell result the tools read', async () => {
    const mailbox = new SandboxMailbox();
    const sandbox = createMailboxSandbox(mailbox);
    const ran = sandbox.run('pnpm test');
    const poll = await mailbox.next(0);
    mailbox.resolve('request' in poll ? poll.request.id : '', { ok: false, exitCode: 1, output: '1 failed' });
    await expect(ran).resolves.toEqual({ ok: false, exitCode: 1, stdout: '1 failed' });
  });

  it('reads a check verdict, and null when nothing was judged', async () => {
    const mailbox = new SandboxMailbox();
    const sandbox = createMailboxSandbox(mailbox);
    const first = sandbox.checks();
    let poll = await mailbox.next(0);
    mailbox.resolve('request' in poll ? poll.request.id : '', { ok: true, verdict: { passed: true, verifier: 'post_edit_checks' } });
    await expect(first).resolves.toEqual({ passed: true, verifier: 'post_edit_checks' });
    const second = sandbox.checks();
    poll = await mailbox.next(0);
    mailbox.resolve('request' in poll ? poll.request.id : '', { ok: true, verdict: null });
    await expect(second).resolves.toBeNull();
  });
});
