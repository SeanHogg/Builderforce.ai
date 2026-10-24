/**
 * The container-backed sandbox client: one typed port over AgentContainerDO that
 * reopens a recycled instance (409 `not_open`) exactly once and maps the shell's answer
 * onto the result the shared tools read.
 */
import { describe, expect, it, vi } from 'vitest';
import { createContainerSandbox, openRunSandbox, type SandboxTarget } from './runSandbox';
import type { SandboxOpenSpec } from './sandboxOpenSpec';

const SPEC: SandboxOpenSpec = {
  executionId: 9, internalBaseUrl: 'https://api', token: 't',
  repo: { cloneUrl: 'https://api/clone.git', baseBranch: 'main', headBranch: 'bf/9' },
  toolOutputPolicy: false, postEditChecks: true,
};

/** A target answering each path from a queue of (status, body) replies. */
function target(replies: Record<string, Array<[number, unknown]>>): { target: SandboxTarget; calls: Array<{ path: string; body: Record<string, unknown> }> } {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  return {
    calls,
    target: {
      fetch: vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        calls.push({ path, body: JSON.parse(String(init?.body ?? '{}')) });
        const [status, body] = replies[path]?.shift() ?? [404, { ok: false }];
        return new Response(JSON.stringify(body), { status });
      }),
    },
  };
}

describe('createContainerSandbox', () => {
  it('names its execution on every call', async () => {
    const t = target({ '/sandbox/fs': [[200, { ok: true, content: 'x' }]] });
    const sandbox = createContainerSandbox({ target: t.target, executionId: 9, openSpec: async () => SPEC });
    await expect(sandbox.fs({ op: 'read', path: 'a.ts' })).resolves.toEqual({ ok: true, content: 'x' });
    expect(t.calls[0]).toEqual({ path: '/sandbox/fs', body: { executionId: 9, op: 'read', path: 'a.ts' } });
  });

  it('reopens a recycled instance once (409), then retries the call', async () => {
    const t = target({
      '/sandbox/run': [[409, { ok: false, error: 'not_open' }], [200, { ok: true, exitCode: 0, output: 'ok' }]],
      '/sandbox/open': [[200, { ok: true }]],
    });
    const openSpec = vi.fn(async () => SPEC);
    const sandbox = createContainerSandbox({ target: t.target, executionId: 9, openSpec });
    await expect(sandbox.run('ls')).resolves.toEqual({ ok: true, exitCode: 0, stdout: 'ok' });
    expect(t.calls.map((c) => c.path)).toEqual(['/sandbox/run', '/sandbox/open', '/sandbox/run']);
    expect(openSpec).toHaveBeenCalledTimes(1);
  });

  it('surfaces a reopen that fails instead of retrying forever', async () => {
    const t = target({
      '/sandbox/fs': [[409, { ok: false, error: 'not_open' }]],
      '/sandbox/open': [[502, { ok: false, error: 'clone failed: auth' }]],
    });
    const sandbox = createContainerSandbox({ target: t.target, executionId: 9, openSpec: async () => SPEC });
    const r = await sandbox.fs({ op: 'list' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('clone failed: auth');
  });

  it('a run with nothing to clone cannot reopen', async () => {
    const t = target({ '/sandbox/fs': [[409, { ok: false }]] });
    const sandbox = createContainerSandbox({ target: t.target, executionId: 9, openSpec: async () => null });
    await expect(sandbox.fs({ op: 'list' })).resolves.toMatchObject({ ok: false });
  });

  it('maps a failing command and a timed-out one onto the shell result', async () => {
    const t = target({ '/sandbox/run': [[200, { ok: false, exitCode: 2, output: 'boom' }], [200, { ok: false, exitCode: 137, output: '', timedOut: true }]] });
    const sandbox = createContainerSandbox({ target: t.target, executionId: 9, openSpec: async () => SPEC });
    await expect(sandbox.run('x')).resolves.toEqual({ ok: false, exitCode: 2, stdout: 'boom' });
    await expect(sandbox.run('y')).resolves.toMatchObject({ ok: false, exitCode: 137, error: expect.stringContaining('timed out') });
  });

  it('a command that never reached a shell is a failure with a reason, not an exit code', async () => {
    const sandbox = createContainerSandbox({
      target: { fetch: async () => { throw new Error('network down'); } },
      executionId: 9, openSpec: async () => SPEC,
    });
    await expect(sandbox.run('x')).resolves.toEqual({ ok: false, error: expect.stringContaining('network down') });
  });

  it('reads a check verdict, and null when nothing was judged', async () => {
    const t = target({ '/sandbox/checks': [[200, { ok: true, verdict: { passed: false, verifier: 'post_edit_checks', steer: 'fix it' } }], [200, { ok: true, verdict: null }]] });
    const sandbox = createContainerSandbox({ target: t.target, executionId: 9, openSpec: async () => SPEC });
    await expect(sandbox.checks()).resolves.toEqual({ passed: false, verifier: 'post_edit_checks', steer: 'fix it' });
    await expect(sandbox.checks()).resolves.toBeNull();
  });
});

describe('openRunSandbox', () => {
  it('posts the spec and reports the verdict, never throwing', async () => {
    const ok = target({ '/sandbox/open': [[200, { ok: true }]] });
    await expect(openRunSandbox(ok.target, SPEC)).resolves.toEqual({ ok: true });
    expect(ok.calls[0]!.body).toMatchObject({ executionId: 9, repo: { headBranch: 'bf/9' } });
    await expect(openRunSandbox({ fetch: async () => { throw new Error('no instance'); } }, SPEC)).resolves.toEqual({ ok: false, error: 'no instance' });
  });
});
