/**
 * The WORKSPACE AGENT — the only code that touches a run's working tree.
 *
 * The sandbox server holds the run's secrets (its token, on Actions the OIDC request token) and must
 * never read, write, list or follow a path inside the tree the model's shell controls: a symlink the
 * shell plants, a swapped directory, a hook, a config file are all the model's. So this small process
 * runs AS THE SHELL USER (`sudo -n -u bfagent env -i … node workspaceAgent.mjs <workdir>`, started by
 * `workspaceClient.mjs` through the same `shellInvocation` every model shell uses) and the server asks
 * it, over newline-delimited JSON on stdin/stdout, to do each file or git operation. A steered path can
 * then only reach what the shell user can reach, which is the real boundary.
 *
 * The path guard (`insideClone`, the `.git` refusal, O_NOFOLLOW) stays here as defence in depth: it
 * keeps the engine's fs ops inside the repository and out of `.git`.
 *
 * Protocol: one JSON object per line. Request `{ id, op, ... }`, reply `{ id, ok, ... }`.
 * Plain ESM, node builtins only. It is NOT inlined into the Actions runner (it is its own process):
 * the runner writes `WORKSPACE_AGENT_SOURCE` (generated) to a file the server owns and spawns it.
 */
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { appendFile, chmod, lstat, mkdir, open as openFile, readFile, readdir, readlink, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const MAX_LIST_ENTRIES = 500;
const GIT_TIMEOUT_MS = 10 * 60 * 1000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
/** A bundle returned over the pipe (base64) is bounded: past this the publish fails loudly rather than exhausting memory. */
const MAX_BUNDLE_OUT_BYTES = 96 * 1024 * 1024;
const OUTPUT_TAIL = 8 * 1024;

/** A git-safe ref name, or null. */
function safeRef(v) {
  return typeof v === 'string' && /^[\w./@-]+$/.test(v) && !v.includes('..') && !v.startsWith('-') ? v : null;
}

/** Run `git <args>` in `cwd` as THIS user (the shell user). `buffer` returns stdout as a Buffer. */
function git(args, cwd, { buffer = false } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, ...(buffer ? { encoding: 'buffer' } : {}) }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      resolve({ exitCode, stdout, output: `${buffer ? '' : stdout}${stderr}`.slice(-OUTPUT_TAIL) });
    });
  });
}

const gitReply = (r) => ({ ok: r.exitCode === 0, output: r.output.trim(), ...(r.exitCode === 0 ? {} : { error: r.output.trim().slice(-300) || `git exited ${r.exitCode}` }) });

/**
 * One workspace over `workdir`. `handle(req)` answers one request; it never throws.
 */
export function createWorkspace(workdir) {
  const root = resolvePath(workdir);

  /** Write `content` to `abs`, keeping the file's mode. A file the shell made read-only is replaced
   *  through a temp file + rename (the directory is ours to write). Never follows a symlink at the final component. */
  async function writeKeepingMode(abs, content) {
    const realRoot = await realpath(root);
    const real = await realpath(abs).catch(() => abs); // an in-clone alias is resolved by the guard; write its real file
    if (real !== abs && (!lexicallyInside(realRoot, real) || touchesGitDir(relative(realRoot, real)))) throw new Error('path resolves outside the repository');
    let mode = 0o644;
    try { mode = (await stat(real)).mode & 0o7777; } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    try {
      const fh = await openFile(real, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0), mode);
      try { await fh.writeFile(content); } finally { await fh.close(); }
    } catch (e) {
      if (!e || (e.code !== 'EACCES' && e.code !== 'EPERM')) throw e;
      const tmp = join(dirname(real), `.bf-write-${process.pid}-${Date.now().toString(36)}`);
      const fh = await openFile(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), mode);
      try { await fh.writeFile(content); } finally { await fh.close(); }
      try {
        await chmod(tmp, mode);
        await rename(tmp, real);
      } catch (renameError) {
        await unlink(tmp).catch((cleanup) => console.error(`[workspace] could not remove ${tmp}: ${cleanup.message}`));
        throw renameError;
      }
    }
  }

  /** `.git/info/exclude` gets the preview's generated config files, so `git add -A` never stages them. */
  async function exclude(paths) {
    const info = join(root, '.git', 'info');
    const gitDir = await lstat(join(root, '.git')).catch(() => null);
    if (!gitDir || !gitDir.isDirectory()) return { ok: true, skipped: 'no repository' };
    await mkdir(info, { recursive: true });
    const file = join(info, 'exclude');
    const current = await readFile(file, 'utf8').catch(() => '');
    const missing = paths.filter((p) => typeof p === 'string' && p && !current.split('\n').includes(p));
    if (missing.length) await appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    return { ok: true };
  }

  const ops = {
    async init() {
      await mkdir(root, { recursive: true, mode: 0o755 });
      return { ok: true };
    },
    async destroy() {
      await rm(root, { recursive: true, force: true });
      return { ok: true };
    },
    async list(req) {
      if (typeof req.path === 'string' && req.path && !(await insideClone(root, req.path))) return { ok: false, error: 'path must stay inside the repository' };
      return listFiles(root, typeof req.path === 'string' && req.path ? req.path : undefined, typeof req.glob === 'string' && req.glob.trim() ? req.glob.trim() : undefined);
    },
    async read(req) {
      const abs = await insideClone(root, req.path);
      if (!abs) return { ok: false, error: 'path is required and must stay inside the repository' };
      try {
        const real = await realpath(abs);
        if (!lexicallyInside(await realpath(root), real)) return { ok: false, error: 'path must stay inside the repository' };
        return { ok: true, path: req.path, content: await readFile(real, 'utf8') };
      } catch (e) { return { ok: false, error: `read failed: ${e.message}` }; }
    },
    async stat(req) {
      const abs = await insideClone(root, req.path);
      if (!abs) return { ok: false, error: 'path must stay inside the repository' };
      try {
        const s = await stat(abs);
        return { ok: true, exists: true, isDir: s.isDirectory() };
      } catch (e) {
        return e && e.code === 'ENOENT' ? { ok: true, exists: false, isDir: false } : { ok: false, error: `stat failed: ${e.message}` };
      }
    },
    async write(req) {
      const abs = await insideClone(root, req.path);
      if (!abs) return { ok: false, error: 'path is required and must stay inside the repository' };
      if (typeof req.content !== 'string') return { ok: false, error: 'content is required' };
      try {
        await mkdir(dirname(abs), { recursive: true, mode: 0o755 });
        // The shell shares this tree: re-verify the parent now that it exists, not only as the guard saw it.
        if (!(await parentStillInside(root, abs))) throw new Error('path resolves outside the repository');
        await writeKeepingMode(abs, req.content);
      } catch (e) { return { ok: false, error: `write failed: ${e.message}` }; }
      return { ok: true, path: req.path };
    },
    async delete(req) {
      const abs = await insideClone(root, req.path);
      if (!abs) return { ok: false, error: 'path is required and must stay inside the repository' };
      try { await rm(abs, { force: true }); } catch (e) { return { ok: false, error: `delete failed: ${e.message}` }; }
      return { ok: true, path: req.path };
    },
    async mkdir(req) {
      const abs = await insideClone(root, req.path);
      if (!abs) return { ok: false, error: 'path is required and must stay inside the repository' };
      try {
        await mkdir(abs, { recursive: true, mode: 0o755 });
        if (!(await parentStillInside(root, join(abs, 'x')))) throw new Error('path resolves outside the repository');
      } catch (e) { return { ok: false, error: `mkdir failed: ${e.message}` }; }
      return { ok: true, path: req.path };
    },
    async exclude(req) {
      return exclude(Array.isArray(req.paths) ? req.paths : []);
    },

    // ── git, as the shell user, over bundles the server hands over (no network, no credential here) ──
    /** Clone `branch` from a bundle file; `origin` is set to the credential-free `remote`. */
    async clone(req) {
      const branch = safeRef(req.branch);
      if (!branch || typeof req.bundle !== 'string' || typeof req.remote !== 'string') return { ok: false, error: 'branch, bundle and remote are required' };
      const cloned = await git(['clone', '-q', '-b', branch, req.bundle, '.'], root);
      if (cloned.exitCode !== 0) return gitReply(cloned);
      return gitReply(await git(['remote', 'set-url', 'origin', req.remote], root));
    },
    /** Update `refs/remotes/origin/<ref>` from a bundle — what `git fetch origin <ref>` did. */
    async fetch(req) {
      const refs = (Array.isArray(req.refs) ? req.refs : []).map(safeRef);
      if (!refs.length || refs.includes(null) || typeof req.bundle !== 'string') return { ok: false, error: 'refs and bundle are required' };
      return gitReply(await git(['fetch', '-q', req.bundle, ...refs.map((r) => `+refs/heads/${r}:refs/remotes/origin/${r}`)], root));
    },
    /** Fast-forward to `origin/<branch>`, or check it out when the clone sits on another branch. */
    async absorb(req) {
      const branch = safeRef(req.branch);
      if (!branch) return { ok: false, error: 'branch is required' };
      const current = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
      return gitReply(current.exitCode === 0 && current.output.trim() === branch
        ? await git(['merge', '-q', '--ff-only', `origin/${branch}`], root)
        : await git(['checkout', '-q', '-B', branch, `origin/${branch}`], root));
    },
    /** The checked-out branch and its commit — what a publish is about. */
    async head() {
      const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
      const sha = await git(['rev-parse', 'HEAD'], root);
      if (branch.exitCode !== 0 || sha.exitCode !== 0) return gitReply(branch.exitCode !== 0 ? branch : sha);
      return { ok: true, branch: branch.output.trim(), sha: sha.output.trim() };
    },
    /** `branch` as a bundle (base64), without what the server already holds (`basis`). */
    async bundleOut(req) {
      const branch = safeRef(req.branch);
      const basis = req.basis == null ? null : (/^[0-9a-f]{40}$/.test(req.basis) ? req.basis : undefined);
      if (!branch || basis === undefined) return { ok: false, error: 'a branch and a 40-hex basis are required' };
      const made = await git(['bundle', 'create', '-', `refs/heads/${branch}`, ...(basis ? [`^${basis}`] : [])], root, { buffer: true });
      if (made.exitCode !== 0) return gitReply(made);
      if (made.stdout.length > MAX_BUNDLE_OUT_BYTES) return { ok: false, error: `the bundle is ${made.stdout.length} bytes; over the ${MAX_BUNDLE_OUT_BYTES} limit` };
      return { ok: true, bundle: made.stdout.toString('base64') };
    },
  };

  async function handle(req) {
    try {
      if (!req || typeof req.op !== 'string' || !Object.hasOwn(ops, req.op)) return { ok: false, error: `unknown workspace op '${req && req.op}'` };
      return await ops[req.op](req);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { handle };
}

/** Serve a workspace over newline-delimited JSON: one request per line in, one reply per line out. */
export function serveWorkspace(workspace, input, output, onClose = () => {}) {
  const lines = createInterface({ input });
  lines.on('line', (line) => {
    let req;
    try { req = JSON.parse(line); } catch (e) { console.error(`[workspace] unparseable request: ${e.message}`); return; }
    void workspace.handle(req).then((reply) => output.write(`${JSON.stringify({ ...reply, id: req.id })}\n`));
  });
  lines.on('close', onClose);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  serveWorkspace(createWorkspace(process.argv[2]), process.stdin, process.stdout, () => process.exit(0));
}

// ── The path guard and the listing (moved here from sandboxCore: they act on the tree) ──────────────

/** A repo-relative path inside the clone, or null when it would escape it. */
function lexicallyInside(root, abs) {
  return abs === root || abs.startsWith(root + sep);
}

const MAX_LINK_HOPS = 16;

/**
 * The real path `p` (absolute) resolves to once every symlink on its path is followed, or null when
 * that is outside `realRoot`. `realpath` throws ENOENT for a path that does not exist yet (a file
 * about to be created) AND for a dangling symlink, so on ENOENT the probe is `lstat`ed: a dangling
 * link is resolved by hand (`readlink`, against the real parent) and re-checked, up to a hop limit;
 * a genuinely missing component walks up to the nearest ancestor that exists, and the components
 * that do not exist yet are appended to its real path.
 */
async function resolveInside(realRoot, p, hops = 0) {
  let probe = p;
  const rest = [];
  const inside = (real) => (lexicallyInside(realRoot, real) ? real : null);
  for (;;) {
    try {
      return inside(join(await realpath(probe), ...rest));
    } catch (e) {
      if (!e || e.code !== 'ENOENT') return null;
    }
    let link = null;
    try {
      const st = await lstat(probe);
      if (st.isSymbolicLink()) link = await readlink(probe);
    } catch (e) {
      if (!e || e.code !== 'ENOENT') return null;
    }
    if (link !== null) {
      if (hops >= MAX_LINK_HOPS) return null;
      let parentReal;
      try { parentReal = await realpath(dirname(probe)); } catch { return null; }
      const target = await resolveInside(realRoot, resolvePath(parentReal, link), hops + 1);
      return target === null ? null : inside(join(target, ...rest));
    }
    const parent = dirname(probe);
    if (parent === probe) return null;
    rest.unshift(probe.slice(parent.length).replace(/^[\\/]+/, ''));
    probe = parent;
  }
}

/** Whether a path (relative to the clone root) passes through the clone's own `.git` control directory. */
function touchesGitDir(relPath) {
  return relPath.split(sep).includes('.git');
}

/**
 * A repo-relative path inside the clone, or null when it would escape it — lexically
 * (`../`, a leading `/` is treated as clone-relative) AND through symlinks, including a
 * dangling link whose target is outside (see {@link resolveInside}). This is defence in
 * depth: the model's shell is a different, unprivileged uid (`shellUser`), but it shares the
 * tree with this process, so the guard is what keeps an fs op from being steered by a symlink
 * the shell planted into the server's own files (or into `.git`, reached through an alias such
 * as `ln -s .git g`: the `.git` check is applied to the RESOLVED path too). Accepted residuals:
 * a TOCTOU between this check and the open (node has no `openat`/O_DIRECTORY-relative open; the
 * writer narrows it by re-verifying the parent's realpath after `mkdir` and refusing a symlink
 * at the final component with O_NOFOLLOW), and hard links to files outside the clone.
 */
async function insideClone(workdir, path) {
  if (typeof path !== 'string' || !path.trim()) return null;
  const abs = resolvePath(workdir, path.replace(/^\/+/, ''));
  if (!lexicallyInside(workdir, abs)) return null;
  // `.git` is the clone's own control directory (hooks run as code, config can point at anything): never reachable through an fs op or a cwd.
  if (touchesGitDir(relative(workdir, abs))) return null;
  let realRoot;
  try { realRoot = await realpath(workdir); } catch { return null; }
  const real = await resolveInside(realRoot, abs);
  if (real === null || touchesGitDir(relative(realRoot, real))) return null;
  return abs;
}

/** The directory is a real one inside the clone and not `.git`: the check that is re-run right after `mkdir`, when the tree may have changed under the guard. */
async function parentStillInside(workdir, abs) {
  const realRoot = await realpath(workdir);
  const parent = await realpath(dirname(abs));
  return lexicallyInside(realRoot, parent) && !touchesGitDir(relative(realRoot, parent));
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
