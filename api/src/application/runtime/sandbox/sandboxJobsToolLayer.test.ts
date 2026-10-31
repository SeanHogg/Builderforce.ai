/**
 * A cloud run's `run_command { background: true }` then `command_status`, end to end
 * through the shared tool layer: the registry's real tool definitions, the sandbox shell
 * (`withSandbox`), the one job mapping (`sandboxJobsOver`) and THE sandbox core
 * (`container/sandboxCore.mjs`) over a real shell. The transport is a loopback that calls
 * the core directly, so what is proven is the seam each side owns. A real shell is needed,
 * so this skips where the sandbox's bash and process groups do not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoreToolRegistry, type CapabilityProvider } from '@builderforce/agent-tools';
import { closeSandboxBox, createSandboxBox, serveSandbox, type SandboxBox } from '../../../../container/sandboxCore.mjs';

vi.mock('../cloudAgent/runContext', () => ({ SANDBOX_COMMAND_HEARTBEAT_MS: 60_000 }));

import { sandboxJobsOver, toShellResult, type RunSandbox, type SandboxRunReply } from './runSandbox';
import { withSandbox } from './sandboxProvider';

const posix = process.platform !== 'win32';

let workdir = '';
let box: SandboxBox;

beforeEach(async () => {
  if (!posix) return;
  workdir = await mkdtemp(join(tmpdir(), 'bf-sandbox-tools-'));
  await mkdir(join(workdir, 'app'));
  box = createSandboxBox({ spec: {}, workdir });
});

afterEach(async () => {
  if (!posix) return;
  await closeSandboxBox(box);
  await rm(workdir, { recursive: true, force: true });
});

/** The sandbox the engine holds, served in-process by the core instead of over a transport. */
function loopback(withJobs = true): RunSandbox {
  const serve = (path: string, body: Record<string, unknown>) => serveSandbox(box, path, body);
  return {
    fs: async () => ({ ok: false, error: 'not used' }),
    run: async (command, _signal, timeoutMs, cwd) =>
      toShellResult((await serve('/sandbox/run', { command, ...(timeoutMs ? { timeoutMs } : {}), ...(cwd ? { cwd } : {}) })) as unknown as SandboxRunReply),
    checks: async () => null,
    close: async () => closeSandboxBox(box),
    ...(withJobs ? { jobs: sandboxJobsOver(async <T,>(path: string, body: Record<string, unknown>) => (await serve(path, body)) as T) } : {}),
  };
}

/** A fresh capability provider per call — as each tick of a cloud run builds its own. */
const provider = (sandbox: RunSandbox): CapabilityProvider =>
  withSandbox({ capabilities: new Set(['repo.read']) } as unknown as CapabilityProvider, sandbox, { heartbeat: async () => undefined });

const registry = buildCoreToolRegistry();
const call = async (caps: CapabilityProvider, name: string, args: Record<string, unknown>) =>
  (await registry.dispatch(name, args, { caps })).data as Record<string, unknown>;

describe.skipIf(!posix)('background commands through a cloud run\'s tools', () => {
  it('run_command { background } returns a job id at once, and command_status waits it to its exit', async () => {
    const sandbox = loopback();
    const started = await call(provider(sandbox), 'run_command', { command: 'sleep 0.3; echo built', background: true });
    expect(started).toMatchObject({ ok: true, background: true, status: 'running', id: expect.stringMatching(/^job-/) });
    // The NEXT tick builds its own provider; the job table is the sandbox's, so the id still answers.
    const done = await call(provider(sandbox), 'command_status', { id: started.id, waitMs: 10_000 });
    expect(done).toMatchObject({ ok: true, id: started.id, status: 'exited', exitCode: 0, output: 'built' });
  });

  it('a command that outlives yieldMs moves to the background and stays pollable', async () => {
    const sandbox = loopback();
    const r = await call(provider(sandbox), 'run_command', { command: 'sleep 300', yieldMs: 200 });
    expect(r).toMatchObject({ ok: true, background: true, status: 'running' });
    expect(await call(provider(sandbox), 'command_status', { id: r.id })).toMatchObject({ status: 'running' });
    expect(await call(provider(sandbox), 'command_stop', { id: r.id })).toMatchObject({ status: 'killed' });
  });

  it('a command that ends inside yieldMs answers like a foreground one', async () => {
    const r = await call(provider(loopback()), 'run_command', { command: 'echo quick', yieldMs: 10_000 });
    expect(r).toMatchObject({ ok: true, exitCode: 0, stdout: expect.stringContaining('quick') });
    expect(r.background).toBeUndefined();
  });

  it('runs in the directory the call names, foreground and background', async () => {
    const sandbox = loopback();
    const job = await call(provider(sandbox), 'run_command', { command: 'pwd', cwd: 'app', background: true });
    expect(job).toMatchObject({ ok: true, cwd: 'app' });
    const st = await call(provider(sandbox), 'command_status', { id: job.id, waitMs: 10_000 });
    expect(String(st.output).replace(/\\/g, '/')).toMatch(/\/app$/);
    const fg = await call(provider(sandbox), 'run_command', { command: 'pwd', cwd: 'app' });
    expect(String(fg.stdout).trim().replace(/\\/g, '/')).toMatch(/\/app$/);
  });

  it('command_stop kills the job, and closing the sandbox ends the ones a run left behind', async () => {
    const sandbox = loopback();
    const stopped = await call(provider(sandbox), 'run_command', { command: 'sleep 300', background: true });
    const left = await call(provider(sandbox), 'run_command', { command: 'sleep 300', background: true });
    expect(await call(provider(sandbox), 'command_stop', { id: stopped.id })).toMatchObject({ status: 'killed' });
    await sandbox.close();
    expect(await call(provider(sandbox), 'command_status', { id: left.id })).toMatchObject({ status: 'killed' });
  });

  it('an id the sandbox does not hold comes back as status unknown for the model to read', async () => {
    expect(await call(provider(loopback()), 'command_status', { id: 'job-42' })).toMatchObject({ ok: false, status: 'unknown' });
  });

  it('a sandbox without jobs does not advertise the tools, and run_command says it ran in the foreground', async () => {
    const caps = provider(loopback(false));
    expect(registry.availableNames(caps)).not.toContain('command_status');
    expect(await call(caps, 'command_status', { id: 'job-1' })).toMatchObject({ ok: false, error: expect.stringContaining('shell.jobs') });
    const r = await call(caps, 'run_command', { command: 'echo hi', background: true });
    expect(r).toMatchObject({ ok: true, exitCode: 0, stdout: expect.stringContaining('hi'), note: expect.stringContaining('foreground') });
  });

  it('a sandbox with jobs advertises command_status and command_stop beside run_command', () => {
    const names = registry.availableNames(provider(loopback()));
    expect(names).toEqual(expect.arrayContaining(['run_command', 'command_status', 'command_stop']));
  });
});
