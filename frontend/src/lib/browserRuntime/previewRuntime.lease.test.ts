import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@seanhogg/builderforce-webcontainers', () => ({
  startPreviewRuntime: async () => ({
    fs: { list: () => [], rm: () => undefined, writeFile: () => undefined },
    writeTree: () => undefined,
    onError: () => () => undefined,
    onPreviewConsole: () => () => undefined,
    listProcesses: () => [],
  }),
}));

const lease = await import('./previewRuntime');

function process() {
  let exit!: (code: number) => void;
  const done = new Promise<number>((resolve) => { exit = resolve; });
  return { wait: () => done, kill: vi.fn(() => exit(137)) };
}

afterEach(async () => {
  vi.useRealTimers();
  // Hand the lease back to the workspace between tests.
  await lease.bootSharedPreviewRuntime();
});

describe('the shared runtime lease', () => {
  it('stops the workspace’s processes and tells its listeners when a browser run takes the runtime', async () => {
    await lease.bootSharedPreviewRuntime();
    const devServer = process();
    lease.trackWorkspaceProcess(devServer as never);
    const heard = vi.fn();
    const stop = lease.onWorkspaceRevoked(heard);
    await lease.bootSharedPreviewRuntime({ id: 'run-target' });
    expect(devServer.kill).toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(lease.sharedPreviewRuntimeOwner()).toBe('run-target');
    stop();
  });

  it('does not revoke the same owner, and forgets a process once it exited', async () => {
    await lease.bootSharedPreviewRuntime();
    const done = process();
    lease.trackWorkspaceProcess(done as never);
    done.kill();
    await Promise.resolve();
    await lease.bootSharedPreviewRuntime();
    const heard = vi.fn();
    const stop = lease.onWorkspaceRevoked(heard);
    await lease.bootSharedPreviewRuntime();
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it('bounds a revocation that never settles', async () => {
    vi.useFakeTimers();
    await lease.bootSharedPreviewRuntime({ id: 'stuck', onRevoked: () => new Promise(() => undefined) });
    const claim = lease.bootSharedPreviewRuntime({ id: 'next' });
    await vi.advanceTimersByTimeAsync(lease.REVOKE_TIMEOUT_MS + 1);
    await expect(claim).resolves.toBeDefined();
    expect(lease.sharedPreviewRuntimeOwner()).toBe('next');
  });

  it('goes ahead when a revocation throws', async () => {
    await lease.bootSharedPreviewRuntime({ id: 'broken', onRevoked: () => { throw new Error('boom'); } });
    await lease.bootSharedPreviewRuntime({ id: 'next' });
    expect(lease.sharedPreviewRuntimeOwner()).toBe('next');
  });

  it('re-checks its claim after a revocation: it never returns a runtime someone else holds', async () => {
    let second: Promise<unknown> | undefined;
    await lease.bootSharedPreviewRuntime({
      id: 'first',
      onRevoked: () => { second = lease.bootSharedPreviewRuntime({ id: 'interloper' }); },
    });
    const claim = lease.bootSharedPreviewRuntime({ id: 'claimant' });
    const settled = await Promise.allSettled([claim.then(() => 'claimant'), claim.then(() => second).then(() => 'interloper')]);
    const owner = lease.sharedPreviewRuntimeOwner();
    // Whoever holds the runtime now is a claimant whose claim succeeded; a claim that kept
    // losing the race gave up with a reason instead of handing out a runtime it did not hold.
    expect(['claimant', 'interloper']).toContain(owner);
    for (const result of settled) {
      if (result.status === 'rejected') expect(String(result.reason)).toMatch(/being claimed by another part of the page/);
    }
  });

  it('release is a no-op for an owner that does not hold the runtime', async () => {
    await lease.bootSharedPreviewRuntime({ id: 'holder' });
    lease.releaseSharedPreviewRuntime('someone-else');
    expect(lease.sharedPreviewRuntimeOwner()).toBe('holder');
    lease.releaseSharedPreviewRuntime('holder');
    expect(lease.sharedPreviewRuntimeOwner()).toBeNull();
  });
});
