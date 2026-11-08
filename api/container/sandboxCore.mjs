/**
 * THE run sandbox — one implementation of the primitives a cloud run's engine calls on
 * its working tree, served over TWO transports:
 *
 *   • the Cloudflare Container (`server.mjs`): HTTP `/sandbox/*`, proxied by
 *     AgentContainerDO, over a clone this process made;
 *   • the GitHub Actions runner (`githubActionsRunner.ts` inlines this file): it long-polls
 *     the run's CloudRunnerDO for the engine's next request, over the checkout
 *     `actions/checkout` made — a runner cannot receive a call, so it fetches them.
 *
 * Neither transport runs a loop or decides anything: the ONE engine (`cloudAgentEngine.ts`)
 * owns the loop, the tools, the commits, verify and finalize. This file owns only what a
 * Worker physically cannot do — a shell, a working tree, the project's own checks.
 *
 * THE RULE this file keeps: this process holds the run's secrets, so it never reads, writes,
 * lists or runs git inside the working tree (which the model's shell controls). The tree
 * belongs to the shell user, every file/git operation on it goes through the workspace helper
 * (`workspaceAgent.mjs`, run as that user, reached by `workspaceClient.mjs`), and authenticated
 * git runs only in a private mirror (`sandboxGit.mjs`).
 *
 * Plain ESM. Its only imports are node builtins and its siblings (the generated tool-output
 * policy, the post-edit checks, the background-job table, the workspace client, the mirror),
 * so the Actions runner can inline it verbatim (`api/scripts/gen-sandbox-core-source.mjs`).
 */
import { join, relative, sep } from 'node:path';
import { SHELL_CAPTURE_CHARS, fitToolText, keepTail, toolOutputCap } from './toolOutputPolicy.mjs';
import { cloneCheckIo, createPostEditChecks } from './postEditChecks.mjs';
import { bootJobIdPrefix, createJobTable, isolationProbe, killTree, provisionShellUser, releaseShellWorkspace, shellEnv, shellInvocation, shellUser, spawnShell, sweepShellProcesses, teardownShellSync, TRUSTED_PATH, trustedBinary, verifyShellIsolation } from './sandboxJobs.mjs';
import { createWorkspaceClient } from './workspaceClient.mjs';
import { absorbHead, bundleCreateArgs, cloneWorkspace, createMirror, disposeMirror, gitAuthOf, importBundle, mirrorGitCommand, publishHead, safeRef, scrubCheckoutCredentials, syncWorkspace } from './sandboxGit.mjs';

export { absorbHead, bundleCreateArgs, cloneWorkspace, gitAuthOf, importBundle, mirrorGitCommand, provisionShellUser, releaseShellWorkspace, scrubCheckoutCredentials, shellEnv, shellInvocation, shellUser, spawnShell, sweepShellProcesses, teardownShellSync, isolationProbe, TRUSTED_PATH, trustedBinary, verifyShellIsolation };

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000; // a build/test step may legitimately take minutes

/** Whether the C7 lever is on for this run — decided by the Worker (it owns the tenant
 *  and the env) and carried on the open spec. Absent ⇒ off. */
function toolOutputPolicyOn(spec) {
  return spec.toolOutputPolicy === true;
}

/** A command's output as the model sees it: head+tail with an elision marker (the
 *  verdict prints last), or, with the C7 lever on, the failure summary. */
function commandOutput(spec, tool, output) {
  return fitToolText(output, toolOutputCap(tool), { tool, summarize: toolOutputPolicyOn(spec) });
}

/** After a kill, how long `runShell` waits for the shell to report its exit before it
 *  answers anyway: a descendant that escaped the process group (`setsid`) keeps the output
 *  pipes open, and without this the request would hang on it. */
const SHELL_SETTLE_MS = 2_000;

/** Run a shell command in `cwd`, capturing combined stdout/stderr and the exit code. The
 *  shell leads its own process group, so a timeout or cancel kills the WHOLE tree (a hung
 *  `npm test` is a grandchild of `bash`), and the call always settles shortly after.
 *  `proc` (optional) is a holder whose `.current` is set to a handle (`kill`) so a closed
 *  `/sandbox/run` request (the engine's cancel) can stop it. */
function runShell(command, cwd, proc, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawnShell(command, { cwd });
    let out = '';
    const cap = (chunk) => { out = keepTail(out + chunk, SHELL_CAPTURE_CHARS.container); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    let timedOut = false;
    let settled = false;
    let settleTimer;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      if (proc && proc.current === handle) proc.current = null;
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ ...result, timedOut });
    };
    // The shell has ended (its own exit, or the kill): give the pipes a moment to drain, then
    // answer with its real exit code even if a descendant (`sleep 900 &`) still holds them.
    let exitCode = -1;
    const settleSoon = () => { settleTimer ??= setTimeout(() => done({ exitCode, output: out }), SHELL_SETTLE_MS); };
    const stop = () => {
      killTree(child);
      settleSoon();
    };
    const handle = { kill: stop };
    if (proc) proc.current = handle;
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.on('exit', (code) => { exitCode = code ?? -1; settleSoon(); });
    child.on('close', (code) => done({ exitCode: code ?? -1, output: out }));
    child.on('error', (e) => done({ exitCode: -1, output: `${out}\n${e.message}` }));
  });
}

/** The D7 post-edit checks over the clone (their events reach the run's timeline). The checks' reads of the tree
 *  (marker files, package.json scripts) go through the workspace helper like every other read. */
function startPostEditChecks(box) {
  const { workdir, workspace } = box;
  const bins = new Map();
  const hasBin = (name) => {
    if (!bins.has(name)) bins.set(name, runShell(`command -v ${name} >/dev/null 2>&1`, workdir, null, 10_000).then((r) => r.exitCode === 0));
    return bins.get(name);
  };
  const rel = (abs) => relative(workdir, abs).split(sep).join('/');
  const treeIo = {
    access: async (abs) => {
      const r = await workspace.call({ op: 'stat', path: rel(abs) });
      if (!r.ok || !r.exists) throw new Error('absent');
    },
    readFile: async (abs) => {
      const r = await workspace.call({ op: 'read', path: rel(abs) });
      if (!r.ok) throw new Error(r.error);
      return r.content;
    },
    hasBin,
  };
  return createPostEditChecks({
    workdir,
    run: (command, cwd, timeoutMs) => runShell(command, cwd, null, timeoutMs),
    io: cloneCheckIo(workdir, treeIo),
    // Accepted split: output is elided HERE (container, head+tail cut) and again by the Worker's tool-output policy.
    // Redaction happens at the Worker's writers (`insertToolAudit`, the stream publish), not here: the container
    // holds no policy about secrets, only the bytes, and the cut never exposes more than the uncut text would.
    fit: (output) => fitToolText(output, toolOutputCap('run_command'), { tool: 'run_command', summarize: true }),
    onEvent: (e) => box.emit('runtime.post_edit_check', e, `${e.check}${e.cwd ? ` (${e.cwd})` : ''}: ${e.skipped ? `skipped (${e.skipped})` : e.timedOut ? 'timed out' : `exit ${e.exitCode}`}`),
  });
}

/**
 * Absorb a change the engine already COMMITTED to the ticket branch (through the Worker's git provider, which owns
 * the lease, the outbound inspection and the file-change ledger): fast-forward the clone to that branch, so the
 * commit is real history here and `git_undo` / `git_redo` / `git_sync_latest` act on it instead of on a dirty tree.
 * The fetch runs through the private mirror and reaches the clone as a bundle. True when the file now holds
 * `content` (null ⇒ is gone); false ⇒ the caller writes it directly (a conflicting local edit, an unreachable remote).
 */
async function absorbCommit(box, path, content) {
  if (!(await absorbHead(box))) return false;
  if (content === null) {
    const gone = await box.workspace.call({ op: 'stat', path });
    return gone.ok === true && gone.exists === false;
  }
  const now = await box.workspace.call({ op: 'read', path });
  return now.ok === true && now.content === content;
}

/** An fs request the helper may serve: only these ops, only these fields (the body is the engine's, but the helper is not a generic RPC). */
const FS_OPS = new Set(['list', 'read', 'write', 'delete']);

async function sandboxFs(box, body) {
  const op = body.op;
  if (!FS_OPS.has(op)) return { ok: false, error: `unknown fs op '${op}'` };
  if (op === 'list' || op === 'read') return box.workspace.call({ op, path: body.path, glob: body.glob });
  const committable = typeof body.path === 'string' && (op === 'delete' || typeof body.content === 'string');
  if (body.committed === true && committable && await absorbCommit(box, body.path, op === 'delete' ? null : body.content)) {
    box.checks?.touch(body.path);
    return { ok: true, path: body.path };
  }
  const r = await box.workspace.call({ op, path: body.path, content: body.content });
  if (r.ok) box.checks?.touch(body.path);
  return r;
}

/** The directory a command runs in: the clone's root when `cwd` is absent, else that
 *  repo-relative directory. `{ error }` when it escapes the clone or is not a directory. */
async function commandDir(box, cwd) {
  if (cwd == null || cwd === '' || cwd === '.') return { dir: box.workdir };
  const st = await box.workspace.call({ op: 'stat', path: cwd });
  if (!st.ok) return { error: 'cwd must be a directory inside the repository' };
  return st.isDir ? { dir: join(box.workdir, String(cwd).replace(/^\/+/, '')) } : { error: `cwd '${cwd}' is not a directory in the repository` };
}

/** A foreground command runs in the clone's root: the engine writes any directory into the
 *  command itself (`posixCommandIn`). Only background jobs take a `cwd` (`sandboxJobStart`). */
async function sandboxRun(box, body, onAbort) {
  const command = typeof body.command === 'string' ? body.command : '';
  if (!command) return { ok: false, error: 'command is required' };
  // The engine giving up on the command (a cancel) kills it.
  const proc = { current: null };
  const release = onAbort(() => { if (proc.current) proc.current.kill('SIGKILL'); });
  // The engine may bound a command below the ceiling (the run-end verify's budget).
  const timeoutMs = Number.isFinite(body.timeoutMs) && body.timeoutMs > 0 ? Math.min(body.timeoutMs, COMMAND_TIMEOUT_MS) : COMMAND_TIMEOUT_MS;
  const r = await runShell(command, box.workdir, proc, timeoutMs);
  if (typeof release === 'function') release();
  return { ok: r.exitCode === 0, exitCode: r.exitCode, timedOut: r.timedOut, output: commandOutput(box.spec, 'run_command', r.output) };
}

/** Start a background command; `poll` / `kill` then address it by the returned id. */
async function sandboxJobStart(box, body) {
  const command = typeof body.command === 'string' ? body.command : '';
  if (!command.trim()) return { ok: false, error: 'command is required' };
  const where = await commandDir(box, body.cwd);
  return where.error ? { ok: false, error: where.error } : box.jobs.start(command, where.dir);
}

/** The verdict over the edits since the last drain (`{ passed, verifier, reason?, steer? }`,
 *  the steer being the failures only), or null when nothing was judged. The engine's loop
 *  guards decide what the model reads and what the cascade folds. */
async function sandboxChecks(box) {
  if (!box.checks) return { ok: true, verdict: null };
  try {
    const v = await box.checks.drainVerdict();
    return { ok: true, verdict: v ? { passed: v.passed, verifier: v.verifier, ...(v.reason ? { reason: v.reason } : {}), ...(v.steer ? { steer: v.steer } : {}) } : null };
  } catch (e) {
    box.emit('runtime.post_edit_check', { error: true }, `post-edit checks failed to run: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: true, verdict: null };
  }
}

/**
 * The git verbs a clone with no credential and no network of its own cannot do for itself (`git_sync_latest`,
 * `git_undo`, `git_redo`): `sync` brings the run branch and the base branch into the clone's `origin/*`; `publish`
 * pushes the clone's run branch. Both go through the private mirror (`sandboxGit.mjs`).
 */
async function sandboxGitOp(box, body) {
  const repo = box.spec.repo || {};
  if (body.op === 'sync') {
    const head = safeRef(repo.headBranch);
    const base = safeRef(body.base) ?? safeRef(repo.baseBranch);
    const synced = await syncWorkspace(box, [head, base].filter(Boolean));
    if (!synced.ok) return { ok: false, error: synced.error };
    if (base && !synced.fetched.includes(base)) return { ok: false, error: `the base branch '${base}' was not found on the remote` };
    return { ok: true, ...(base ? { base } : {}) };
  }
  if (body.op === 'publish') return publishHead(box, { force: body.force === true });
  return { ok: false, error: `unknown git op '${body.op}'` };
}

/**
 * One run's sandbox over `workdir`. `emit(toolName, detail, result)` reports a local
 * service's event to the run's timeline (each transport posts it its own way). `helperPath` is
 * the workspace helper script (a file this process owns and the shell user can read but not change; REQUIRED —
 * the container passes its sibling `workspaceAgent.mjs`, the Actions runner a file it wrote).
 */
export function createSandboxBox({ spec, workdir, branch = null, emit = () => {}, jobIdPrefix = '', helperPath }) {
  if (typeof helperPath !== 'string' || !helperPath) throw new Error('createSandboxBox needs the workspace helper path (workspaceAgent.mjs)');
  const box = {
    spec, workdir, branch, emit, checks: null,
    jobs: createJobTable({ maxWaitMs: COMMAND_TIMEOUT_MS, idPrefix: jobIdPrefix }),
    workspace: createWorkspaceClient({ workdir, helperPath }),
    mirror: createMirror(spec),
  };
  if (spec.postEditChecks === true) box.checks = startPostEditChecks(box);
  return box;
}

/** The run is over: kill every background job THIS box tracks (never the shell user's other processes — a live preview
 *  outlives its run), optionally delete the workspace, and release the helper and the mirror. Each transport calls this
 *  from its close path, so no job outlives its run. */
export async function closeSandboxBox(box, { destroy = false } = {}) {
  await box.jobs.closeAll();
  if (destroy) await box.workspace.call({ op: 'destroy' });
  box.workspace.close();
  await disposeMirror(box.mirror);
}

/** A job reply's `output` fitted like a foreground command's, so the verdict (printed last)
 *  survives the model's cap instead of being cut with the head of a 60K tail. */
function fitJobOutput(box, reply) {
  return typeof reply.output === 'string' && reply.output ? { ...reply, output: commandOutput(box.spec, 'run_command', reply.output) } : reply;
}

/**
 * Serve one sandbox request on `box`: `fs` / `run` / `checks` / `job/*` / `git`. `onAbort(kill)`
 * lets the transport kill a running command (or end a job poll's wait) when the engine
 * gives up on the request (a cancel).
 */
export async function serveSandbox(box, path, body, onAbort = () => {}) {
  if (path === '/sandbox/fs') return sandboxFs(box, body);
  if (path === '/sandbox/run') return sandboxRun(box, body, onAbort);
  if (path === '/sandbox/checks') return sandboxChecks(box);
  if (path === '/sandbox/git') return sandboxGitOp(box, body);
  if (path === '/sandbox/job/start') return sandboxJobStart(box, body);
  if (path === '/sandbox/job/poll') return fitJobOutput(box, await box.jobs.poll(String(body.id ?? ''), body.waitMs, onAbort));
  if (path === '/sandbox/job/active') return { ok: true, active: box.jobs.hasRunning() };
  if (path === '/sandbox/job/kill') return fitJobOutput(box, await box.jobs.kill(String(body.id ?? '')));
  return { ok: false, error: `unknown sandbox request '${path}'` };
}

export { runShell, bootJobIdPrefix };
