/**
 * The container fs op's path guard (`insideClone` in `container/sandboxCore.mjs`): nothing a
 * run asks the `/sandbox/fs` op for may read, write, delete or list outside the clone —
 * `../` escapes, absolute paths, a symlink planted inside the clone, Windows-style `..\`
 * and URL-encoded segments. Real directories, real symlinks (POSIX only).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeSandboxBox, createSandboxBox, serveSandbox, shellEnv, type SandboxBox } from '../../../container/sandboxCore.mjs';

const posix = process.platform !== 'win32';

let root = '';
let workdir = '';
let outside = '';
let box: SandboxBox;

beforeEach(async () => {
  if (!posix) return;
  root = await mkdtemp(join(tmpdir(), 'bf-sandbox-fs-'));
  workdir = join(root, 'clone');
  outside = join(root, 'outside');
  await mkdir(workdir, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET');
  box = createSandboxBox({ spec: {}, workdir });
});

afterEach(async () => {
  if (!posix) return;
  await closeSandboxBox(box);
  await rm(root, { recursive: true, force: true });
});

const fs = (body: Record<string, unknown>) => serveSandbox(box, '/sandbox/fs', body) as Promise<{ ok: boolean; content?: string; error?: string }>;

describe.skipIf(!posix)('sandbox fs path guard', () => {
  it('refuses ../ escapes for read, write, delete and list', async () => {
    for (const path of ['../outside/secret.txt', 'a/../../outside/secret.txt', '../../../../etc/passwd']) {
      expect((await fs({ op: 'read', path })).ok).toBe(false);
      expect((await fs({ op: 'write', path, content: 'pwned' })).ok).toBe(false);
      expect((await fs({ op: 'delete', path })).ok).toBe(false);
    }
    expect((await fs({ op: 'list', path: '../outside' })).ok).toBe(false);
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('TOP-SECRET');
  });

  it('treats an absolute path as clone-relative, never the host path', async () => {
    const r = await fs({ op: 'read', path: join(outside, 'secret.txt') });
    expect(r.ok).toBe(false);
    const w = await fs({ op: 'write', path: join(outside, 'new.txt'), content: 'x' });
    expect(w.ok).toBe(true);
    expect(existsSync(join(outside, 'new.txt'))).toBe(false);
    expect(existsSync(join(workdir, outside, 'new.txt'))).toBe(true);
  });

  it('refuses a DANGLING symlink whose target is outside the clone (write, read, delete)', async () => {
    const target = join(outside, 'not-yet.txt');
    await symlink(target, join(workdir, 'dangling'));
    await symlink(join(outside, 'newdir', 'deep.txt'), join(workdir, 'dangling-deep'));
    expect((await fs({ op: 'write', path: 'dangling', content: 'pwned' })).ok).toBe(false);
    expect((await fs({ op: 'write', path: 'dangling-deep', content: 'pwned' })).ok).toBe(false);
    expect((await fs({ op: 'read', path: 'dangling' })).ok).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(outside, 'newdir'))).toBe(false);
  });

  it('refuses a chain of dangling links (and a link loop) without escaping or hanging', async () => {
    await symlink(join(outside, 'chain.txt'), join(workdir, 'hop2'));
    await symlink(join(workdir, 'hop2'), join(workdir, 'hop1'));
    await symlink('loop-b', join(workdir, 'loop-a'));
    await symlink('loop-a', join(workdir, 'loop-b'));
    expect((await fs({ op: 'write', path: 'hop1', content: 'pwned' })).ok).toBe(false);
    expect((await fs({ op: 'write', path: 'loop-a', content: 'x' })).ok).toBe(false);
    expect(existsSync(join(outside, 'chain.txt'))).toBe(false);
  });

  it('does not write through a dangling link that stays inside the clone', async () => {
    await symlink(join(workdir, 'later.txt'), join(workdir, 'inner-dangling'));
    const r = await fs({ op: 'write', path: 'inner-dangling', content: 'x' });
    // Pinned: the final component is opened without following symlinks, so the write is refused and nothing is created.
    expect(r.ok).toBe(false);
    expect(existsSync(join(workdir, 'later.txt'))).toBe(false);
    expect(existsSync(join(outside, 'later.txt'))).toBe(false);
  });

  it('refuses a write and a delete whose PARENT directory is a symlink to outside', async () => {
    await writeFile(join(outside, 'victim.txt'), 'keep');
    await symlink(outside, join(workdir, 'parent-link'));
    expect((await fs({ op: 'write', path: 'parent-link/victim.txt', content: 'pwned' })).ok).toBe(false);
    expect((await fs({ op: 'delete', path: 'parent-link/victim.txt' })).ok).toBe(false);
    expect(await readFile(join(outside, 'victim.txt'), 'utf8')).toBe('keep');
  });

  it('returns ok:false (never throws) when the parent is a file or the target is a directory', async () => {
    await writeFile(join(workdir, 'afile'), 'x');
    await mkdir(join(workdir, 'adir'));
    expect((await fs({ op: 'write', path: 'afile/child.txt', content: 'x' })).ok).toBe(false);
    expect((await fs({ op: 'write', path: 'adir', content: 'x' })).ok).toBe(false);
    expect((await fs({ op: 'delete', path: 'adir' })).ok).toBe(false);
  });

  it('refuses everything under .git (read, write, delete, list, job cwd)', async () => {
    await mkdir(join(workdir, '.git', 'hooks'), { recursive: true });
    await writeFile(join(workdir, '.git', 'config'), '[core]');
    for (const path of ['.git/config', '.git/hooks/pre-commit', 'sub/.git/x']) {
      expect((await fs({ op: 'read', path })).ok).toBe(false);
      expect((await fs({ op: 'write', path, content: '#!/bin/sh' })).ok).toBe(false);
      expect((await fs({ op: 'delete', path })).ok).toBe(false);
    }
    expect((await fs({ op: 'list', path: '.git' })).ok).toBe(false);
    const job = (await serveSandbox(box, '/sandbox/job/start', { command: 'pwd', cwd: '.git' })) as { ok: boolean };
    expect(job.ok).toBe(false);
    expect(existsSync(join(workdir, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(await readFile(join(workdir, '.git', 'config'), 'utf8')).toBe('[core]');
    // A file merely NAMED like git is fine.
    expect((await fs({ op: 'write', path: 'gitignore-notes.txt', content: 'ok' })).ok).toBe(true);
  });

  it('refuses a job whose cwd is a symlink to a directory outside the clone', async () => {
    await symlink(outside, join(workdir, 'cwd-link'));
    const r = (await serveSandbox(box, '/sandbox/job/start', { command: 'pwd', cwd: 'cwd-link' })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inside the repository/);
    const dots = (await serveSandbox(box, '/sandbox/job/start', { command: 'pwd', cwd: '../outside' })) as { ok: boolean };
    expect(dots.ok).toBe(false);
  });

  it('refuses to read or write through a symlink that points outside the clone', async () => {
    await symlink(join(outside, 'secret.txt'), join(workdir, 'link-file'));
    await symlink(outside, join(workdir, 'link-dir'));
    expect((await fs({ op: 'read', path: 'link-file' })).ok).toBe(false);
    expect((await fs({ op: 'read', path: 'link-dir/secret.txt' })).ok).toBe(false);
    expect((await fs({ op: 'write', path: 'link-dir/planted.txt', content: 'pwned' })).ok).toBe(false);
    expect((await fs({ op: 'write', path: 'link-dir/new/deep.txt', content: 'pwned' })).ok).toBe(false);
    expect((await fs({ op: 'delete', path: 'link-dir/secret.txt' })).ok).toBe(false);
    expect((await fs({ op: 'list', path: 'link-dir' })).ok).toBe(false);
    expect(existsSync(join(outside, 'planted.txt'))).toBe(false);
    expect(existsSync(join(outside, 'new'))).toBe(false);
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('TOP-SECRET');
  });

  it('allows a symlink that stays inside the clone, and ordinary nested paths', async () => {
    await mkdir(join(workdir, 'src'), { recursive: true });
    await writeFile(join(workdir, 'src', 'a.txt'), 'inside');
    await symlink(join(workdir, 'src'), join(workdir, 'alias'));
    expect(await fs({ op: 'read', path: 'alias/a.txt' })).toMatchObject({ ok: true, content: 'inside' });
    expect((await fs({ op: 'write', path: 'deep/new/file.txt', content: 'ok' })).ok).toBe(true);
    expect(await readFile(join(workdir, 'deep/new/file.txt'), 'utf8')).toBe('ok');
  });

  it('Windows-style ..\\ and URL-encoded segments are literal names and cannot escape', async () => {
    for (const path of ['..\\outside\\secret.txt', '%2e%2e/outside/secret.txt', '..%2foutside%2fsecret.txt', '%2e%2e%2f%2e%2e%2fetc%2fpasswd']) {
      expect((await fs({ op: 'read', path })).ok).toBe(false);
      await fs({ op: 'write', path, content: 'x' });
    }
    expect(existsSync(join(root, 'secret.txt'))).toBe(false);
    expect(existsSync(join(outside, 'x'))).toBe(false);
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('TOP-SECRET');
  });

  it('rejects an empty or non-string path', async () => {
    for (const path of ['', '   ', undefined, 7]) {
      expect((await fs({ op: 'read', path })).ok).toBe(false);
    }
  });
});

describe.skipIf(!posix)('the model shell environment', () => {
  const secrets = {
    BUILDERFORCE_TOKEN: 'bf-oidc-token',
    BUILDERFORCE_API: 'https://api.example',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req-token',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example',
    ACTIONS_RUNTIME_TOKEN: 'runtime-token',
    GITHUB_TOKEN: 'ghs-token',
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => { for (const [k, v] of Object.entries(secrets)) { saved[k] = process.env[k]; process.env[k] = v; } });
  afterEach(() => { for (const k of Object.keys(secrets)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('shellEnv drops the credential variables and keeps the rest', () => {
    const env = shellEnv({ ...secrets, PATH: '/usr/bin', HOME: '/home/a', NODE_ENV: 'test' });
    expect(Object.keys(env).sort()).toEqual(['HOME', 'NODE_ENV', 'PATH']);
  });

  it('a command the model runs cannot read them (foreground and background)', async () => {
    const run = (await serveSandbox(box, '/sandbox/run', { command: 'env' }, () => () => {})) as { output: string };
    expect(run.output).toContain('PATH=');
    for (const v of Object.values(secrets)) expect(run.output).not.toContain(v);
    const started = (await serveSandbox(box, '/sandbox/job/start', { command: 'env' })) as { id: string };
    const done = (await serveSandbox(box, '/sandbox/job/poll', { id: started.id, waitMs: 10_000 })) as { output: string };
    for (const v of Object.values(secrets)) expect(done.output).not.toContain(v);
  });
});
