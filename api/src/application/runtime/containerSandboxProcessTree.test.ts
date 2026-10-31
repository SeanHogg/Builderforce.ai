/**
 * The run sandbox's process-tree guarantees, over a REAL shell: a foreground command that
 * hangs is killed with everything it started and its request still answers; a background
 * job's daemon dies with the job's kill and the box's close even after the job read
 * `exited`; a job's reply fits the model's cap; ids carry the boot prefix; the idle-reap
 * probe sees a running job. Linux only (bash, process groups, `setsid`): skipped elsewhere,
 * run in CI.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeSandboxBox, createSandboxBox, serveSandbox, type SandboxBox, type SandboxOnAbort } from '../../../container/sandboxCore.mjs';

const posix = process.platform !== 'win32';

let workdir = '';
let box: SandboxBox;

beforeEach(async () => {
  if (!posix) return;
  workdir = await mkdtemp(join(tmpdir(), 'bf-sandbox-tree-'));
  box = createSandboxBox({ spec: {}, workdir });
});

afterEach(async () => {
  if (!posix) return;
  await closeSandboxBox(box);
  await rm(workdir, { recursive: true, force: true });
});

const serve = (path: string, body: Record<string, unknown>, onAbort?: SandboxOnAbort) => serveSandbox(box, path, body, onAbort);
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};
async function until(check: () => Promise<boolean> | boolean, ms = 8_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not reached in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const readPid = async (file: string): Promise<number> => {
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).trim() !== '');
  return Number((await readFile(file, 'utf8')).trim());
};

describe.skipIf(!posix)('a foreground command that hangs', () => {
  it('a timeout kills the whole tree, grandchildren included, and the request answers', async () => {
    const pidFile = join(workdir, 'gc.pid');
    const r = await serve('/sandbox/run', { command: `(sleep 300 & echo $! > "${pidFile}"; wait)`, timeoutMs: 400 });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    const pid = await readPid(pidFile);
    await until(() => !alive(pid));
  }, 20_000);

  it("the engine's cancel kills the tree and the request answers", async () => {
    const pidFile = join(workdir, 'gc2.pid');
    let kill: (() => void) | undefined;
    const onAbort: SandboxOnAbort = (k) => { kill = k; return () => {}; };
    const running = serve('/sandbox/run', { command: `(sleep 300 & echo $! > "${pidFile}"; wait)` }, onAbort);
    const pid = await readPid(pidFile);
    kill!();
    await running;
    await until(() => !alive(pid));
  }, 20_000);

  it('a descendant that escaped the process group cannot hold the request open', async () => {
    const pidFile = join(workdir, 'escaped.pid');
    const t0 = Date.now();
    // `setsid` puts the sleeper in its own group: the group kill cannot reach it, and it keeps the output pipe open.
    const r = await serve('/sandbox/run', { command: `setsid sleep 300 & echo $! > "${pidFile}"; wait`, timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(Date.now() - t0).toBeLessThan(10_000);
    process.kill(await readPid(pidFile), 'SIGKILL');
  }, 20_000);
});

describe.skipIf(!posix)('a background job that leaves a daemon behind', () => {
  const daemon = (pidFile: string) => `nohup sleep 300 >/dev/null 2>&1 & echo $! > "${pidFile}"`;
  const start = async (command: string) => (await serve('/sandbox/job/start', { command })) as { ok: boolean; id: string };

  it('kill stops the daemon, and the job still reports exited rather than killed', async () => {
    const pidFile = join(workdir, 'd1.pid');
    const job = await start(daemon(pidFile));
    const pid = await readPid(pidFile);
    expect(await serve('/sandbox/job/poll', { id: job.id, waitMs: 10_000 })).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(alive(pid)).toBe(true);
    const stopped = await serve('/sandbox/job/kill', { id: job.id });
    expect(stopped).toMatchObject({ status: 'exited' });
    expect(stopped).not.toHaveProperty('error');
    await until(() => !alive(pid));
  });

  it('closing the box stops the daemon of a job that already exited', async () => {
    const pidFile = join(workdir, 'd2.pid');
    const job = await start(daemon(pidFile));
    const pid = await readPid(pidFile);
    await serve('/sandbox/job/poll', { id: job.id, waitMs: 10_000 });
    await closeSandboxBox(box);
    await until(() => !alive(pid));
  });

  it('eviction of the finished job record does not forget its daemon', async () => {
    const pidFile = join(workdir, 'd3.pid');
    const first = await start(daemon(pidFile));
    const pid = await readPid(pidFile);
    await serve('/sandbox/job/poll', { id: first.id, waitMs: 10_000 });
    for (let i = 0; i < 33; i += 1) {
      const quick = await start('true');
      await serve('/sandbox/job/poll', { id: quick.id, waitMs: 10_000 });
    }
    expect(await serve('/sandbox/job/poll', { id: first.id })).toMatchObject({ status: 'unknown' });
    await closeSandboxBox(box);
    await until(() => !alive(pid));
  }, 30_000);
});

describe.skipIf(!posix)('job replies and ids', () => {
  it("fits a job's output like a foreground command: the verdict at the end survives", async () => {
    const job = (await serve('/sandbox/job/start', { command: 'yes "build line" | head -n 8000; echo FINAL VERDICT' })) as { id: string };
    const st = (await serve('/sandbox/job/poll', { id: job.id, waitMs: 10_000 })) as { output: string };
    expect(st.output.length).toBeLessThan(25_000);
    expect(st.output.endsWith('FINAL VERDICT')).toBe(true);
    const killed = (await serve('/sandbox/job/kill', { id: job.id })) as { output: string };
    expect(killed.output.length).toBeLessThan(25_000);
    expect(killed.output.endsWith('FINAL VERDICT')).toBe(true);
  });

  it('puts the boot prefix before every id, and none by default', async () => {
    expect(await serve('/sandbox/job/start', { command: 'true' })).toMatchObject({ id: 'job-1' });
    const prefixed = createSandboxBox({ spec: {}, workdir, jobIdPrefix: 'ab12-' });
    expect(await serveSandbox(prefixed, '/sandbox/job/start', { command: 'true' })).toMatchObject({ id: 'ab12-job-1' });
    // The same number under another boot is a different job, so a stale poll finds nothing.
    expect(await serveSandbox(prefixed, '/sandbox/job/poll', { id: 'job-1' })).toMatchObject({ status: 'unknown' });
    await closeSandboxBox(prefixed);
  });

  it('answers whether a job is running, for the idle-reap probe', async () => {
    expect(await serve('/sandbox/job/active', {})).toEqual({ ok: true, active: false });
    const job = (await serve('/sandbox/job/start', { command: 'sleep 300' })) as { id: string };
    expect(await serve('/sandbox/job/active', {})).toEqual({ ok: true, active: true });
    await serve('/sandbox/job/kill', { id: job.id });
    expect(await serve('/sandbox/job/active', {})).toEqual({ ok: true, active: false });
  });
});
