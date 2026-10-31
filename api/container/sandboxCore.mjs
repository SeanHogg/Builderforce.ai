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
 * Plain ESM. Its only imports are node builtins and its siblings (the generated tool-output
 * policy, the post-edit checks, the background-job table), so the Actions runner can inline
 * it verbatim (`api/scripts/gen-sandbox-core-source.mjs`).
 */
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, dirname, relative, resolve as resolvePath, sep } from 'node:path';
import { SHELL_CAPTURE_CHARS, fitToolText, keepTail, toolOutputCap } from './toolOutputPolicy.mjs';
import { cloneCheckIo, createPostEditChecks } from './postEditChecks.mjs';
import { createJobTable } from './sandboxJobs.mjs';

const MAX_LIST_ENTRIES = 500;
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

/** Run a shell command in `cwd`, capturing combined stdout/stderr and the exit code.
 *  `proc` (optional) is a holder whose `.current` is set to the live child so a closed
 *  `/sandbox/run` request (the engine's cancel) can SIGKILL it. */
function runShell(command, cwd, proc, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], { cwd, env: process.env });
    if (proc) proc.current = child;
    let out = '';
    const cap = (chunk) => { out = keepTail(out + chunk, SHELL_CAPTURE_CHARS.container); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const done = (result) => { clearTimeout(timer); if (proc && proc.current === child) proc.current = null; resolve({ ...result, timedOut }); };
    child.on('close', (code) => done({ exitCode: code ?? -1, output: out }));
    child.on('error', (e) => done({ exitCode: -1, output: `${out}\n${e.message}` }));
  });
}

/** Case-insensitive glob → RegExp (mirror of packages/agent-tools `globToRegExp`;
 *  inlined because this container is plain ESM with no build step / package imports).
 *  `**` crosses `/`, `*` stays within a segment, `?` is one non-slash char. */
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      // `**/` is one token: zero or more directories, matching glob.ts.
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i++; }
      } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}
/** A slash-free glob matches the basename at any depth; otherwise the full path. */
function matchGlob(p, pattern) {
  const re = globToRegExp(pattern);
  return pattern.includes('/') ? re.test(p) : re.test(p.slice(p.lastIndexOf('/') + 1));
}
/**
 * Scope-aware glob: `sub` is where the walk started, so a glob written against THAT
 * folder must resolve against the scope-relative path too. Filtering only the
 * repo-root-relative path silently dropped every match (and the tool's zero-match
 * note then reported real files as missing). Mirrors `matchGlobInScope` in
 * `@builderforce/agent-tools` — this server is standalone, so it keeps a local copy.
 */
function matchGlobScoped(p, pattern, sub) {
  const scope = (sub ?? '').split('\\').join('/').trim().replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  if (!scope) return matchGlob(p, pattern);
  if (p !== scope && !p.startsWith(scope + '/')) return false;
  return matchGlob(p, pattern) || matchGlob(p.slice(scope.length + 1), pattern);
}

/** Mirror of `dirMayContainGlobMatch` in packages/agent-tools/src/glob.ts. */
function dirMayContainGlob(dir, pattern, sub) {
  const norm = (s) => (s ?? '').split('\\').join('/').trim().replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  const d = norm(dir);
  const scope = norm(sub);
  const pat = String(pattern).split('\\').join('/');
  if (scope && d && d !== scope && !d.startsWith(scope + '/') && !scope.startsWith(d + '/')) return false;
  const literalPrefix = (p) => {
    if (!p.includes('/')) return null;
    const meta = p.search(/[*?\[]/);
    if (meta === 0) return null;
    const head = meta < 0 ? p : p.slice(0, meta);
    const slash = head.lastIndexOf('/');
    return slash < 0 ? null : head.slice(0, slash + 1);
  };
  const canReach = (directory, prefix) => {
    if (directory === '') return true;
    const dirSlash = directory + '/';
    return prefix.startsWith(dirSlash) || dirSlash.startsWith(prefix);
  };
  const readings = [literalPrefix(pat)];
  if (scope) {
    const rel = literalPrefix(pat);
    readings.push(rel == null ? scope + '/' : scope + '/' + rel);
  }
  for (const prefix of readings) {
    if (prefix == null) {
      if (!scope || d === '' || d === scope || d.startsWith(scope + '/') || scope.startsWith(d + '/')) return true;
      continue;
    }
    if (canReach(d, prefix)) return true;
  }
  return false;
}

function emptyGlobNote(glob, sub, truncated) {
  const scope = (sub ?? '').split('\\').join('/').trim().replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  const base = 'No file matches glob "' + glob + '"' + (scope ? ' under "' + scope + '"' : '') + '.';
  if (truncated) {
    return base + ' This is NOT proof the file does not exist: the search was cut off before the tree was fully scanned, so this only means "not among the paths scanned so far". Narrow path to a smaller folder and re-run before concluding anything is missing.';
  }
  return base + ' Try a broader pattern, or list_files without a glob to see the tree. 0 matches means no such file exists in the paths scanned — do not claim one is missing without trying a broader glob first.';
}

/**
 * List repo files under `dir` (skipping .git/node_modules), capped. BREADTH-FIRST so
 * shallow files (root docs like ROADMAP.md) are collected before the cap is hit deep
 * in a large subtree; sorted for stable output. `glob` filters by name (case-
 * insensitive; a bare name matches the basename at any depth) so a file can be found
 * without dumping the tree.
 *
 * The glob is applied DURING the walk, so the cap counts MATCHES: a globbed listing is
 * never starved by unrelated files ahead of the match in the queue.
 */
async function listFiles(dir, sub, glob) {
  const root = sub ? join(dir, sub) : dir;
  const acc = [];
  const queue = [root];
  let truncated = false;
  while (queue.length > 0) {
    if (acc.length >= MAX_LIST_ENTRIES) { truncated = true; break; }
    const d = queue.shift();
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (glob) {
          const relDir = relative(dir, full).split(sep).join('/');
          if (!dirMayContainGlob(relDir, glob, sub)) continue;
        }
        queue.push(full);
      }
      else {
        const rel = relative(dir, full).split(sep).join('/');
        if (glob && !matchGlobScoped(rel, glob, sub)) continue;
        if (acc.length >= MAX_LIST_ENTRIES) { truncated = true; break; }
        acc.push(rel);
      }
    }
  }
  acc.sort((a, b) => a.localeCompare(b));
  const result = { ok: true, paths: acc, truncated };
  if (glob && acc.length === 0) result.note = emptyGlobNote(glob, sub, truncated);
  return result;
}

/** The D7 post-edit checks over the clone (their events reach the run's timeline). */
function startPostEditChecks(box) {
  const { workdir } = box;
  const bins = new Map();
  const hasBin = (name) => {
    if (!bins.has(name)) bins.set(name, runShell(`command -v ${name} >/dev/null 2>&1`, workdir, null, 10_000).then((r) => r.exitCode === 0));
    return bins.get(name);
  };
  return createPostEditChecks({
    workdir,
    run: (command, cwd, timeoutMs) => runShell(command, cwd, null, timeoutMs),
    io: cloneCheckIo(workdir, { access, readFile, hasBin }),
    fit: (output) => fitToolText(output, toolOutputCap('run_command'), { tool: 'run_command', summarize: true }),
    onEvent: (e) => box.emit('runtime.post_edit_check', e, `${e.check}${e.cwd ? ` (${e.cwd})` : ''}: ${e.skipped ? `skipped (${e.skipped})` : e.timedOut ? 'timed out' : `exit ${e.exitCode}`}`),
  });
}

/** A repo-relative path inside the clone, or null when it would escape it. */
function insideClone(workdir, path) {
  if (typeof path !== 'string' || !path.trim()) return null;
  const abs = resolvePath(workdir, path.replace(/^\/+/, ''));
  return abs === workdir || abs.startsWith(workdir + sep) ? abs : null;
}

/** A git-safe ref name, or null. */
function safeRef(v) {
  return typeof v === 'string' && /^[\w./@-]+$/.test(v) ? v : null;
}

/**
 * Absorb a change the engine already COMMITTED to the ticket branch (through the Worker's
 * git provider, which owns the lease, the outbound inspection and the file-change ledger):
 * fast-forward the clone to that branch, so the commit is real history here and
 * `git_undo` / `git_redo` / `git_sync_latest` act on it instead of on a dirty tree.
 * Before the first commit the clone may sit on base; the branch is then checked out at
 * the fetched head, carrying any uncommitted shell work. True when the file now holds
 * `content` (null ⇒ is gone); false ⇒ the caller writes it directly (a conflicting
 * local edit, an unreachable remote).
 */
async function absorbCommit(box, abs, content) {
  const head = safeRef(box.spec.repo && box.spec.repo.headBranch);
  if (!head) return false;
  const r = await runShell([
    `git fetch -q origin "${head}"`,
    `if [ "$(git rev-parse --abbrev-ref HEAD)" = "${head}" ]; then git merge -q --ff-only FETCH_HEAD; else git checkout -q -B "${head}" FETCH_HEAD; fi`,
  ].join(' && '), box.workdir, null, 60_000);
  if (r.exitCode !== 0) return false;
  try {
    return content === null ? !(await access(abs).then(() => true, () => false)) : (await readFile(abs, 'utf8')) === content;
  } catch {
    return false;
  }
}

async function sandboxFs(box, body) {
  const { workdir } = box;
  if (body.op === 'list') {
    return listFiles(workdir, typeof body.path === 'string' && body.path ? body.path : undefined,
      typeof body.glob === 'string' && body.glob.trim() ? body.glob.trim() : undefined);
  }
  const abs = insideClone(workdir, body.path);
  if (!abs) return { ok: false, error: 'path is required and must stay inside the repository' };
  if (body.op === 'read') {
    try { return { ok: true, path: body.path, content: await readFile(abs, 'utf8') }; }
    catch (e) { return { ok: false, error: `read failed: ${e.message}` }; }
  }
  if (body.op === 'write') {
    if (typeof body.content !== 'string') return { ok: false, error: 'content is required' };
    if (!(body.committed === true && await absorbCommit(box, abs, body.content))) {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, body.content);
    }
    box.checks?.touch(body.path);
    return { ok: true, path: body.path };
  }
  if (body.op === 'delete') {
    if (!(body.committed === true && await absorbCommit(box, abs, null))) await rm(abs, { force: true });
    box.checks?.touch(body.path);
    return { ok: true, path: body.path };
  }
  return { ok: false, error: `unknown fs op '${body.op}'` };
}

/** The directory a command runs in: the clone's root when `cwd` is absent, else that
 *  repo-relative directory. `{ error }` when it escapes the clone or is not a directory. */
async function commandDir(box, cwd) {
  if (cwd == null || cwd === '' || cwd === '.') return { dir: box.workdir };
  const abs = insideClone(box.workdir, cwd);
  if (!abs) return { error: 'cwd must be a directory inside the repository' };
  const isDir = await stat(abs).then((s) => s.isDirectory(), () => false);
  return isDir ? { dir: abs } : { error: `cwd '${cwd}' is not a directory in the repository` };
}

async function sandboxRun(box, body, onAbort) {
  const command = typeof body.command === 'string' ? body.command : '';
  if (!command) return { ok: false, error: 'command is required' };
  const where = await commandDir(box, body.cwd);
  if (where.error) return { ok: false, error: where.error };
  // The engine giving up on the command (a cancel) kills it.
  const proc = { current: null };
  const release = onAbort(() => { if (proc.current) proc.current.kill('SIGKILL'); });
  // The engine may bound a command below the ceiling (the run-end verify's budget).
  const timeoutMs = Number.isFinite(body.timeoutMs) && body.timeoutMs > 0 ? Math.min(body.timeoutMs, COMMAND_TIMEOUT_MS) : COMMAND_TIMEOUT_MS;
  const r = await runShell(command, where.dir, proc, timeoutMs);
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
 * One run's sandbox over `workdir`. `emit(toolName, detail, result)` reports a local
 * service's event to the run's timeline (each transport posts it its own way).
 */
export function createSandboxBox({ spec, workdir, branch = null, emit = () => {} }) {
  const box = { spec, workdir, branch, emit, checks: null, jobs: createJobTable({ maxWaitMs: COMMAND_TIMEOUT_MS }) };
  if (spec.postEditChecks === true) box.checks = startPostEditChecks(box);
  return box;
}

/** The run is over: kill every background job it left running. Each transport calls this
 *  from its close path, so no job outlives its run. */
export async function closeSandboxBox(box) {
  await box.jobs.closeAll();
}

/**
 * Serve one sandbox request on `box`: `fs` / `run` / `checks` / `job/*`. `onAbort(kill)`
 * lets the transport kill a running command (or end a job poll's wait) when the engine
 * gives up on the request (a cancel).
 */
export async function serveSandbox(box, path, body, onAbort = () => {}) {
  if (path === '/sandbox/fs') return sandboxFs(box, body);
  if (path === '/sandbox/run') return sandboxRun(box, body, onAbort);
  if (path === '/sandbox/checks') return sandboxChecks(box);
  if (path === '/sandbox/job/start') return sandboxJobStart(box, body);
  if (path === '/sandbox/job/poll') return box.jobs.poll(String(body.id ?? ''), body.waitMs, onAbort);
  if (path === '/sandbox/job/kill') return box.jobs.kill(String(body.id ?? ''));
  return { ok: false, error: `unknown sandbox request '${path}'` };
}

export { runShell };
