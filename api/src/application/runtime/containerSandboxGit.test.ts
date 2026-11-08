/**
 * The sandbox server's git (`container/sandboxGit.mjs`): the server holds the run's token and never runs git in the
 * workspace, so authenticated git runs only in a private mirror, built by `mirrorGitCommand`. These pin what that
 * command is — and is not.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleCreateArgs, gitAuthOf, importBundle, mirrorGitCommand } from '../../../container/sandboxCore.mjs';
import { createWorkspace } from '../../../container/workspaceAgent.mjs';

const URL_ = 'https://api.example.test/api/runtime/internal/container-git/42.git';
const parent = {
  PATH: '/usr/bin:/bin', LANG: 'C', GIT_SSL_CAINFO: '/bundle.crt', HTTPS_PROXY: 'http://proxy.test:3128',
  HOME: '/home/node', USER: 'node',
  BUILDERFORCE_TOKEN: 'run-secret', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-secret', GITHUB_TOKEN: 'ghs-secret', SOME_OTHER: 'other',
  GIT_DIR: '/etc', GIT_CONFIG_GLOBAL: '/home/node/.gitconfig', GIT_ASKPASS: '/evil',
};

describe('mirrorGitCommand', () => {
  const cmd = mirrorGitCommand('/tmp/bf-mirror-x/repo.git', ['fetch', '-q', URL_, '+refs/heads/b:refs/heads/b'], { url: URL_, token: 'tok-123' }, parent);

  it('builds its env name by name — never a spread of the process env', () => {
    expect(Object.keys(cmd.env).filter((k) => !k.startsWith('GIT_CONFIG_KEY_') && !k.startsWith('GIT_CONFIG_VALUE_')).sort()).toEqual([
      'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_SSL_CAINFO', 'GIT_TERMINAL_PROMPT', 'HOME', 'HTTPS_PROXY', 'LANG', 'PATH',
    ]);
    const all = JSON.stringify(cmd.env);
    for (const secret of ['run-secret', 'oidc-secret', 'ghs-secret', 'other', '/evil', '/etc']) expect(all).not.toContain(secret);
    expect(cmd.env.GIT_CONFIG_GLOBAL).toBe('/dev/null'); // not the parent's ~/.gitconfig
    expect(cmd.env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(cmd.env.HOME).not.toBe('/home/node');
  });

  it('disables hooks and the file transport, and runs in the mirror', () => {
    expect(cmd.args.slice(0, 4)).toEqual(['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never']);
    expect(cmd.args.slice(4)).toEqual(['fetch', '-q', URL_, '+refs/heads/b:refs/heads/b']);
    expect(cmd.cwd).toBe('/tmp/bf-mirror-x/repo.git');
  });

  it('puts the token in a per-process http.<url>.extraHeader and nowhere else — not argv, not a URL', () => {
    expect(cmd.env.GIT_CONFIG_COUNT).toBe('1');
    expect(cmd.env.GIT_CONFIG_KEY_0).toBe(`http.${URL_}.extraHeader`);
    expect(cmd.env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from('x-access-token:tok-123').toString('base64')}`);
    expect(cmd.args.join(' ')).not.toContain('tok-123');
    expect(cmd.args.join(' ')).not.toContain(Buffer.from('x-access-token:tok-123').toString('base64'));
    expect(cmd.args.join(' ')).not.toMatch(/\/\/[^/]*@/);
  });

  it('refuses a non-https remote when authenticating', () => {
    expect(() => mirrorGitCommand('/m', ['fetch'], { url: 'http://api.example.test/x.git', token: 't' }, parent)).toThrow(/non-https/);
    expect(() => mirrorGitCommand('/m', ['fetch'], { url: 'git://x/y.git', token: 't' }, parent)).toThrow(/non-https/);
    expect(() => mirrorGitCommand('/m', ['fetch'], { url: 'file:///etc', token: null }, parent)).toThrow(/non-https/);
  });

  it('carries no credential config at all for a local command (init, bundle, update-ref)', () => {
    const local = mirrorGitCommand('/m', ['bundle', 'create', '/h/1.bundle', 'refs/heads/b'], null, parent);
    expect(local.env.GIT_CONFIG_COUNT).toBe('0');
    expect(Object.keys(local.env).some((k) => k.startsWith('GIT_CONFIG_KEY_'))).toBe(false);
  });
});

describe('bundleCreateArgs', () => {
  it('bundles each branch, excluding what the other side already holds', () => {
    expect(bundleCreateArgs('/h/1.bundle', ['bf/5', 'main'])).toEqual(['bundle', 'create', '/h/1.bundle', 'refs/heads/bf/5', 'refs/heads/main']);
    expect(bundleCreateArgs('/h/2.bundle', ['bf/5', 'main'], { 'bf/5': 'a'.repeat(40) })).toEqual(
      ['bundle', 'create', '/h/2.bundle', 'refs/heads/bf/5', 'refs/heads/main', `^${'a'.repeat(40)}`],
    );
  });
});

describe('gitAuthOf', () => {
  it('is the credential-free remote and the run token, or null with no remote', () => {
    expect(gitAuthOf({ repo: { cloneUrl: URL_ }, token: 'tok' })).toEqual({ url: URL_, token: 'tok' });
    expect(gitAuthOf({ repo: { cloneUrl: URL_ } })).toEqual({ url: URL_, token: null });
    expect(gitAuthOf({})).toBeNull();
    expect(gitAuthOf({ repo: {} })).toBeNull();
  });
});

describe('the mirror\'s PATH', () => {
  it('is the fixed trusted list, not the inherited one (a writable directory on the server\'s PATH cannot plant `git`)', () => {
    const cmd = mirrorGitCommand('/m', ['init'], null, { PATH: '/tmp/evil:/usr/bin' });
    if (process.platform === 'win32') return;
    expect(cmd.env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
  });
});

const hasGit = spawnSync('git', ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
const posix = process.platform !== 'win32';

/** Plain git in `cwd` (a fixture: throws so a broken setup fails loudly). Bounded: it can never hang the run. */
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], { cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

describe.skipIf(!hasGit || !posix)('publishing a new commit: workspace bundle -> mirror import (real git)', () => {
  let root = '';
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });

  async function fixture() {
    root = await mkdtemp(join(tmpdir(), 'bf-import-'));
    const workdir = join(root, 'ws');
    git(root, 'init', '-q', '-b', 'bf/5', workdir);
    await writeFile(join(workdir, 'f.txt'), '1');
    git(workdir, 'add', '.');
    git(workdir, 'commit', '-q', '-m', 'one');
    const base = git(workdir, 'rev-parse', 'HEAD');
    // The mirror, as the server has it after fetching the run branch: a bare repo holding only `base`.
    const privateDir = join(root, 'private');
    git(root, 'init', '-q', '--bare', join(privateDir, 'repo.git'));
    git(workdir, 'push', '-q', join(privateDir, 'repo.git'), 'bf/5:refs/heads/bf/5');
    return { workdir, base, m: { repo: join(privateDir, 'repo.git'), privateDir, auth: null } };
  }

  it('imports a bundle of a NEW commit (the file transport is refused for fetch, so this is bundle verify + unbundle) and moves the ref to its sha', async () => {
    const { workdir, base, m } = await fixture();
    await writeFile(join(workdir, 'f.txt'), '2');
    git(workdir, 'commit', '-q', '-am', 'two');
    const next = git(workdir, 'rev-parse', 'HEAD');

    const w = createWorkspace(workdir);
    const out = await w.handle({ op: 'bundleOut', branch: 'bf/5', basis: base }) as { ok: boolean; bundle: string };
    expect(out.ok).toBe(true);
    const file = join(m.privateDir, 'out-1.bundle');
    await writeFile(file, Buffer.from(out.bundle, 'base64'), { mode: 0o600 });

    const imported = await importBundle(m, file, 'bf/5');
    expect(imported).toEqual({ ok: true, sha: next });
    expect(git(m.repo, 'rev-parse', 'refs/heads/bf/5')).toBe(next);
    expect(next).not.toBe(base);
  }, 60_000);

  it('refuses a bundle whose prerequisite the mirror does not hold, and one that lacks the branch', async () => {
    const { workdir, m } = await fixture();
    await writeFile(join(workdir, 'f.txt'), '2');
    git(workdir, 'commit', '-q', '-am', 'two');
    const two = git(workdir, 'rev-parse', 'HEAD');
    await writeFile(join(workdir, 'f.txt'), '3');
    git(workdir, 'commit', '-q', '-am', 'three');

    const w = createWorkspace(workdir);
    // Basis = a commit the mirror never received: `verify` fails, nothing is imported.
    const incomplete = await w.handle({ op: 'bundleOut', branch: 'bf/5', basis: two });
    expect(incomplete.ok).toBe(true);
    const incompleteBundle = incomplete.bundle;
    if (typeof incompleteBundle !== 'string') throw new Error('bundleOut returned no bundle');
    const f1 = join(m.privateDir, 'out-1.bundle');
    await writeFile(f1, Buffer.from(incompleteBundle, 'base64'), { mode: 0o600 });
    expect((await importBundle(m, f1, 'bf/5')).ok).toBe(false);

    // A complete bundle of a different branch: it does not carry the run branch.
    git(workdir, 'branch', 'other');
    const full = join(m.privateDir, 'out-2.bundle');
    git(workdir, 'bundle', 'create', full, 'refs/heads/other');
    const wrong = await importBundle(m, full, 'bf/5');
    expect(wrong).toMatchObject({ ok: false, error: expect.stringContaining('refs/heads/bf/5') });
    expect(git(m.repo, 'rev-parse', 'refs/heads/bf/5')).not.toBe(git(workdir, 'rev-parse', 'HEAD'));
  }, 60_000);
});
