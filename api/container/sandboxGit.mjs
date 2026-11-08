/**
 * The sandbox's git, through a PRIVATE MIRROR.
 *
 * Design rule: the server process — which holds the run's token — never runs git in, reads, writes or follows
 * paths inside the workspace the model's shell controls (its `.git/config`, hooks, symlinks are the model's).
 * Secrets meet git in exactly one place: a bare mirror the server owns (mode 0700, outside the workspace), where
 * the only authenticated network git runs, with an explicit minimal env, no system/global config, hooks disabled,
 * https only, and the token as a per-process `http.<url>.extraHeader`.
 *
 *   IN   server fetches into the mirror → writes a `git bundle` into a handoff dir the shell user can READ but
 *        not change → the workspace helper (as the shell user) clones or fetches from that file.
 *   OUT  the helper (as the shell user) makes a bundle of the branch → the server imports it into the mirror
 *        (which never runs workspace hooks) → pushes from the mirror, scoped by the Worker to the run's branch.
 *
 * Plain ESM, node builtins only (the Actions runner inlines it). The workspace side is `workspaceAgent.mjs`.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TRUSTED_PATH, shellUser, trustedBinary } from './sandboxJobs.mjs';

/** A clone or fetch of a large repository may legitimately take minutes. */
const GIT_TIMEOUT_MS = 10 * 60 * 1000;

/** The only names the mirror's git inherits: where to find git and the egress-interception CA, never a credential. */
const MIRROR_ENV_PASSTHROUGH = ['LANG', 'TZ', 'SSL_CERT_FILE', 'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'];

/** A git-safe ref name, or null. */
export function safeRef(v) {
  return typeof v === 'string' && /^[\w./@-]+$/.test(v) && !v.includes('..') && !v.startsWith('-') ? v : null;
}

/**
 * Where, and as whom, THIS process talks git to the Worker's container-git proxy: the credential-free
 * `spec.repo.cloneUrl` and the run's token (`spec.token`). Null when the spec names no remote.
 */
export function gitAuthOf(spec) {
  const url = spec && spec.repo && typeof spec.repo.cloneUrl === 'string' ? spec.repo.cloneUrl : null;
  if (!url) return null;
  return { url, token: typeof spec.token === 'string' && spec.token ? spec.token : null };
}

/** The proxy is reached over https only: a token on a plain-http request would cross the network in the clear. */
function requireHttps(url) {
  if (!/^https:\/\//i.test(String(url))) throw new Error('refusing to talk git over a non-https remote');
}

/**
 * The argv, env and cwd of ONE git command in `dir` (a mirror, or a checkout nobody else can write yet). The env is
 * built name by name — never a spread of `process.env` — with no system or global config, hooks disabled and the
 * `file` transport refused. With `auth`, the remote must be https and the token rides only in this process's
 * `GIT_CONFIG_*` (an `http.<url>.extraHeader`): not in argv (`/proc/<pid>/cmdline` is world-readable), a URL or a file.
 */
export function mirrorGitCommand(dir, args, auth = null, source = process.env) {
  const config = [];
  if (auth) {
    requireHttps(auth.url);
    if (auth.token) config.push([`http.${auth.url}.extraHeader`, `Authorization: Basic ${Buffer.from(`x-access-token:${auth.token}`).toString('base64')}`]);
  }
  const env = {};
  for (const name of MIRROR_ENV_PASSTHROUGH) if (typeof source[name] === 'string') env[name] = source[name];
  // git's own lookups (a transport helper, a credential helper) resolve from the fixed trusted list, never the inherited PATH.
  if (process.platform === 'win32') { if (typeof source.PATH === 'string') env.PATH = source.PATH; } else env.PATH = TRUSTED_PATH;
  Object.assign(env, { HOME: dirname(dir), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: String(config.length) });
  config.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
  return { args: ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', ...args], env, cwd: dir };
}

/** Run a {@link mirrorGitCommand}. The credential is masked out of whatever git prints. */
function execGit(cmd, token = null) {
  return new Promise((resolve) => {
    execFile(trustedBinary('git'), cmd.args, { cwd: cmd.cwd, env: cmd.env, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      const output = `${stdout}${stderr}`;
      resolve({ exitCode, output: token ? output.split(token).join('***') : output });
    });
  });
}

/** One sandbox's mirror. Created empty (nothing on disk until the first git op needs it). */
export function createMirror(spec) {
  return { auth: gitAuthOf(spec), privateDir: null, repo: null, handoffDir: null, handoffGroup: null, seq: 0, tips: new Map(), chain: Promise.resolve() };
}

/** Serialise operations on one mirror: two overlapping fetch/bundle/push sequences would trample each other. */
function exclusive(m, fn) {
  const run = m.chain.then(fn, fn);
  m.chain = run.catch(() => undefined);
  return run;
}

async function prepare(m) {
  if (m.repo) return;
  m.privateDir = await mkdtemp(join(tmpdir(), 'bf-mirror-')); // 0700: the shell user cannot enter it
  m.repo = join(m.privateDir, 'repo.git');
  const init = await execGit(mirrorGitCommand(m.privateDir, ['init', '-q', '--bare', m.repo]));
  if (init.exitCode !== 0) throw new Error(`could not create the git mirror: ${init.output.trim().slice(-200)}`);
  // The handoff dir is where bundles are put for the shell user to read: it can list and read them, never write.
  m.handoffDir = await mkdtemp(join(tmpdir(), 'bf-handoff-'));
  m.handoffGroup = await restrictToShellGroup(m.handoffDir);
}

/**
 * Hand `dir` to the shell user's GROUP (0750: owner = this process, group = shell user, nobody else). Without a
 * shell user nothing else reads it: 0700. When the group cannot be assigned (this process is not a member of it, so
 * `chgrp` is refused) it falls back to world-readable 0755 and says so: the contents are repository data the shell
 * user can read anyway. Returns the group name bundles must be given too, or null.
 */
async function restrictToShellGroup(dir) {
  const group = shellUser();
  if (!group) { await chmod(dir, 0o700); return null; }
  const done = await new Promise((resolve) => execFile(trustedBinary('chgrp'), [group, dir], { env: { PATH: TRUSTED_PATH } }, (error) => resolve(!error)));
  if (done) { await chmod(dir, 0o750); return group; }
  console.error(`[sandbox] could not give ${dir} to group ${group}; the handoff directory stays world-readable`);
  await chmod(dir, 0o755);
  return null;
}

/** Make a handoff file readable by the shell user's group (0640), or world-readable when the group could not be assigned. */
async function releaseHandoffFile(m, file) {
  if (m.handoffGroup) {
    const done = await new Promise((resolve) => execFile(trustedBinary('chgrp'), [m.handoffGroup, file], { env: { PATH: TRUSTED_PATH } }, (error) => resolve(!error)));
    if (done) { await chmod(file, 0o640); return; }
  }
  await chmod(file, m.handoffGroup || !shellUser() ? 0o640 : 0o644);
}

/** Remove the mirror and the handoff dir (the run is over). */
export async function disposeMirror(m) {
  await Promise.all([m.privateDir, m.handoffDir].filter(Boolean).map((d) => rm(d, { recursive: true, force: true })));
  m.privateDir = m.repo = m.handoffDir = null;
}

const mirrorGit = (m, args, { network = false } = {}) => execGit(mirrorGitCommand(m.repo, args, network ? m.auth : null), network && m.auth ? m.auth.token : null);

/** Fetch each branch from the remote into the mirror; the ones that exist are `fetched`. */
async function fetchBranches(m, branches) {
  const fetched = [];
  const failed = [];
  for (const b of branches) {
    const r = await mirrorGit(m, ['fetch', '-q', '--no-tags', m.auth.url, `+refs/heads/${b}:refs/heads/${b}`], { network: true });
    if (r.exitCode === 0) fetched.push(b); else failed.push({ branch: b, output: r.output.trim().slice(-200) });
  }
  return { fetched, failed };
}

const tipOf = async (m, ref) => {
  const r = await mirrorGit(m, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  return r.exitCode === 0 ? r.output.trim() : null;
};

/** The `git bundle create` argv for `branches`, leaving out what the other side already holds (`basis`: branch → sha). */
export function bundleCreateArgs(file, branches, basis = {}) {
  return ['bundle', 'create', file, ...branches.map((b) => `refs/heads/${b}`), ...branches.filter((b) => basis[b]).map((b) => `^${basis[b]}`)];
}

/** A bundle of `branches` in the handoff dir (readable by the shell user), leaving out what it already holds (`basis`: branch → sha). */
async function bundleBranches(m, branches, basis = {}) {
  const file = join(m.handoffDir, `${++m.seq}.bundle`);
  const made = await mirrorGit(m, bundleCreateArgs(file, branches, basis));
  if (made.exitCode !== 0) return { ok: false, error: `could not bundle: ${made.output.trim().slice(-200)}` };
  await releaseHandoffFile(m, file);
  return { ok: true, file };
}

/**
 * Open the workspace: fetch the ticket branch (falling back to base on run #1) into the mirror, bundle it, and have the
 * workspace helper clone from the bundle with `origin` set to the credential-free remote. Full history (no `--depth`):
 * a shallow clone had no merge-base with the base branch, so `git_sync_latest` / `git diff main` could not work.
 */
export function cloneWorkspace(box) {
  const m = box.mirror;
  return exclusive(m, async () => {
    if (!m.auth) return { ok: false, branch: null, output: 'no repository to clone' };
    const head = safeRef(box.spec.repo.headBranch);
    const base = safeRef(box.spec.repo.baseBranch);
    await prepare(m);
    const { fetched, failed } = await fetchBranches(m, [...new Set([head, base].filter(Boolean))]);
    if (!fetched.length) return { ok: false, branch: null, output: failed.map((f) => `${f.branch}: ${f.output}`).join('; ') || 'no branch to clone' };
    const checkout = head && fetched.includes(head) ? head : fetched[0];
    const bundle = await bundleBranches(m, fetched);
    if (!bundle.ok) return { ok: false, branch: null, output: bundle.error };
    const cloned = await box.workspace.call({ op: 'clone', bundle: bundle.file, branch: checkout, remote: m.auth.url });
    await rm(bundle.file, { force: true });
    if (!cloned.ok) return { ok: false, branch: null, output: cloned.error ?? 'clone failed' };
    for (const b of fetched) m.tips.set(b, await tipOf(m, `refs/heads/${b}`));
    return { ok: true, branch: checkout, output: '' };
  });
}

/**
 * Bring `branches` up to date in the workspace's `refs/remotes/origin/*`: the mirror fetches from the remote, and the
 * helper fetches the (incremental, when it can) bundle. This is `git fetch origin <branches>` for a clone that has no
 * credential and no network of its own. `{ ok, fetched, error? }`.
 */
export function syncWorkspace(box, branches) {
  const m = box.mirror;
  return exclusive(m, async () => {
    if (!m.auth) return { ok: false, fetched: [], error: 'no remote to sync with' };
    const wanted = [...new Set(branches.map(safeRef).filter(Boolean))];
    if (!wanted.length) return { ok: false, fetched: [], error: 'no branch to sync' };
    await prepare(m);
    const { fetched, failed } = await fetchBranches(m, wanted);
    if (!fetched.length) return { ok: false, fetched: [], error: failed.map((f) => `${f.branch}: ${f.output}`).join('; ') };
    const tips = new Map();
    for (const b of fetched) tips.set(b, await tipOf(m, `refs/heads/${b}`));
    // Only what moved needs sending; a branch the workspace already has at its tip is skipped.
    const moved = fetched.filter((b) => tips.get(b) && tips.get(b) !== m.tips.get(b));
    if (moved.length) {
      for (const incremental of [true, false]) {
        const basis = incremental ? Object.fromEntries(moved.filter((b) => m.tips.get(b)).map((b) => [b, m.tips.get(b)])) : {};
        const bundle = await bundleBranches(m, moved, basis);
        if (!bundle.ok) return { ok: false, fetched, error: bundle.error };
        const imported = await box.workspace.call({ op: 'fetch', bundle: bundle.file, refs: moved });
        await rm(bundle.file, { force: true });
        if (imported.ok) break;
        if (!incremental) return { ok: false, fetched, error: imported.error ?? 'could not fetch into the workspace' };
      }
    }
    for (const [b, sha] of tips) m.tips.set(b, sha);
    return { ok: true, fetched };
  });
}

/** Fast-forward the workspace to the run branch as the remote holds it. True when it now matches. */
export async function absorbHead(box) {
  const head = safeRef(box.spec.repo && box.spec.repo.headBranch);
  if (!head) return false;
  const synced = await syncWorkspace(box, [head]);
  if (!synced.ok || !synced.fetched.includes(head)) return false;
  return (await box.workspace.call({ op: 'absorb', branch: head })).ok === true;
}

/** A bundle from the workspace helper (base64) past ~2 GiB decoded is refused before it is written to disk. */
const MAX_BUNDLE_BASE64_CHARS = Math.ceil((2 * 1024 * 1024 * 1024 * 4) / 3);

/** A full object id from the workspace helper (sha1 or sha256 repository): validated before it reaches `rev-parse` / `update-ref`. */
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Import `refs/heads/<head>` from a bundle FILE the server chose into the mirror: `git bundle verify` (its prerequisites
 * are present and it is well-formed), `git bundle unbundle` (which stores the objects and prints `<sha> <ref>`), then
 * `update-ref` with the sha it reported. The bundle comes from the shell user, so it is not run through the `fetch`
 * transport (which the mirror's `protocol.file.allow=never` refuses, and which should stay refused for everything else).
 * `{ ok: true, sha }` or `{ ok: false, error }`.
 */
export async function importBundle(m, file, head) {
  const verified = await mirrorGit(m, ['bundle', 'verify', file]);
  if (verified.exitCode !== 0) return { ok: false, error: verified.output.trim().slice(-200) };
  const unbundled = await mirrorGit(m, ['-c', 'transfer.fsckObjects=true', 'bundle', 'unbundle', file]);
  if (unbundled.exitCode !== 0) return { ok: false, error: unbundled.output.trim().slice(-200) };
  const line = unbundled.output.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === `refs/heads/${head}`);
  const sha = line && line[0];
  if (!sha || !GIT_OBJECT_ID.test(sha)) return { ok: false, error: `the bundle does not carry refs/heads/${head}` };
  const moved = await mirrorGit(m, ['update-ref', `refs/heads/${head}`, sha]);
  return moved.exitCode === 0 ? { ok: true, sha } : { ok: false, error: moved.output.trim().slice(-200) };
}

/**
 * Publish the workspace's checked-out run branch (`git push origin HEAD`, which the clone cannot do itself): the helper
 * bundles it, the server imports the bundle into the mirror and pushes from there. `force` is for a rewind
 * (`git_undo` / `git_redo`) and is a lease on the tip just fetched. The Worker's proxy accepts a push to this run's branch only.
 */
export function publishHead(box, { force = false } = {}) {
  const m = box.mirror;
  return exclusive(m, async () => {
    if (!m.auth) return { ok: false, error: 'no remote to publish to' };
    const head = safeRef(box.spec.repo && box.spec.repo.headBranch);
    if (!head) return { ok: false, error: 'this run has no branch to publish to' };
    const at = await box.workspace.call({ op: 'head' });
    if (!at.ok) return { ok: false, error: at.error ?? 'could not read the workspace HEAD' };
    if (at.branch !== head) return { ok: false, error: `the clone is on '${at.branch}', not the run's branch '${head}'; refusing to publish` };
    if (typeof at.sha !== 'string' || !GIT_OBJECT_ID.test(at.sha)) return { ok: false, error: 'the workspace HEAD is not a commit id' };
    await prepare(m);
    const { fetched } = await fetchBranches(m, [head]);
    const remoteTip = fetched.length ? await tipOf(m, `refs/heads/${head}`) : null;
    if (remoteTip === at.sha) return { ok: true, output: 'already up to date' };
    if (await tipOf(m, at.sha)) {
      const moved = await mirrorGit(m, ['update-ref', `refs/heads/${head}`, at.sha]);
      if (moved.exitCode !== 0) return { ok: false, error: moved.output.trim().slice(-200) };
    } else {
      const out = await box.workspace.call({ op: 'bundleOut', branch: head, basis: remoteTip });
      if (!out.ok) return { ok: false, error: out.error ?? 'could not bundle the branch' };
      if (typeof out.bundle !== 'string' || out.bundle.length > MAX_BUNDLE_BASE64_CHARS) return { ok: false, error: 'the branch bundle is missing or over the size limit' };
      const file = join(m.privateDir, `out-${++m.seq}.bundle`);
      await writeFile(file, Buffer.from(out.bundle, 'base64'), { mode: 0o600 });
      const imported = await importBundle(m, file, head);
      await rm(file, { force: true });
      if (!imported.ok) return { ok: false, error: `the branch bundle did not import: ${imported.error}` };
    }
    const lease = force && remoteTip ? [`--force-with-lease=refs/heads/${head}:${remoteTip}`] : [];
    const pushed = await mirrorGit(m, ['push', '-q', ...lease, m.auth.url, `refs/heads/${head}:refs/heads/${head}`], { network: true });
    if (pushed.exitCode !== 0) return { ok: false, error: `push refused: ${pushed.output.trim().slice(-300)}` };
    return { ok: true, output: `published ${head}` };
  });
}

/** `git config --unset-all` answers 5 for "that key is not set": the expected state, not a failure. */
const GIT_CONFIG_KEY_NOT_SET = 5;

/**
 * Remove the credential `actions/checkout` persists into `.git/config` (`http.https://github.com/.extraheader`) from a
 * checkout made by an OLDER tenant workflow that lacks `persist-credentials: false`, before any request is served. Run
 * ONCE, before the checkout is handed to the shell user (it is still only ours then), with the same locked-down git env
 * as the mirror. `{ ok: false, output }` when git could not run the command; an absent key is the normal case.
 */
export async function scrubCheckoutCredentials(workdir) {
  const fixed = await execGit(mirrorGitCommand(workdir, ['config', '--local', '--unset-all', 'http.https://github.com/.extraheader']));
  if (fixed.exitCode !== 0 && fixed.exitCode !== GIT_CONFIG_KEY_NOT_SET) return { ok: false, output: fixed.output };
  // Any OTHER host's extraheader, and any `include`/`includeIf` (which can pull a credential-bearing file into the config),
  // go too. `-z` separates entries with NUL (`key\nvalue`), so a value with spaces cannot be mistaken for a key.
  const found = await execGit(mirrorGitCommand(workdir, ['config', '--local', '-z', '--get-regexp', '^(includeif\\..*|include\\.path|http\\..*extraheader)$']));
  if (found.exitCode === 1) return { ok: true }; // no match
  if (found.exitCode !== 0) return { ok: false, output: found.output };
  const keys = [...new Set(found.output.split('\0').map((entry) => entry.split('\n')[0]).filter(Boolean))];
  for (const key of keys) {
    const r = await execGit(mirrorGitCommand(workdir, ['config', '--local', '--unset-all', key]));
    if (r.exitCode !== 0 && r.exitCode !== GIT_CONFIG_KEY_NOT_SET) return { ok: false, output: r.output };
  }
  return { ok: true };
}
