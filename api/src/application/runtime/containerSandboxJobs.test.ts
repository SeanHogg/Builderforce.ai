/**
 * The run sandbox's background jobs and working directory (`container/sandboxJobs.mjs`,
 * served by `container/sandboxCore.mjs`) over a REAL shell and a real directory: start and
 * poll to exit, a bounded wait, a kill that reaches a grandchild, `cwd`, and the close that
 * ends every job. The sandbox is a Linux container (bash, process groups), so these skip
 * where there is none.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeSandboxBox, createSandboxBox, serveSandbox, type SandboxBox, type SandboxOnAbort } from '../../../container/sandboxCore.mjs';

const posix = process.platform !== 'win32';

let workdir = '';
let box: SandboxBox;

beforeEach(async () => {
  if (!posix) return;
  workdir = await mkdtemp(join(tmpdir(), 'bf-sandbox-jobs-'));
  box = createSandboxBox({ spec: {}, workdir });
});

afterEach(async () => {
  if (!posix) return;
  await closeSandboxBox(box);
  await rm(workdir, { recursive: true, force: true });
});

const serve = (path: string, body: Record<string, unknown>, onAbort?: SandboxOnAbort) => serveSandbox(box, path, body, onAbort);
const start = async (command: string, cwd?: string) => (await serve('/sandbox/job/start', { command, ...(cwd ? { cwd } : {}) })) as { ok: boolean; id?: string; error?: string };
/** Running, not merely un-reaped: a killed orphan is a zombie until its new parent collects it. */
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};
async function until(check: () => Promise<boolean> | boolean, ms = 5_000): Promise<void> {
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

describe.skipIf(!posix)('background jobs', () => {
  it('starts a command, answers at once, and a poll that waits sees it exit with its output', async () => {
    const started = await start('echo built; exit 3');
    expect(started).toMatchObject({ ok: true, id: 'job-1' });
    const st = await serve('/sandbox/job/poll', { id: started.id, waitMs: 10_000 });
    expect(st).toMatchObject({ ok: false, id: 'job-1', status: 'exited', exitCode: 3, output: 'built' });
    const ok = await start('echo fine');
    expect(await serve('/sandbox/job/poll', { id: ok.id, waitMs: 10_000 })).toMatchObject({ ok: true, status: 'exited', exitCode: 0, output: 'fine' });
  });

  it('a poll returns early when the job ends, and at its wait when it does not', async () => {
    const quick = await start('sleep 0.2; echo done');
    const t0 = Date.now();
    expect(await serve('/sandbox/job/poll', { id: quick.id, waitMs: 30_000 })).toMatchObject({ status: 'exited' });
    expect(Date.now() - t0).toBeLessThan(10_000);

    const slow = await start('sleep 300');
    const t1 = Date.now();
    const st = await serve('/sandbox/job/poll', { id: slow.id, waitMs: 250 });
    expect(st).toMatchObject({ ok: true, status: 'running' });
    expect(Date.now() - t1).toBeLessThan(5_000);
    // A poll with no wait answers at once.
    expect(await serve('/sandbox/job/poll', { id: slow.id })).toMatchObject({ status: 'running' });
  });

  it('a poll ends its wait when the transport reports the request aborted, and the job runs on', async () => {
    const slow = await start('sleep 300');
    let released = 0;
    const onAbort: SandboxOnAbort = (wake) => { setTimeout(wake, 100); return () => { released += 1; }; };
    const t0 = Date.now();
    expect(await serve('/sandbox/job/poll', { id: slow.id, waitMs: 600_000 }, onAbort)).toMatchObject({ status: 'running' });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(released).toBe(1);
    expect(await serve('/sandbox/job/poll', { id: slow.id })).toMatchObject({ status: 'running' });
  });

  it('keeps a bounded tail of the output and says it dropped the rest', async () => {
    const big = await start("head -c 90000 /dev/zero | tr '\\0' x; echo END");
    const st = (await serve('/sandbox/job/poll', { id: big.id, waitMs: 10_000 })) as { output: string; truncated?: boolean };
    expect(st.truncated).toBe(true);
    expect(st.output.length).toBeLessThanOrEqual(60_000);
    expect(st.output.endsWith('END')).toBe(true);
  });

  it('a kill reaches the whole process tree, grandchild included', async () => {
    const pidFile = join(workdir, 'grandchild.pid');
    const started = await start(`(sleep 300 & echo $! > "${pidFile}"; wait)`);
    const pid = await readPid(pidFile);
    expect(alive(pid)).toBe(true);
    expect(await serve('/sandbox/job/kill', { id: started.id })).toMatchObject({ ok: false, status: 'killed', error: 'stopped' });
    await until(() => !alive(pid));
    // Killing an ended job is a report, not an error.
    expect(await serve('/sandbox/job/kill', { id: started.id })).toMatchObject({ status: 'killed' });
  });

  it('an id the box never issued is unknown, on poll and on kill', async () => {
    expect(await serve('/sandbox/job/poll', { id: 'job-99' })).toMatchObject({ ok: false, id: 'job-99', status: 'unknown' });
    expect(await serve('/sandbox/job/kill', { id: 'job-99' })).toMatchObject({ ok: false, status: 'unknown' });
    expect(await serve('/sandbox/job/poll', {})).toMatchObject({ status: 'unknown' });
  });

  it('closing the box kills every running job, so none outlives the run', async () => {
    const pidFile = join(workdir, 'a.pid');
    const a = await start(`echo $$ > "${pidFile}"; sleep 300`);
    const b = await start('sleep 300');
    const pid = await readPid(pidFile);
    await closeSandboxBox(box);
    expect(await serve('/sandbox/job/poll', { id: a.id })).toMatchObject({ status: 'killed' });
    expect(await serve('/sandbox/job/poll', { id: b.id })).toMatchObject({ status: 'killed' });
    await until(() => !alive(pid));
  });

  it('refuses a start with no command', async () => {
    expect(await serve('/sandbox/job/start', { command: '  ' })).toMatchObject({ ok: false, error: 'command is required' });
  });
});

describe.skipIf(!posix)('cwd', () => {
  beforeEach(async () => {
    await mkdir(join(workdir, 'app', 'web'), { recursive: true });
    await writeFile(join(workdir, 'file.txt'), 'x');
  });

  const where = (r: Record<string, unknown>): string => String(r.output).trim().replace(/\\/g, '/');

  it('a foreground command runs in the named directory, and at the root without one', async () => {
    expect(where(await serve('/sandbox/run', { command: 'pwd', cwd: 'app/web' }))).toMatch(/\/app\/web$/);
    for (const body of [{ command: 'ls' }, { command: 'ls', cwd: '.' }, { command: 'ls', cwd: '' }]) {
      const root = await serve('/sandbox/run', body);
      expect(root.ok).toBe(true);
      expect(String(root.output)).toContain('file.txt');
    }
  });

  it('a background job runs in the named directory', async () => {
    const job = await start('pwd', 'app');
    expect(where(await serve('/sandbox/job/poll', { id: job.id, waitMs: 10_000 }))).toMatch(/\/app$/);
  });

  it('refuses a directory that escapes the clone, is missing, or is a file, without running anything', async () => {
    for (const cwd of ['../elsewhere', 'app/../../up']) {
      expect(await serve('/sandbox/run', { command: 'echo no', cwd })).toMatchObject({ ok: false, error: expect.stringContaining('inside the repository') });
      expect(await start('echo no', cwd)).toMatchObject({ ok: false, error: expect.stringContaining('inside the repository') });
    }
    for (const cwd of ['missing', 'file.txt']) {
      expect(await serve('/sandbox/run', { command: 'echo no', cwd })).toMatchObject({ ok: false, error: expect.stringContaining('not a directory') });
      expect(await start('echo no', cwd)).toMatchObject({ ok: false, error: expect.stringContaining('not a directory') });
    }
  });
});
