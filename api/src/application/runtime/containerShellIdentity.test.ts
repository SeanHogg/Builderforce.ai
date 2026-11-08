/**
 * THE uid split (`sandboxJobs.mjs`): the model's shell must not share the sandbox process's uid, or it reads
 * `/proc/<pid>/environ` (BUILDERFORCE_TOKEN, the Actions OIDC request token) and `/proc/<pid>/mem`.
 *
 *  • the spawn helper builds `sudo -n -u <user> env -i <allowlisted KEY=VAL> bash -lc …` — pure, runs anywhere;
 *  • with a REAL shell user (Linux, passwordless sudo to it — the container and the Actions runner both have
 *    one) the shell cannot read a process's environ. Skipped where no such user exists (Windows, a dev box).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TRUSTED_PATH, closeSandboxBox, createSandboxBox, serveSandbox, shellEnv, shellInvocation, shellUser, trustedBinary, type SandboxBox } from '../../../container/sandboxCore.mjs';
import { WORKSPACE_HELPER } from './containerTestHelper';

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
    UNLISTED_SECRET: 'unlisted-secret',
  };

  it('without a shell user it is the plain, filtered bash it always was', () => {
    const inv = shellInvocation('echo hi', { env: { ...parent, BUILDERFORCE_SHELL_USER: undefined } });
    expect(inv.file).toBe('bash');
    expect(inv.args).toEqual(['-lc', 'echo hi']);
    expect(inv.env.BUILDERFORCE_TOKEN).toBeUndefined();
    expect(inv.env.UNLISTED_SECRET).toBeUndefined();
    expect(inv.env.PATH).toBe('/usr/bin:/bin');
  });

  it('with a shell user it is `sudo -n -u <user> env -i <allowlisted KEY=VAL> bash -lc <command>`', () => {
    const inv = shellInvocation('npm test', { env: parent });
    expect(inv.file).toBe(trustedBinary('sudo')); // an absolute path from the fixed trusted dirs, never a PATH lookup
    expect(inv.args.slice(0, 5)).toEqual(['-n', '-u', 'bfagent', 'env', '-i']);
    expect(inv.args.slice(-3)).toEqual(['bash', '-lc', 'npm test']);
    const pairs = inv.args.slice(5, -3);
    // Exactly the allowlisted names, the user's HOME rather than the runner's, and nothing else.
    expect([...pairs].sort()).toEqual(['HOME=/home/bfagent', 'LANG=C.UTF-8', 'LOGNAME=bfagent', 'PATH=/usr/bin:/bin', 'USER=bfagent']);
    // Every pair is NAME=value; nothing option-shaped can precede `bash`.
    for (const p of pairs) expect(p).toMatch(/^[A-Za-z_][A-Za-z0-9_]*=/);
  });

  it('carries no run credential in the argv or in the spawned sudo\'s own env', () => {
    const inv = shellInvocation('env', { env: parent });
    const argv = inv.args.join('\u0000');
    for (const secret of ['run-secret', 'oidc-request-secret', 'runtime-secret', 'ghs_secret', 'unlisted-secret', 'token.actions.test', 'BUILDERFORCE_']) {
      expect(argv).not.toContain(secret);
    }
    // The wrapper process holds PATH only, and it is the fixed trusted list, not the inherited one.
    expect(inv.env).toEqual({ PATH: TRUSTED_PATH });
  });

  it('passes the caller\'s own plan env (a preview\'s project env) through, after the filter', () => {
    const inv = shellInvocation('vite', { env: parent, extraEnv: { VITE_API: 'https://x.test', 'bad name': 'dropped' } });
    expect(inv.args).toContain('VITE_API=https://x.test');
    expect(inv.args.some((a) => a.startsWith('bad name'))).toBe(false);
  });

  it('passes through the names a tenant lists in BUILDERFORCE_SHELL_ENV (build secrets they chose to expose)', () => {
    const inv = shellInvocation('npm ci', { env: { ...parent, NPM_TOKEN: 'npm-secret', BUILDERFORCE_SHELL_ENV: 'NPM_TOKEN' } });
    expect(inv.args).toContain('NPM_TOKEN=npm-secret');
    expect(inv.args.join('\u0000')).not.toContain('unlisted-secret');
  });

  it('never hands the shell a credential-bearing COREPACK_* name, even when the tenant lists it', () => {
    const env = shellEnv({
      PATH: '/usr/bin', COREPACK_HOME: '/cp', COREPACK_NPM_TOKEN: 't', COREPACK_NPM_PASSWORD: 'p', COREPACK_NPM_REGISTRY_AUTH: 'a', COREPACK_X_SECRET: 's',
      BUILDERFORCE_SHELL_ENV: 'COREPACK_NPM_TOKEN',
    });
    expect(env.COREPACK_HOME).toBe('/cp');
    for (const name of ['COREPACK_NPM_TOKEN', 'COREPACK_NPM_PASSWORD', 'COREPACK_NPM_REGISTRY_AUTH', 'COREPACK_X_SECRET']) expect(env[name], name).toBeUndefined();
  });

  it('never hands the shell the container control secret', () => {
    expect(shellEnv({ PATH: '/usr/bin', BUILDERFORCE_CONTROL_SECRET: 'c', BUILDERFORCE_SHELL_ENV: 'BUILDERFORCE_CONTROL_SECRET' }).BUILDERFORCE_CONTROL_SECRET).toBeUndefined();
  });

  it('resolves privileged binaries to absolute paths in a fixed trusted list (never the inherited PATH)', () => {
    expect(TRUSTED_PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
    if (process.platform === 'win32') {
      expect(trustedBinary('git')).toBe('git'); // no such layout there; there is no shell user either
      return;
    }
    for (const name of ['git', 'sudo', 'id', 'kill', 'pkill', 'chown', 'rm']) {
      const path = trustedBinary(name);
      expect(path, name).toMatch(/^\/(usr\/(local\/)?)?s?bin\//);
      expect(path.endsWith(`/${name}`)).toBe(true);
    }
    expect(() => trustedBinary('../evil')).toThrow(/not a binary name/);
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

describe.skipIf(!canSwitchUser)('the shell cannot read another process\'s environ', () => {
  let workdir = '';
  let box: SandboxBox;
  let holder: ChildProcess | null = null;
  const savedUser = process.env.BUILDERFORCE_SHELL_USER;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'bf-sandbox-uid-'));
    await chmod(workdir, 0o777); // the shell user owns the workspace in production; here the test made the directory
    process.env.BUILDERFORCE_SHELL_USER = testUser;
    box = createSandboxBox({ spec: {}, workdir, helperPath: WORKSPACE_HELPER });
  });

  afterEach(async () => {
    holder?.kill('SIGKILL');
    holder = null;
    await closeSandboxBox(box, { destroy: true });
    if (savedUser === undefined) delete process.env.BUILDERFORCE_SHELL_USER; else process.env.BUILDERFORCE_SHELL_USER = savedUser;
    await rm(workdir, { recursive: true, force: true });
  });

  it('a process whose INITIAL environment holds a secret answers "Permission denied" to the shell', async () => {
    // The secret is in the process's environ from exec (as the Actions runner's BUILDERFORCE_TOKEN is) —
    // not added to this test's own process.env afterwards, which /proc would not show.
    holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: { PATH: process.env.PATH, HOLDS_SECRET: 'initial-env-secret' }, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    expect(spawnSync('cat', [`/proc/${holder.pid}/environ`], { encoding: 'utf8' }).stdout).toContain('initial-env-secret'); // readable to us: the check is meaningful
    const r = await serveSandbox(box, '/sandbox/run', {
      command: `id -u; cat /proc/${holder.pid}/environ 2>&1 | head -c 300; head -c 1 /proc/${holder.pid}/mem 2>&1`,
    }) as { output: string };
    expect(Number(r.output.split('\n')[0])).not.toBe(process.getuid?.());
    expect(r.output).not.toContain('initial-env-secret');
    expect(r.output).toMatch(/Permission denied/);
  });

  it('a background job is the same user, and only the allowlisted env reaches it', async () => {
    const started = await serveSandbox(box, '/sandbox/job/start', { command: 'echo "$USER:${BUILDERFORCE_TOKEN:-none}"' }) as { id: string };
    const done = await serveSandbox(box, '/sandbox/job/poll', { id: started.id, waitMs: 10_000 }) as { output: string };
    expect(done.output.trim()).toBe(`${testUser}:none`);
  });

  it('the workspace helper runs as the shell user and owns what it creates', async () => {
    expect((await serveSandbox(box, '/sandbox/fs', { op: 'write', path: 'owned.txt', content: 'x' })).ok).toBe(true);
    const owner = spawnSync('stat', ['-c', '%U', join(workdir, 'owned.txt')], { encoding: 'utf8' }).stdout.trim();
    expect(owner).toBe(testUser);
  });
});
