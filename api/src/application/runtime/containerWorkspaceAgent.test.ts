/**
 * The workspace helper (`container/workspaceAgent.mjs`): the only code that touches a run's working tree. The
 * server asks it, over newline-delimited JSON, for every file and git operation, and it runs as the shell user.
 *
 *  • the protocol: unknown ops, path refusal (escapes, `.git`, symlink aliases), mode-preserving writes;
 *  • git IN and OUT over bundles (real `git`): clone from a bundle with a credential-free `origin`, an incremental
 *    fetch, a fast-forward absorb, and a bundle of the workspace's new commit back out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleCreateArgs } from '../../../container/sandboxCore.mjs';
import { createWorkspace, serveWorkspace } from '../../../container/workspaceAgent.mjs';

const posix = process.platform !== 'win32';
const hasGit = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

let root = '';
let workdir = '';
const ws = () => createWorkspace(workdir);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bf-workspace-agent-'));
  workdir = join(root, 'wd');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('the workspace helper protocol', () => {
  it('answers one JSON line per request, echoing its id', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    serveWorkspace(ws(), input, output);
    const replies: Array<Record<string, unknown>> = [];
    output.on('data', (chunk: Buffer) => { for (const line of chunk.toString().split('\n').filter(Boolean)) replies.push(JSON.parse(line)); });
    input.write(`${JSON.stringify({ id: 7, op: 'init' })}\n${JSON.stringify({ id: 8, op: 'write', path: 'a.txt', content: 'hi' })}\n${JSON.stringify({ id: 9, op: 'nope' })}\n`);
    await new Promise((r) => setTimeout(r, 300));
    expect(replies.find((r) => r.id === 7)).toMatchObject({ ok: true });
    expect(replies.find((r) => r.id === 8)).toMatchObject({ ok: true, path: 'a.txt' });
    expect(replies.find((r) => r.id === 9)).toMatchObject({ ok: false, error: expect.stringContaining("unknown workspace op 'nope'") });
    expect(await readFile(join(workdir, 'a.txt'), 'utf8')).toBe('hi');
    input.end();
  });

  it('refuses every path that leaves the repository or reaches .git — for each file op', async () => {
    const w = ws();
    await w.handle({ op: 'init' });
    await mkdir(join(workdir, '.git'));
    await writeFile(join(workdir, '.git', 'config'), '[core]\n');
    await writeFile(join(root, 'outside.txt'), 'TOP-SECRET');
    if (posix) {
      await symlink(join(root, 'outside.txt'), join(workdir, 'leak'));
      await symlink('.git', join(workdir, 'g'));
    }
    const bad = ['../outside.txt', 'a/../../outside.txt', '.git/config', '.git/hooks/pre-commit', ...(posix ? ['leak', 'g/config'] : [])];
    for (const path of bad) {
      for (const op of ['read', 'write', 'delete', 'stat', 'mkdir']) {
        const r = await w.handle({ op, path, content: 'pwned' });
        expect(r.ok, `${op} ${path}`).toBe(false);
      }
    }
    expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('TOP-SECRET');
    expect(await readFile(join(workdir, '.git', 'config'), 'utf8')).toBe('[core]\n');
  });

  it.skipIf(!posix)('keeps a file\'s mode on write, and replaces a read-only file through a temp file', async () => {
    const w = ws();
    await w.handle({ op: 'init' });
    await w.handle({ op: 'write', path: 'run.sh', content: '#!/bin/sh\necho 1\n' });
    await chmod(join(workdir, 'run.sh'), 0o755);
    await w.handle({ op: 'write', path: 'run.sh', content: '#!/bin/sh\necho 2\n' });
    expect((await stat(join(workdir, 'run.sh'))).mode & 0o777).toBe(0o755);
    expect(await readFile(join(workdir, 'run.sh'), 'utf8')).toContain('echo 2');

    await chmod(join(workdir, 'run.sh'), 0o444);
    const replaced = await w.handle({ op: 'write', path: 'run.sh', content: '#!/bin/sh\necho 3\n' });
    expect(replaced.ok).toBe(true);
    expect(await readFile(join(workdir, 'run.sh'), 'utf8')).toContain('echo 3');
    // A read-only mode survives a rewrite (as root the in-place open succeeds, which keeps it too).
    expect((await stat(join(workdir, 'run.sh'))).mode & 0o777).toBe(0o444);
  });

  it('refuses to write through a symlink at the final component', async () => {
    if (!posix) return;
    const w = ws();
    await w.handle({ op: 'init' });
    await symlink(join(workdir, 'later.txt'), join(workdir, 'inner'));
    expect((await w.handle({ op: 'write', path: 'inner', content: 'x' })).ok).toBe(false);
  });

  it('appends the preview files to .git/info/exclude once', async () => {
    const w = ws();
    await w.handle({ op: 'init' });
    await mkdir(join(workdir, '.git', 'info'), { recursive: true });
    await w.handle({ op: 'exclude', paths: ['vite.preview.config.ts'] });
    await w.handle({ op: 'exclude', paths: ['vite.preview.config.ts', 'b.js'] });
    expect((await readFile(join(workdir, '.git', 'info', 'exclude'), 'utf8')).split('\n').filter(Boolean)).toEqual(['vite.preview.config.ts', 'b.js']);
  });
});

/** Run git in `cwd`; throws on failure so a broken fixture fails loudly. */
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

describe.skipIf(!hasGit || !posix)('git in and out of the workspace over bundles', () => {
  it('clones from a bundle with a credential-free origin, fetches incrementally, fast-forwards, and bundles a new commit back out', async () => {
    const src = join(root, 'src');
    await mkdir(src);
    git(src, 'init', '-q', '-b', 'main');
    await writeFile(join(src, 'f.txt'), '1');
    git(src, 'add', '.');
    git(src, 'commit', '-q', '-m', 'one');
    git(src, 'branch', 'bf/5');

    // IN: clone the run branch (and base) from one bundle.
    const full = join(root, 'full.bundle');
    git(src, ...bundleCreateArgs(full, ['bf/5', 'main']));
    const w = ws();
    await w.handle({ op: 'init' });
    const remote = 'https://api.example.test/api/runtime/internal/container-git/5.git';
    expect(await w.handle({ op: 'clone', bundle: full, branch: 'bf/5', remote })).toMatchObject({ ok: true });
    expect(git(workdir, 'config', 'remote.origin.url')).toBe(remote);
    expect(git(workdir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('bf/5');
    expect(git(workdir, 'rev-parse', 'refs/remotes/origin/main')).toBe(git(src, 'rev-parse', 'main'));

    // IN again: only the new commit travels (the basis is what the workspace already has), then fast-forward.
    const old = git(src, 'rev-parse', 'bf/5');
    git(src, 'checkout', '-q', 'bf/5');
    await writeFile(join(src, 'f.txt'), '2');
    git(src, 'commit', '-q', '-am', 'two');
    const next = git(src, 'rev-parse', 'bf/5');
    const delta = join(root, 'delta.bundle');
    const args = bundleCreateArgs(delta, ['bf/5'], { 'bf/5': old });
    expect(args).toEqual(['bundle', 'create', delta, 'refs/heads/bf/5', `^${old}`]);
    git(src, ...args);
    expect(await w.handle({ op: 'fetch', bundle: delta, refs: ['bf/5'] })).toMatchObject({ ok: true });
    expect(git(workdir, 'rev-parse', 'refs/remotes/origin/bf/5')).toBe(next);
    expect(await w.handle({ op: 'absorb', branch: 'bf/5' })).toMatchObject({ ok: true });
    expect(git(workdir, 'rev-parse', 'HEAD')).toBe(next);

    // OUT: a commit made in the workspace comes back as a bundle that verifies against the server's side.
    await writeFile(join(workdir, 'g.txt'), 'new');
    git(workdir, 'add', '.');
    git(workdir, 'commit', '-q', '-m', 'three');
    const head = await w.handle({ op: 'head' }) as { ok: boolean; branch: string; sha: string };
    expect(head).toMatchObject({ ok: true, branch: 'bf/5', sha: git(workdir, 'rev-parse', 'HEAD') });
    const out = await w.handle({ op: 'bundleOut', branch: 'bf/5', basis: next }) as { ok: boolean; bundle: string };
    expect(out.ok).toBe(true);
    const outFile = join(root, 'out.bundle');
    await writeFile(outFile, Buffer.from(out.bundle, 'base64'));
    git(src, 'bundle', 'verify', outFile); // throws unless the bundle is complete against what the server holds
    git(src, 'fetch', '-q', outFile, '+refs/heads/bf/5:refs/heads/imported');
    expect(git(src, 'rev-parse', 'imported')).toBe(head.sha);
  });

  it('refuses git ops with an unsafe branch or basis', async () => {
    const w = ws();
    await w.handle({ op: 'init' });
    expect((await w.handle({ op: 'clone', bundle: '/x', branch: '--upload-pack=x', remote: 'https://x' })).ok).toBe(false);
    expect((await w.handle({ op: 'fetch', bundle: '/x', refs: ['a..b'] })).ok).toBe(false);
    expect((await w.handle({ op: 'bundleOut', branch: 'main', basis: 'not-a-sha' })).ok).toBe(false);
  });
});
