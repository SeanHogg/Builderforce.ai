/**
 * The sandbox server's git (`container/sandboxGit.mjs`): the server holds the run's token and never runs git in the
 * workspace, so authenticated git runs only in a private mirror, built by `mirrorGitCommand`. These pin what that
 * command is — and is not.
 */
import { describe, expect, it } from 'vitest';
import { bundleCreateArgs, gitAuthOf, mirrorGitCommand } from '../../../container/sandboxCore.mjs';

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
