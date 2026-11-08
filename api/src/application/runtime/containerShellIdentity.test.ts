/**
 * THE uid split (`sandboxJobs.mjs`): the model's shell must not share the sandbox process's uid, or it reads
 * `/proc/<pid>/environ` (BUILDERFORCE_TOKEN, the Actions OIDC request token) and `/proc/<pid>/mem`.
 *
 *  • the spawn helper builds `sudo -n -u <user> env -i <allowlisted KEY=VAL> bash -lc …` — pure, runs anywhere;
 *  • with a REAL shell user (Linux, passwordless sudo to it — the container and the Actions runner both have
 *    one) the shell cannot read this process's environ. Skipped where no such user exists (Windows, a dev box).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeSandboxBox, createSandboxBox, serveSandbox, shellInvocation, shellUser, type SandboxBox } from '../../../container/sandboxCore.mjs';

const posix = process.platform !== 'win32';

describe('shellInvocation', () => {
  const parent = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/runner',
    LANG: 'C.UTF-8',
    BUILDERFORCE_TOKEN: 'run-secret',
    BUILDERFORCE_SHELL_USER: 'bfagent',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-secret',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.test/?x=1',
    ACTIONS_RUNTIME_TOKEN: 'runtime-secret',
    GITHUB_TOKEN: 'ghs_secret',
  };

  it('without a shell user it is the plain, filtered bash it always was', () => {
    const inv = shellInvocation('echo hi', { env: { ...parent, BUILDERFORCE_SHELL_USER: undefined } });
    expect(inv.file).toBe('bash');
    expect(inv.args).toEqual(['-lc', 'echo hi']);
    expect(inv.env.BUILDERFORCE_TOKEN).toBeUndefined();
    expect(inv.env.PATH).toBe('/usr/bin:/bin');
  });

  it('with a shell user it is `sudo -n -u <user> env -i <allowlisted KEY=VAL> bash -lc …`', () => {
    const inv = shellInvocation('npm test', { env: parent });
    expect(inv.file).toBe('sudo');
    expect(inv.args.slice(0, 5)).toEqual(['-n', '-u', 'bfagent', 'env', '-i']);
    const tail = inv.args.slice(-3);
    expect(tail[0]).toBe('bash');
    expect(tail[1]).toBe('-lc');
    // umask 002: what the shell writes stays writable by the sandbox process (same group, other uid).
    expect(tail[2]).toBe('umask 002\nnpm test');
    const pairs = inv.args.slice(5, -3);
    expect(pairs).toContain('PATH=/usr/bin:/bin');
    expect(pairs).toContain('LANG=C.UTF-8');
    // Re-homed to the shell user, never the runner's home.
    expect(pairs).toContain('HOME=/home/bfagent');
    expect(pairs).toContain('USER=bfagent');
    expect(pairs).not.toContain('HOME=/home/runner');
    // Every pair is NAME=value; nothing option-shaped can precede `bash`.
    for (const p of pairs) expect(p).toMatch(/^[A-Za-z_][A-Za-z0-9_]*=/);
  });

  it('carries no run credential in the argv or in the spawned sudo\'s own env', () => {
    const inv = shellInvocation('env', { env: parent });
    const argv = inv.args.join('\u0000');
    for (const secret of ['run-secret', 'oidc-request-secret', 'runtime-secret', 'ghs_secret', 'token.actions.test', 'BUILDERFORCE_']) {
      expect(argv).not.toContain(secret);
    }
    // The wrapper process holds PATH only.
    expect(inv.env).toEqual({ PATH: '/usr/bin:/bin' });
  });

  it('passes the caller\'s own plan env (a preview\'s project env) through, after the filter', () => {
    const inv = shellInvocation('vite', { env: parent, extraEnv: { VITE_API: 'https://x.test', 'bad name': 'dropped' } });
    expect(inv.args).toContain('VITE_API=https://x.test');
    expect(inv.args.some((a) => a.startsWith('bad name'))).toBe(false);
  });

  it('refuses a shell-user name that could carry an option or a command', () => {
    expect(shellUser({ BUILDERFORCE_SHELL_USER: '-u root' })).toBeNull();
    expect(shellUser({ BUILDERFORCE_SHELL_USER: 'a;b' })).toBeNull();
    expect(shellUser({ BUILDERFORCE_SHELL_USER: 'bfagent' })).toBe('bfagent');
    expect(shellUser({})).toBeNull();
  });
});

/** A user this process can `sudo -n -u` to without a password — the precondition of the real uid-split test. */
const testUser = process.env.BUILDERFORCE_TEST_SHELL_USER || 'bfagent';
const canSwitchUser = posix && spawnSync('sudo', ['-n', '-u', testUser, 'true'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!canSwitchUser)('the shell cannot read the sandbox process\'s environ', () => {
  let workdir = '';
  let box: SandboxBox;
  const saved = { user: process.env.BUILDERFORCE_SHELL_USER, token: process.env.BUILDERFORCE_TOKEN };

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'bf-sandbox-uid-'));
    process.env.BUILDERFORCE_SHELL_USER = testUser;
    process.env.BUILDERFORCE_TOKEN = 'run-secret-must-not-leak';
    box = createSandboxBox({ spec: {}, workdir });
  });

  afterEach(async () => {
    await closeSandboxBox(box);
    if (saved.user === undefined) delete process.env.BUILDERFORCE_SHELL_USER; else process.env.BUILDERFORCE_SHELL_USER = saved.user;
    if (saved.token === undefined) delete process.env.BUILDERFORCE_TOKEN; else process.env.BUILDERFORCE_TOKEN = saved.token;
    await rm(workdir, { recursive: true, force: true });
  });

  it('runs as another uid and gets EACCES on /proc/<server pid>/environ and /mem', async () => {
    const r = await serveSandbox(box, '/sandbox/run', {
      command: `id -u; cat /proc/${process.pid}/environ 2>&1 | tr '\\0' '\\n' | head -c 400; head -c 1 /proc/${process.pid}/mem 2>&1`,
    }) as { output: string };
    const lines = r.output.split('\n');
    expect(Number(lines[0])).not.toBe(process.getuid?.());
    expect(r.output).not.toContain('run-secret-must-not-leak');
    expect(r.output).toMatch(/Permission denied/);
  });

  it('a background job is the same user, and the filtered env reaches it', async () => {
    const started = await serveSandbox(box, '/sandbox/job/start', { command: 'echo "$USER:${BUILDERFORCE_TOKEN:-none}"' }) as { id: string };
    const done = await serveSandbox(box, '/sandbox/job/poll', { id: started.id, waitMs: 10_000 }) as { output: string };
    expect(done.output.trim()).toBe(`${testUser}:none`);
  });
});
