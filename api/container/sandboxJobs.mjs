/**
 * The run sandbox's BACKGROUND jobs — what `run_command` `background` / `yieldMs`,
 * `command_status` and `command_stop` run on, in a cloud run.
 *
 * The table lives HERE, in the sandbox process, never in a Worker isolate: a cloud run
 * spans ticks, so a job started on one tick has to be pollable on the next. One table
 * belongs to one run's box (ids are `job-N` within it), and the box's close kills every
 * job in it — a job cannot outlive its run. A container that restarts loses its table;
 * a poll then answers status `unknown`, which the tools pass to the model.
 *
 * The semantics are the editor's (`clients/vscode/src/localShellJobs.ts`): output is a
 * bounded tail, `poll` may wait for the job to end, `kill` reaches the whole process tree.
 * A job has no timeout of its own — that is what makes it a background job.
 *
 * Plain ESM, node builtins only: the GitHub Actions runner inlines it verbatim beside
 * `sandboxCore.mjs` (`api/scripts/gen-sandbox-core-source.mjs`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { SHELL_CAPTURE_CHARS, keepTail } from './toolOutputPolicy.mjs';

/** Finished jobs kept for a late poll; past this the oldest finished go first. */
const MAX_JOBS = 32;
/** How long `kill` waits for the tree to report its exit before answering anyway. */
const KILL_SETTLE_MS = 3_000;

const unknownJob = (id) => ({
  ok: false,
  id,
  status: 'unknown',
  error: `no background job "${id}" in this run (the sandbox may have restarted, or the job ended with the run)`,
});

function statusOf(job) {
  return {
    ok: job.status === 'running' || (job.status === 'exited' && job.exitCode === 0),
    id: job.id,
    status: job.status,
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    output: job.output.trim(),
    ...(job.truncated ? { truncated: true } : {}),
  };
}
/**
 * What the MODEL'S shell inherits is an ALLOWLIST, not "everything but the known secrets": the sandbox process
 * itself holds credentials (the GitHub Actions runner authenticates back to Builderforce with BUILDERFORCE_TOKEN
 * and can mint more with the OIDC request token and URL), and a variable nobody thought to deny would leak. Both
 * shells (foreground in sandboxCore, background here) and the workspace helper use it.
 *
 * The CA-bundle variables are paths (egressTrust.mjs points git/curl/pip at the platform CA); they carry no secret.
 */
const SHELL_ENV_ALLOW = [
  /^(PATH|HOME|USER|LOGNAME|LANG|TERM|TZ|CI|NODE_EXTRA_CA_CERTS)$/,
  /^(SSL_CERT_FILE|GIT_SSL_CAINFO|CURL_CA_BUNDLE|REQUESTS_CA_BUNDLE|PIP_CERT)$/,
  /^LC_[A-Z_]+$/,
  /^npm_config_/,
  /^COREPACK_/,
];

/** Names a tenant must not pass through even on purpose: they would hand the model the run's own credentials. */
const SHELL_ENV_DENY = [
  /^BUILDERFORCE_/,
  /^ACTIONS_(ID_TOKEN_|RUNTIME_|CACHE_|RESULTS_)/,
  /^(GITHUB_TOKEN|GH_TOKEN|NODE_AUTH_TOKEN)$/,
];

/** `NODE_OPTIONS` that preloads code (`--require`, `--import`, a loader) could run the server's code path in the
 *  shell's node, so it is dropped; anything else (`--max-old-space-size=…`) passes. */
const NODE_OPTIONS_PRELOAD = /(^|\s)(--require|-r|--import|--loader|--experimental-loader)(\s|=|$)/;

/**
 * The environment a model-run shell gets from `env`: the allowlist, plus the names a tenant chose to expose in
 * `BUILDERFORCE_SHELL_ENV` (comma-separated, set in their workflow beside the secrets they want builds to see —
 * e.g. `BUILDERFORCE_SHELL_ENV: NPM_TOKEN,SENTRY_DSN`). Credential names ({@link SHELL_ENV_DENY}) are never passed through.
 */
export function shellEnv(env = process.env) {
  const exposed = new Set(String(env.BUILDERFORCE_SHELL_ENV || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)));
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    if (SHELL_ENV_DENY.some((re) => re.test(name))) continue;
    if (SHELL_ENV_ALLOW.some((re) => re.test(name)) || exposed.has(name)) out[name] = value;
  }
  if (typeof env.NODE_OPTIONS === 'string' && !NODE_OPTIONS_PRELOAD.test(env.NODE_OPTIONS)) out.NODE_OPTIONS = env.NODE_OPTIONS;
  return out;
}

/**
 * THE uid split. A shell running as the SAME uid as this process reads `/proc/<this pid>/environ` (the Actions
 * runner's BUILDERFORCE_TOKEN and OIDC request token) or `/proc/<pid>/mem`, and follows or swaps paths in the
 * files this process touches. So every model-run shell (foreground, background job, preview dev server) and the
 * workspace helper run as a different, unprivileged, sudo-less user with its OWN group, named by
 * `BUILDERFORCE_SHELL_USER`; the working tree belongs to that user and the server never touches it.
 *   • Cloudflare Container: created in the Dockerfile; the server (user `node`) may sudo to it and nothing else.
 *   • GitHub Actions: {@link provisionShellUser} creates it before the runner serves a request.
 * Unset (local dev, unit tests) ⇒ the shell runs as the server's own user. The name is read from the environment
 * (never from a request body) and validated, so it cannot carry an option or a command.
 */
export function shellUser(env = process.env) {
  const name = env.BUILDERFORCE_SHELL_USER;
  return typeof name === 'string' && /^[a-z_][a-z0-9_-]{0,31}$/.test(name) ? name : null;
}

const SHELL_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The argv and env that start `command` in a model-run shell: `{ file, args, env }`.
 * With a shell user: `sudo -n -u <user> env -i KEY=VAL… bash -lc '<command>'`, where KEY=VAL is exactly
 * {@link shellEnv} (+ `extraEnv`, the caller's own plan such as a preview's project env) re-homed to the user.
 * The env of the spawned `sudo` itself carries only PATH, so no run credential is ever in the environ of a
 * process the shell user could be confused with.
 */
export function shellInvocation(command, { env = process.env, user = shellUser(env), extraEnv = {} } = {}) {
  const base = { ...shellEnv(env), ...extraEnv };
  if (!user) return { file: 'bash', args: ['-lc', command], env: base };
  const forUser = { ...base, HOME: `/home/${user}`, USER: user, LOGNAME: user };
  const pairs = Object.entries(forUser)
    .filter(([name, value]) => SHELL_ENV_NAME.test(name) && typeof value === 'string' && !value.includes('\0'))
    .map(([name, value]) => `${name}=${value}`);
  return {
    file: 'sudo',
    args: ['-n', '-u', user, 'env', '-i', ...pairs, 'bash', '-lc', command],
    env: { PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
  };
}

/** Spawn a model-run shell command (detached: it leads its own process group). THE one spawn for every shell
 *  the model can influence — foreground, background job, preview server and the workspace helper come through here. */
export function spawnShell(command, { cwd, stdio, extraEnv, env = process.env } = {}) {
  const inv = shellInvocation(command, { env, extraEnv });
  return spawn(inv.file, inv.args, { cwd, env: inv.env, detached: true, ...(stdio ? { stdio } : {}) });
}

/** Run `args` as the shell user (a kill has to be delivered by the uid that owns the target). */
function asShellUser(user, args) {
  const p = spawn('sudo', ['-n', '-u', user, ...args], { stdio: 'ignore', env: { PATH: process.env.PATH || '/usr/bin:/bin' } });
  p.on('error', (e) => console.error(`[sandbox] could not signal the shell user's processes: ${e.message}`));
  p.unref();
}

/** SIGKILL the job's whole process group (it was spawned detached, so it leads one): a
 *  `bash -lc` child killed alone would leave its grandchildren running. With a shell user the
 *  group is another uid's, so the signal is delivered through sudo as that user. */
export function killTree(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  const user = shellUser();
  if (user && child.pid) asShellUser(user, ['kill', '-KILL', '--', `-${child.pid}`]);
}

/** Kill EVERY process the shell user owns — a daemon that escaped its process group (`setsid`) included. ONLY where
 *  one run owns the machine (the Actions runner sets `BUILDERFORCE_SHELL_SWEEP=1`): the container's preview and
 *  other runs' processes share the user and must survive a run's close. */
export function sweepShellProcesses() {
  const user = shellUser();
  if (user && process.env.BUILDERFORCE_SHELL_SWEEP === '1') asShellUser(user, ['kill', '-KILL', '--', '-1']);
}

/** Whether anything in the child's process group is still alive (signal 0 delivers nothing). EPERM means the
 *  group exists but belongs to the shell user — alive. */
function groupAlive(child) {
  try { process.kill(-child.pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; }
}

/** Run a file synchronously; a non-zero exit is a thrown, descriptive error (these are all fail-closed setup steps). */
function mustRun(file, args, what) {
  const r = spawnSync(file, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${what} (${file} exited ${r.status}): ${String(r.stderr || r.stdout || r.error || '').trim().slice(0, 300)}`);
  return String(r.stdout || '');
}

/**
 * Prove the shell user is isolated, AS that user. Every line must hold or the sandbox refuses to serve:
 * it cannot write the Docker socket (root by another name), cannot sudo, cannot read this process's environ
 * or its parent's, and can write the workspace. Also verifies the account itself has only its own group.
 * Throws a descriptive error naming the failed check.
 */
export function verifyShellIsolation({ user, workdir }) {
  const groups = mustRun('id', ['-Gn', user], `could not read ${user}'s groups`).trim().split(/\s+/);
  if (groups.length !== 1 || groups[0] !== user) throw new Error(`the shell user must belong only to its own group; ${user} is in: ${groups.join(' ')}`);
  const script = [
    'if test -w /var/run/docker.sock; then echo "can write /var/run/docker.sock"; exit 11; fi',
    'if sudo -n true >/dev/null 2>&1; then echo "can sudo"; exit 12; fi',
    `if cat /proc/${process.pid}/environ >/dev/null 2>&1; then echo "can read the sandbox server's environ"; exit 13; fi`,
    'if cat /proc/$PPID/environ >/dev/null 2>&1; then echo "can read its parent environ"; exit 14; fi',
    'if ! test -w "$1"; then echo "cannot write the workspace"; exit 15; fi',
  ].join('\n');
  const r = spawnSync('sudo', ['-n', '-u', user, 'env', '-i', `PATH=${process.env.PATH || '/usr/bin:/bin'}`, 'bash', '-c', script, 'bash', workdir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the run shell is not isolated (${user}): ${String(r.stdout || r.stderr || r.error || `exit ${r.status}`).trim().slice(0, 300)}`);
}

/**
 * GitHub Actions: make the run's shell user. The runner (uid `runner`, passwordless sudo) creates `user` with its
 * OWN group — never the runner's, which on a hosted runner can be `docker` (root through the socket) — and NO sudo
 * rights, installs a validated sudoers drop-in that turns sudo's pty off (so a kill reaches the process group),
 * hands the checkout to the user, and then PROVES the isolation ({@link verifyShellIsolation}). Fails CLOSED. An
 * account that already exists must already be safe, or this refuses.
 */
export function provisionShellUser({ user, workdir }) {
  const owner = userInfo().username;
  const exists = spawnSync('id', ['-u', user], { stdio: 'ignore' }).status === 0;
  if (exists) {
    const listing = mustRun('sudo', ['-n', '-l', '-U', user], `could not read ${user}'s sudo rights`);
    if (!/is not allowed to run sudo/.test(listing)) throw new Error(`the existing user ${user} has sudo rights; refusing to run the shell as it`);
  } else {
    mustRun('sudo', ['-n', 'useradd', '--create-home', '--shell', '/bin/bash', '--user-group', user], `could not create ${user}`);
  }
  const dropIn = '/etc/sudoers.d/zz-bf-agent';
  const staging = '/etc/sudoers.d/.zz-bf-agent.new'; // sudo ignores names with a dot: never loaded half-written
  mustRun('sudo', ['-n', 'sh', '-c', 'set -e; printf "Defaults:%s !use_pty\\n" "$1" > "$2"; chmod 0440 "$2"; visudo -cf "$2"; mv -f "$2" "$3"', 'sh', owner, staging, dropIn], 'could not install the sudoers drop-in');
  mustRun('sudo', ['-n', 'chown', '-R', `${user}:${user}`, workdir], 'could not hand the checkout to the shell user');
  verifyShellIsolation({ user, workdir });
  return user;
}

/**
 * GitHub Actions: give the checkout back to the runner and drop `.git` before the job's later steps (the
 * checkout post-step runs git over it) — `.git` is the shell's by then and its config/hooks are not to be trusted.
 * Call after every shell process is dead.
 */
export function releaseShellWorkspace({ workdir }) {
  const owner = userInfo().username;
  mustRun('sudo', ['-n', 'sh', '-c', 'set -e; rm -rf -- "$1/.git"; chown -R "$2" "$1"', 'sh', workdir, owner], 'could not release the workspace');
}


/** A prefix for one sandbox boot's job ids. Ids restart at `job-1` in a fresh table, so a
 *  poll from before a restart would otherwise read a DIFFERENT job under the same id. */
export function bootJobIdPrefix() {
  return `${Math.random().toString(36).slice(2, 8)}-`;
}

/**
 * One run's job table. `maxWaitMs` bounds a poll's wait (the foreground command ceiling);
 * `idPrefix` (default none) is put before `job-N` in every id.
 */
export function createJobTable({ maxWaitMs, idPrefix = '' }) {
  const table = new Map();
  /** Every job's process group leader, for the life of the table. NOT evicted with the
   *  job record, and kept after the job reads `exited`: `nohup srv &` ends its bash while
   *  `srv` runs on, and `kill` / `closeAll` must still reach it. */
  const groups = new Set();
  let seq = 0;

  function evictFinished() {
    for (const [id, job] of table) {
      if (table.size < MAX_JOBS) return;
      if (job.status !== 'running') table.delete(id);
    }
  }

  /** Start `command` in `cwd` (already resolved inside the clone). */
  function start(command, cwd) {
    evictFinished();
    if (table.size >= MAX_JOBS) return { ok: false, error: `too many running background jobs (${MAX_JOBS}); stop one with command_stop first` };
    const id = `${idPrefix}job-${++seq}`;
    const child = spawnShell(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let settle;
    const job = { id, child, status: 'running', output: '', truncated: false, done: new Promise((r) => { settle = r; }) };
    const cap = (chunk) => {
      const next = job.output + chunk;
      if (next.length > SHELL_CAPTURE_CHARS.container) job.truncated = true;
      job.output = keepTail(next, SHELL_CAPTURE_CHARS.container);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const finish = (code) => {
      if (job.status === 'running') job.status = 'exited';
      job.exitCode = code ?? -1;
      settle();
    };
    child.on('close', (code) => {
      finish(code);
      // Nothing left in the group ⇒ stop tracking it, so a recycled pid is never signalled.
      if (!groupAlive(child)) groups.delete(child);
    });
    child.on('error', (e) => { cap(`\n${e.message}`); finish(null); });
    table.set(id, job);
    groups.add(child);
    return { ok: true, id };
  }

  /** A job's state, after waiting up to `waitMs` for it to end. `onAbort(wake)` lets the
   *  transport end the WAIT early when the engine gives up on the request (the job runs on). */
  async function poll(id, waitMs, onAbort = () => {}) {
    const job = table.get(id);
    if (!job) return unknownJob(id);
    const wait = Number.isFinite(waitMs) && waitMs > 0 ? Math.min(waitMs, maxWaitMs) : 0;
    if (job.status === 'running' && wait > 0) {
      let timer;
      let release;
      const aborted = new Promise((resolve) => { release = onAbort(resolve); });
      await Promise.race([job.done, aborted, new Promise((r) => { timer = setTimeout(r, wait); })]);
      clearTimeout(timer);
      if (typeof release === 'function') release();
    }
    return statusOf(job);
  }

  /** Kill a job's process tree and report how it ended (waits briefly for the exit). A job
   *  that already read `exited` is still signalled: its group may hold a daemon it left
   *  behind. Its status stays `exited` — only a job that was running reads `killed`. */
  async function kill(id) {
    const job = table.get(id);
    if (!job) return unknownJob(id);
    const wasRunning = job.status === 'running';
    if (wasRunning) job.status = 'killed';
    // Only a group still tracked: `close` drops one that emptied, and its pid may be reused.
    if (groups.has(job.child)) killTree(job.child);
    groups.delete(job.child);
    if (wasRunning) {
      let timer;
      await Promise.race([job.done, new Promise((r) => { timer = setTimeout(r, KILL_SETTLE_MS); })]);
      clearTimeout(timer);
    }
    return { ...statusOf(job), ...(job.status === 'killed' ? { error: 'stopped' } : {}) };
  }

  /** Kill every job and every group a job left behind — the run is over. */
  async function closeAll() {
    await Promise.all([...table.values()].filter((j) => j.status === 'running').map((j) => kill(j.id)));
    for (const child of groups) killTree(child);
    groups.clear();
  }

  /** Whether any job is still running — what keeps an idle container alive. */
  function hasRunning() {
    for (const job of table.values()) if (job.status === 'running') return true;
    return false;
  }

  return { start, poll, kill, closeAll, hasRunning };
}
