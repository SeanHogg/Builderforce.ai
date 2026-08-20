/**
 * BuilderForce Agent Container — the long-lived process behind a "Cloud Agent
 * (Node/Container)" run (the `container` runtime surface). AgentContainerDO starts
 * this image and proxies `POST /run` to it.
 *
 * Unlike the durable surface (one LLM step per DO alarm tick, no shell), this runs
 * the whole agent loop in ONE persistent process with a REAL shell: it clones the
 * ticket repo to local disk, lets the agent read/write/build/test it, and verifies
 * with run_command before finishing.
 *
 * The Worker stays the source of truth: every LLM step, file commit, and the PR
 * finalize is delegated back to the Worker's internal container-op endpoint
 * (authenticated by the per-run token), so metering/commit/PR logic is never
 * duplicated here and no DB credentials live in the container. The only secret the
 * container holds is the short-lived tokened git clone URL it needs for the shell.
 *
 * It also serves `POST /web-scan`: the two stages of the platform's web security scan
 * that a Worker physically cannot perform (reading the peer TLS certificate, which
 * needs a socket). Same rule as above — this process OBSERVES, the Worker decides.
 *
 * Plain Node ESM (no build step) — node:22 ships global fetch + the APIs used here.
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
// The web-scan TLS stage exists precisely because a Cloudflare Worker has no socket:
// `node:tls` is what lets this process read the peer certificate the Worker cannot.
import { connect as tlsConnect } from 'node:tls';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = Number(process.env.PORT || 8080);
// Live-preview passthrough: when a run starts a dev server on PREVIEW_PORT, the
// Worker's preview ingress proxies `preview.builderforce.ai/<token>/*` here as
// `/__preview__/*`, which we reverse-proxy (HTTP + WebSocket/HMR) to that dev server.
// 0/unset ⇒ no preview (503), so the passthrough is inert until a run opts in.
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 0);
const PREVIEW_PREFIX = '/__preview__';
/** Strip the `/__preview__` prefix so the dev server sees its own root paths. */
function stripPreviewPrefix(url) {
  const rest = url.slice(PREVIEW_PREFIX.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}
function isPreviewUrl(url) {
  return url === PREVIEW_PREFIX || url.startsWith(`${PREVIEW_PREFIX}/`);
}
/** Reverse-proxy a preview HTTP request to the run's dev server on PREVIEW_PORT. */
function proxyPreviewHttp(req, res) {
  if (!PREVIEW_PORT) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('No dev server is running for this preview.');
    return;
  }
  const path = stripPreviewPrefix(req.url) || '/';
  const upstream = httpRequest(
    { host: '127.0.0.1', port: PREVIEW_PORT, method: req.method, path,
      headers: { ...req.headers, host: `127.0.0.1:${PREVIEW_PORT}` } },
    (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Preview dev server unreachable.');
  });
  req.pipe(upstream);
}
const MAX_LIST_ENTRIES = 500;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000; // a build/test step may legitimately take minutes
// Liveness heartbeat cadence. The Worker reaps a cloud run whose last activity is
// older than 90s (RuntimeService.CLOUD_ORPHAN_MS / staleExecutionReaper). A single
// run_command can run for minutes with no LLM round-trip, so we bump the run's
// `updated_at` on this timer — well under the 90s ceiling — so the reaper never kills
// a healthy, busy container mid-build. ~3 beats fit the window, so a dropped beat is
// covered by the next.
const HEARTBEAT_MS = 30 * 1000;

/** POST a container-op back to the Worker; returns the parsed JSON body. */
async function op(spec, body) {
  const res = await fetch(`${spec.internalBaseUrl.replace(/\/$/, '')}/api/runtime/internal/container-op`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId: spec.executionId, token: spec.token, op: body.op, args: body.args || {} }),
  });
  if (!res.ok) throw new Error(`container-op ${body.op} → ${res.status}`);
  return res.json();
}

/** Run a shell command in `cwd`, capturing combined stdout/stderr and the exit code.
 *  `proc` (optional) is a holder whose `.current` is set to the live child so the
 *  heartbeat loop can SIGKILL an in-flight command when the run is cancelled. */
function runShell(command, cwd, proc) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], { cwd, env: process.env });
    if (proc) proc.current = child;
    let out = '';
    const cap = (chunk) => { out += chunk; if (out.length > 60_000) out = out.slice(-60_000); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, COMMAND_TIMEOUT_MS);
    const done = (result) => { clearTimeout(timer); if (proc && proc.current === child) proc.current = null; resolve(result); };
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
      if (pattern[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
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
 * List repo files under `dir` (skipping .git/node_modules), capped. BREADTH-FIRST so
 * shallow files (root docs like ROADMAP.md) are collected before the cap is hit deep
 * in a large subtree; sorted for stable output. `glob` filters by name (case-
 * insensitive; a bare name matches the basename at any depth) so a file can be found
 * without dumping the tree.
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
      if (e.isDirectory()) { queue.push(full); }
      else {
        if (acc.length >= MAX_LIST_ENTRIES) { truncated = true; break; }
        acc.push(relative(dir, full).split(sep).join('/'));
      }
    }
  }
  acc.sort((a, b) => a.localeCompare(b));
  const paths = glob ? acc.filter((p) => matchGlob(p, glob)) : acc;
  return { ok: true, paths, truncated };
}

/** Execute one tool call. Repo reads/writes hit local disk (the clone); write also
 *  mirrors to the ticket branch via the Worker; run_command and the git_* tools run
 *  in the shell; memory_* and builtin_* relay to the Worker (no DB creds here).
 *
 *  `ask_human` is the one tool that ENDS this process: it hands the conversation
 *  (`loop.messages`) to the Worker, which parks the run, and returns `paused: true`
 *  so runLoop stops without posting a terminal op. See the `ask_human` container-op
 *  for why the pause is exit-and-redispatch rather than block-and-poll. */
async function execTool(spec, workdir, writtenPaths, name, parsed, proc, loop) {
  if (name === 'list_files') {
    if (!workdir) return { ok: false, error: 'no repository bound to this task' };
    return listFiles(
      workdir,
      typeof parsed.path === 'string' ? parsed.path : undefined,
      typeof parsed.glob === 'string' && parsed.glob.trim() ? parsed.glob.trim() : undefined,
    );
  }
  if (name === 'read_file') {
    const path = typeof parsed.path === 'string' ? parsed.path : '';
    if (!path) return { ok: false, error: 'path is required' };
    if (!workdir) return { ok: false, error: 'no repository bound to this task' };
    try {
      const content = await readFile(join(workdir, path), 'utf8');
      return { ok: true, path, content: content.slice(0, 100_000), truncated: content.length > 100_000 };
    } catch (e) { return { ok: false, error: `read failed: ${e.message}` }; }
  }
  if (name === 'write_file') {
    const path = typeof parsed.path === 'string' ? parsed.path : '';
    const content = typeof parsed.content === 'string' ? parsed.content : '';
    if (!path || !content) return { ok: false, error: 'path and content are both required' };
    const isNew = !writtenPaths.has(path);
    // Mirror to local disk so run_command builds against the new code.
    if (workdir) {
      try { await mkdir(dirname(join(workdir, path)), { recursive: true }); await writeFile(join(workdir, path), content); } catch { /* non-fatal; commit is source of truth */ }
    }
    const r = await op(spec, { op: 'write', args: { path, content, summary: parsed.summary, isNew } });
    if (r.ok) writtenPaths.add(path);
    return r;
  }
  if (name === 'run_command') {
    const command = typeof parsed.command === 'string' ? parsed.command : '';
    if (!command) return { ok: false, error: 'command is required' };
    if (!workdir) return { ok: false, error: 'no repository checked out — run_command needs a bound repo' };
    const t0 = Date.now();
    const { exitCode, output } = await runShell(command, workdir, proc);
    await op(spec, { op: 'event', args: { toolName: 'run_command', category: 'tool', detail: { command, exitCode }, result: output.slice(0, 300), durationMs: Date.now() - t0 } }).catch(() => {});
    return { ok: exitCode === 0, exitCode, output: output.slice(0, 20_000) };
  }
  if (name.startsWith('git_')) {
    if (!workdir) return { ok: false, error: 'no repository checked out — git tools need a bound repo' };
    return gitTool(spec, workdir, proc, name, parsed);
  }
  // Durable cross-run memory. Like the platform tools, the container holds no DB
  // creds, so all three verbs relay to the Worker's `memory` op — which drives the
  // SAME governed capability the durable surface uses (scope chain, provenance, TTL;
  // migration 0371), so a fact stored by a container run is recalled by a durable one
  // and vice versa, under one set of rules.
  if (name === 'memory_recall') {
    return op(spec, { op: 'memory', args: { action: 'recall', query: parsed.query, limit: parsed.limit } });
  }
  if (name === 'memory_remember') {
    return op(spec, {
      op: 'memory',
      args: {
        action: 'remember',
        key: parsed.key, content: parsed.content, tags: parsed.tags, importance: parsed.importance,
        // Governance metadata the model may now supply — how widely the fact applies
        // and when it lapses. The Worker resolves the concrete scope owner from the run.
        scope: parsed.scope, ttl_days: parsed.ttl_days,
      },
    });
  }
  if (name === 'memory_forget') {
    return op(spec, { op: 'memory', args: { action: 'forget', key: parsed.key } });
  }
  // The ticket's PRD. The container holds no DB creds and the PRD lives in the
  // platform's spec store (not the clone), so both modes relay to the Worker's `prd`
  // op — the SAME capability the durable loop calls, so an `update_prd` on this surface
  // lands identically to one on that surface.
  if (name === 'update_prd') {
    return op(spec, {
      op: 'prd',
      args: {
        action: parsed.mode === 'section' ? 'section' : 'append',
        section: parsed.section,
        content: parsed.content,
      },
    });
  }
  // Multi-agent leases + blackboard. The Worker owns both stores; this image only
  // relays the four shared coordination verbs, exactly like durable memory above.
  if (name === 'claim_resource') {
    return op(spec, { op: 'coordinate', args: { action: 'claim', resource: parsed.resource, mode: parsed.mode, reason: parsed.reason } });
  }
  if (name === 'release_resource') {
    return op(spec, { op: 'coordinate', args: { action: 'release', resource: parsed.resource } });
  }
  if (name === 'workspace_note') {
    return op(spec, { op: 'coordinate', args: { action: 'note', key: parsed.key, content: parsed.content } });
  }
  if (name === 'workspace_read') {
    return op(spec, { op: 'coordinate', args: { action: 'read', query: parsed.query, limit: parsed.limit } });
  }
  // Human-in-the-loop. The Worker opens the question, routes the ticket to the
  // board's needs-attention lane, parks the row in `paused` and PERSISTS the
  // conversation we hand it — so a fresh container process can be started with the
  // same conversation once someone answers. We deliberately send `messages` rather
  // than a summary: the resumed process must continue the run, not re-derive it.
  if (name === 'ask_human') {
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (!question) return { ok: false, error: 'question is required to ask a human' };
    const r = await op(spec, {
      op: 'ask_human',
      args: {
        question,
        context: typeof parsed.context === 'string' ? parsed.context : undefined,
        messages: loop && Array.isArray(loop.messages) ? loop.messages : [],
        writtenPaths: [...writtenPaths],
        step: loop && typeof loop.step === 'number' ? loop.step : 0,
        // This turn's tool-call ids so the Worker can close the pairing before it
        // freezes the transcript: our own call has no result yet, and any sibling
        // call never runs because the loop stops here.
        toolCallId: (loop && loop.toolCallId) || '',
        toolCallIds: (loop && loop.toolCallIds) || [],
      },
    });
    // `paused` is what stops the loop; anything else (a cancelled run, a rejected
    // question) is an ordinary tool failure the agent can react to.
    if (r && r.paused) return { ok: true, paused: true, note: r.note };
    return r && typeof r === 'object' ? r : { ok: false, error: 'could not park the run on a human question' };
  }
  // Web search. Relayed for the same reason memory and the platform tools are: the
  // vendor credential, the shared read-through cache and the spend meter all live in
  // the Worker. This op is what lets the container advertise `web.search` at all —
  // before it existed the capability was withheld here, so the two cloud surfaces
  // disagreed about what an agent could do purely because of where it happened to run.
  if (name === 'web_search') {
    const query = typeof parsed.query === 'string' ? parsed.query : '';
    if (!query.trim()) return { ok: false, error: 'query is required' };
    return op(spec, { op: 'search', args: { query } });
  }
  // Platform (project-management) tools — the container holds no DB creds, so it
  // relays each `builtin_*` call back to the Worker, which runs the curated,
  // subset-guarded tool in-process (create task / update OKR / read remaining work).
  if (name.startsWith('builtin_')) {
    return op(spec, { op: 'platform_tool', args: { name, arguments: parsed } });
  }
  return { ok: false, error: `unknown tool '${name}'` };
}

/**
 * Git / version-control tools for the container surface — the execution side of
 * the shared schemas (`buildGitCommand` in packages/agent-tools/core-tools.ts is
 * the canonical command reference; the container runs its own loop and this image
 * has no build step, so it can't import the TS package and mirrors the verbs here).
 *
 * Surface-specific twist: the container persists every write as a Worker-side
 * GitHub-API commit to the remote ticket branch — the local clone does NOT carry
 * those commits. So before any MUTATING op we first fast-forward the local clone
 * to the remote branch head (absorb the API commits), then operate, then push —
 * otherwise a local reset/merge+push would clobber the agent's committed work.
 * Read ops (status/diff/history) run against the local clone directly.
 */
async function gitTool(spec, workdir, proc, name, parsed) {
  const safe = (v) => (typeof v === 'string' && /^[\w./@-]+$/.test(v) ? v : null);
  const run = (cmd) => runShell(cmd, workdir, proc);
  const head = safe(spec.repo && spec.repo.headBranch) || 'HEAD';
  const clip = (r) => ({ ok: r.exitCode === 0, exitCode: r.exitCode, output: r.output.slice(0, 20_000) });

  if (name === 'git_status') return clip(await run('git status --short --branch'));
  if (name === 'git_diff') {
    const p = safe(parsed.path);
    return clip(await run(`git --no-pager diff${p ? ` -- "${p}"` : ''}`));
  }
  if (name === 'git_history') {
    const p = safe(parsed.path);
    const limit = Number.isFinite(parsed.limit) && parsed.limit > 0 ? Math.min(Math.floor(parsed.limit), 200) : 30;
    return clip(await run(`git --no-pager log --oneline -n ${limit}${p ? ` -- "${p}"` : ''}`));
  }

  // Identity + absorb any Worker-side API commits the local clone is missing, so a
  // subsequent merge/reset+push builds on the agent's real latest work.
  const preamble = [
    'set -e',
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    `git fetch origin "${head}" 2>/dev/null && git merge --ff-only "origin/${head}" 2>/dev/null || true`,
  ];

  if (name === 'git_sync_latest') {
    const base = safe(parsed.baseBranch);
    const resolveBase = base
      ? `BASE="${base}"`
      : `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;
    const cmd = [
      ...preamble,
      resolveBase,
      // Full clone (above) already carries the base branch + a shared merge-base.
      'git fetch origin "$BASE"',
      'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
      'git push origin HEAD',
      'echo "Synced with origin/$BASE"',
    ].join('\n');
    const r = await run(cmd);
    if (r.exitCode === 3 || /MERGE_CONFLICT/.test(r.output)) {
      return { ok: false, error: 'merge conflict — the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve the conflicting files and retry, or ask a human.', output: r.output.slice(0, 4000) };
    }
    await op(spec, { op: 'event', args: { toolName: 'git_sync_latest', category: 'tool', result: r.output.slice(0, 300) } }).catch(() => {});
    return clip(r);
  }

  if (name === 'git_undo' || name === 'git_redo') {
    const target = name === 'git_undo' ? 'HEAD~1' : '"HEAD@{1}"';
    const msg = name === 'git_undo' ? 'Undid the last commit (use git_redo to reapply)' : 'Reapplied the last undone change';
    const cmd = [
      ...preamble,
      `[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }`,
      `git reset --hard ${target}`,
      // Branch history rewound — publish it (the agent's own ticket branch).
      `git push --force-with-lease origin HEAD`,
      `echo "${msg}"`,
    ].join('\n');
    const r = await run(cmd);
    if (r.exitCode === 4 || /\bDIRTY\b/.test(r.output)) {
      return { ok: false, error: `you have uncommitted changes — commit or discard them before ${name} (it refuses to discard uncommitted work).` };
    }
    await op(spec, { op: 'event', args: { toolName: name, category: 'tool', result: r.output.slice(0, 300) } }).catch(() => {});
    return clip(r);
  }

  return { ok: false, error: `unknown git tool '${name}'` };
}

/**
 * LIVE PREVIEW — start the project's own dev server on PREVIEW_PORT.
 *
 * The passthrough (`/__preview__/*` → `127.0.0.1:PREVIEW_PORT`) has existed since the
 * ingress landed, but nothing ever STARTED a server for it to reach, so the whole
 * preview vertical terminated in a 503. This is the missing half.
 *
 * The Worker owns every decision: whether preview is enabled at all, whether this
 * tenant has capacity, which config files to write, and which command to run. This
 * function only executes the plan it is handed — so the instance budget, the plan gate
 * and the framework detection stay reviewable in one place on the server rather than
 * drifting inside an image that ships separately.
 *
 * Entirely best-effort. A preview that cannot start must never affect the RUN: every
 * failure path reports `failed` (so the panel can say why) and returns, and the caller
 * ignores the result.
 */
async function startPreviewDevServer(spec, workdir) {
  // Ask the Worker to acquire an instance. This is where the global budget, the
  // per-tenant cap and the plan gate are applied, so a refusal here is final.
  const started = await op(spec, { op: 'preview', args: { action: 'start' } }).catch(() => null);
  if (!started || started.ok !== true) return;
  const step = started.step && typeof started.step === 'object' ? started.step : spec.preview;
  if (!step || !Array.isArray(step.candidates) || step.candidates.length === 0) {
    await op(spec, { op: 'preview', args: { action: 'failed', detail: 'no preview start plan on the wire' } }).catch(() => {});
    return;
  }

  const fail = (detail) => op(spec, { op: 'preview', args: { action: 'failed', detail } }).catch(() => {});

  // 1. Write the generated config files (Vite/Metro host tuning the project cannot know
  //    about — it has no idea it is being served through a public proxy).
  for (const file of Array.isArray(step.files) ? step.files : []) {
    if (!file || typeof file.path !== 'string' || typeof file.contents !== 'string') continue;
    const abs = join(workdir, file.path);
    if (!abs.startsWith(workdir)) continue; // never escape the workspace
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.contents, 'utf8');
    } catch (e) {
      await fail(`could not write ${file.path}: ${e.message}`);
      return;
    }
  }

  // 2. Pick the first candidate whose marker file exists AND whose required
  //    package.json script is present. Expo projects also carry a `dev` script, so the
  //    marker alone would start the wrong server — both pieces of evidence are needed.
  let scripts = {};
  try {
    scripts = JSON.parse(await readFile(join(workdir, 'package.json'), 'utf8')).scripts ?? {};
  } catch { scripts = {}; }

  let chosen = null;
  for (const candidate of step.candidates) {
    if (!candidate || typeof candidate.command !== 'string') continue;
    if (candidate.when) {
      try { await readFile(join(workdir, candidate.when)); } catch { continue; }
    }
    if (candidate.requiresScript && !scripts[candidate.requiresScript]) continue;
    chosen = candidate;
    break;
  }
  if (!chosen) {
    await fail('no dev-server command matched this project (no Expo/Vite/Next marker and no runnable dev script)');
    return;
  }

  // 3. Spawn DETACHED and unref'd: the dev server outlives this call and must not hold
  //    the agent loop, the command timeout, or the cancel-kill handle — those belong to
  //    the agent's own shell commands. `proc.current` is deliberately NOT set.
  let child;
  try {
    child = spawn('bash', ['-lc', chosen.command], {
      cwd: workdir,
      env: { ...process.env, ...(step.env && typeof step.env === 'object' ? step.env : {}) },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    await fail(`could not start the dev server: ${e.message}`);
    return;
  }

  // A command that dies immediately (missing dependency, port already bound) would
  // otherwise sit "starting" until the health check gave up; say so straight away.
  let exitedEarly = null;
  child.on('exit', (code) => { exitedEarly = code; });
  child.on('error', (e) => { exitedEarly = e.message; });

  // 4. Hand the health check back to the Worker, which probes through the REAL public
  //    path (ingress → container DO → dev server) rather than trusting localhost here —
  //    a server bound to the wrong interface answers locally and 503s publicly.
  const health = step.health && typeof step.health === 'object' ? step.health : { attempts: 20, intervalMs: 1500 };
  const attempts = Number.isFinite(health.attempts) && health.attempts > 0 ? Math.min(Math.floor(health.attempts), 60) : 20;
  const intervalMs = Number.isFinite(health.intervalMs) && health.intervalMs > 0 ? Math.min(Math.floor(health.intervalMs), 10_000) : 1_500;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (exitedEarly !== null) {
      await fail(`the dev server exited immediately (${exitedEarly}) — command: ${chosen.command}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const ready = await op(spec, { op: 'preview', args: { action: 'ready' } }).catch(() => null);
    if (ready && ready.ok === true) return;
  }
  await fail(`the dev server did not answer on port ${step.port ?? PREVIEW_PORT} within ${Math.round((attempts * intervalMs) / 1000)}s — command: ${chosen.command}`);
}

/**
 * Drive the agent loop to completion, then finalize (PR) via the Worker.
 *
 * THREE ways out, and exactly one terminal op each:
 *   • finished / cancelled → `finalize` (opens the PR, settles the row);
 *   • the loop threw       → `fail` (the Worker self-heals or fails with the reason);
 *   • the agent asked a human → NEITHER. The run is parked in `paused` by the
 *     `ask_human` op and this process exits clean, because a paused run is not a
 *     finished one and must not be marked failed. `resumePausedExecution` starts a
 *     fresh process seeded with `spec.resume` once someone answers.
 */
async function runLoop(spec) {
  let workdir = null;
  const writtenPaths = new Set();
  let finalOutput = '';
  let cancelled = false;
  let crashed = null;
  // Set when the agent called ask_human: the run is parked, not over.
  let paused = false;
  // Holds the live child process so the heartbeat can kill it on cancel.
  const proc = { current: null };
  // Liveness heartbeat: bump the run's `updated_at` on a timer so a long shell step
  // (build/test) doesn't look orphaned to the Worker's reaper (90s ceiling). A beat
  // that reports the run cancelled also SIGKILLs an in-flight command so a cancel
  // during a multi-minute build takes effect immediately instead of after timeout.
  const heartbeat = setInterval(() => {
    op(spec, { op: 'heartbeat' })
      .then((r) => { if (r && r.cancelled && proc.current) { cancelled = true; proc.current.kill('SIGKILL'); } })
      .catch(() => { /* a missed beat is covered by the next */ });
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  try {
    if (spec.repo && spec.repo.cloneUrl) {
      workdir = await mkdtemp(join(tmpdir(), `bf-exec-${spec.executionId}-`));
      const { cloneUrl, headBranch, baseBranch } = spec.repo;
      // FULL clone (no `--depth`): a shallow clone caused two separate failures —
      // it hid earlier passes (single-branch), and it has no merge-base with the
      // base branch, so `git_sync_latest` / `git diff main` / `git merge-base`
      // couldn't work. A complete clone carries every branch + full history, so the
      // agent can sync the latest base, diff against it, and never build on stale
      // code. Prefer the ticket's HEAD branch (prior runs' WIP); fall back to the
      // base branch on the first run, before the head branch exists on the remote.
      let checkedOut = null;
      let clone = headBranch
        ? await runShell(`git clone -b "${headBranch}" "${cloneUrl}" .`, workdir, proc)
        : { exitCode: 1, output: 'no head branch' };
      if (clone.exitCode === 0) {
        checkedOut = headBranch;
      } else {
        const baseArg = baseBranch ? `-b "${baseBranch}"` : '';
        clone = await runShell(`git clone ${baseArg} "${cloneUrl}" .`, workdir, proc);
        if (clone.exitCode === 0) checkedOut = baseBranch || '(default)';
      }
      if (clone.exitCode !== 0) {
        await op(spec, { op: 'event', args: { toolName: 'runtime.clone', category: 'planning', result: `clone failed: ${clone.output.slice(0, 200)}` } }).catch(() => {});
        workdir = null; // continue without a shell workspace; writes still commit via the Worker
      } else {
        // Record the branch actually checked out so triage never has to reverse-engineer
        // it from `git status` (the gap that made execution #67 waste its budget).
        await op(spec, { op: 'event', args: { toolName: 'runtime.clone', category: 'planning', detail: { branch: checkedOut, requestedHead: headBranch ?? null, base: baseBranch ?? null }, result: `cloned ${spec.repo.cloneUrl.replace(/\/\/[^@]*@/, '//')} on branch ${checkedOut}` } }).catch(() => {});
      }
    }

    // ── LIVE PREVIEW ────────────────────────────────────────────────────────────
    // Start the project's dev server BEFORE the agent loop, so the preview is already
    // coming up while the first LLM turn is in flight rather than only after the run
    // ends. Fire-and-forget on purpose: the health-check poll must not hold the loop,
    // and a preview that never comes up must not delay or fail the RUN.
    // Requires a shell workspace (a run whose clone failed has nothing to serve).
    if (spec.preview && workdir) {
      void startPreviewDevServer(spec, workdir).catch(() => { /* reported via the preview op */ });
    }

    // A RESUMED run continues the conversation the previous process exited with —
    // the human's answer arrives separately, as a pending steer the Worker injects
    // into the very next `llm` op. Only a fresh run starts from the task prompt.
    // (`writtenPaths` is carried too, so the finalize still reports every file this
    // execution wrote across both processes.)
    const resume = spec.resume && Array.isArray(spec.resume.messages) && spec.resume.messages.length > 0 ? spec.resume : null;
    const messages = resume
      ? [...resume.messages]
      : [
          { role: 'system', content: spec.systemPrompt },
          { role: 'user', content: spec.userContent },
        ];
    if (resume && Array.isArray(resume.writtenPaths)) {
      for (const p of resume.writtenPaths) if (typeof p === 'string') writtenPaths.add(p);
    }
    const maxSteps = Number(spec.maxSteps) || 20;

    for (let step = 0; step < maxSteps; step++) {
      // A heartbeat may have observed a cancel (and killed an in-flight command)
      // since the last step — stop before spending another LLM call.
      if (cancelled) break;
      const turn = await op(spec, { op: 'llm', args: { messages } });
      // A gateway LLM error (cascade exhausted: 429 / 413 context-too-big / etc.) is a
      // FAILURE, not an orderly finish — the model produced no turn. Route it to the
      // `fail` channel (self-heal/retry) via `crashed`, NOT `finalize`, so the run is
      // never marked COMPLETED on a gateway error.
      if (turn.error) { crashed = `gateway error: ${turn.error}`; break; }
      if (turn.cancelled) { cancelled = true; break; }
      // The Worker compacted the history (summarized old turns into a builder-memory
      // note) — adopt it as our loop state so we don't re-send (and re-summarize) the
      // full history next turn. Pairing-safe: the Worker preserves tool-call pairing.
      if (Array.isArray(turn.compactedMessages)) { messages.length = 0; messages.push(...turn.compactedMessages); }
      const content = typeof turn.content === 'string' ? turn.content : '';
      const toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
      // Mid-run steering: user follow-ups posted to this run since the last step.
      // Splicing them in as user turns lets the user redirect the work mid-run.
      const steering = Array.isArray(turn.steering) ? turn.steering.filter((s) => typeof s === 'string' && s.trim()) : [];
      if (content) finalOutput = content;
      // A bare final answer normally ends the run — but if the user just steered,
      // keep going so the new direction is acted on instead of being dropped.
      if (toolCalls.length === 0 && steering.length === 0) break;

      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content, tool_calls: toolCalls });
      } else if (content) {
        messages.push({ role: 'assistant', content });
      }
      let finished = false;
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? 'unknown';
        let parsed = {};
        try { parsed = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { /* empty */ }
        let result;
        if (name === 'finish') {
          finalOutput = typeof parsed.summary === 'string' ? parsed.summary : finalOutput;
          finished = true;
          result = { ok: true };
        } else {
          result = await execTool(spec, workdir, writtenPaths, name, parsed, proc, { messages, step, toolCallId: tc.id ?? '', toolCallIds: toolCalls.map((c) => c.id ?? '') });
        }
        messages.push({ role: 'tool', tool_call_id: tc.id ?? '', content: JSON.stringify(result) });
        // The run is parked on a human question. Stop immediately — running further
        // tools would spend tokens against a row the Worker has already paused.
        if (result && result.paused) { paused = true; break; }
      }
      if (paused) break;
      // Apply steers AFTER this turn's tool results so the agent reacts to them next
      // step. A steer also overrides a finish in the same turn: the user added work.
      for (const steer of steering) { messages.push({ role: 'user', content: steer }); finished = false; }
      if (finished) break;
    }
  } catch (e) {
    // The loop threw. Capture the REAL reason and report it on the dedicated `fail`
    // channel (NOT finalize, which implies an orderly finish) so the Worker can
    // self-heal or fail the run with what actually broke.
    crashed = e instanceof Error ? e.message : String(e);
  } finally {
    clearInterval(heartbeat); // stop beating before the terminal op
    try {
      // PAUSED runs post NOTHING here. The `ask_human` op already parked the row and
      // persisted the resume state; a `finalize` would open a PR on half-done work
      // and a `fail` would mark a perfectly healthy, answerable run as failed.
      if (paused) {
        // A pause AND a crash means the crash happened after the park — report it as
        // telemetry, not as the run's outcome.
        if (crashed) await op(spec, { op: 'event', args: { toolName: 'runtime.paused_exit', category: 'error', result: `container exited after pausing, with an error: ${crashed}`.slice(0, 300) } }).catch(() => {});
      } else if (crashed) {
        await op(spec, { op: 'fail', args: { error: crashed } }).catch(() => {});
      } else {
        await op(spec, { op: 'finalize', args: { writtenPaths: [...writtenPaths], finalOutput, cancelled } }).catch(() => {});
      }
    } finally {
      if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ── Web-security-scan stages ─────────────────────────────────────────────────
//
// The platform's web security scan runs inside a Cloudflare Worker, and two checks a
// real external scanner performs are simply not observable from there:
//
//   • the PEER TLS CERTIFICATE — Worker `fetch` exposes no socket, so there is no
//     chain, expiry, protocol version or cipher suite to read. No Worker-side code
//     can fix that; it needs a process with `node:tls`, which is this one.
//   • the SOFTWARE FINGERPRINT surface for a CVE lookup — one plain GET, but taken
//     from a runtime with no Worker subrequest budget to spend.
//
// This container therefore OBSERVES and posts the observation back; it decides
// nothing. Every verdict ("that cipher is weak", "that certificate expires in six
// days", "that version matches CVE-…") is computed Worker-side by pure, unit-tested
// functions (api/src/application/security/tlsCertificateScan.ts and
// softwareFingerprint.ts). Judgement written here would be judgement no test could
// reach — the image ships on its own cadence and nothing in CI executes it.
//
// Auth is the same shape the rest of this file uses: a per-id HMAC minted by the
// Worker at dispatch, echoed back verbatim. The container holds no DB credentials and
// names no tenant; the Worker resolves both from the audit id.

/** Bounded body slice for fingerprinting — mirrors the Worker scan's own ceiling. */
const WEB_SCAN_BODY_LIMIT = 200_000;
/** One stage must not hold the container open: a hung TLS socket is the usual cause. */
const WEB_SCAN_TIMEOUT_MS = 15_000;

/** POST one stage result back to the Worker's ingest seam. Never throws. */
async function postWebScanStage(spec, stage, payload) {
  try {
    const res = await fetch(`${spec.internalBaseUrl.replace(/\/$/, '')}/api/security/internal/web-scan-stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditId: spec.auditId, token: spec.token, stage, ...payload }),
    });
    if (!res.ok) console.error(`[container] web-scan stage ${stage} ingest → ${res.status}`);
  } catch (e) {
    console.error(`[container] web-scan stage ${stage} ingest failed`, e);
  }
}

/**
 * Open a TLS connection and DESCRIBE what came back — the certificate as
 * `getPeerCertificate()` reports it plus the negotiated protocol/cipher and Node's own
 * chain-verification verdict.
 *
 * `rejectUnauthorized: false` is deliberate and is the whole point: the scanner must be
 * able to REPORT an untrusted or expired certificate, and a socket that refuses to
 * complete the handshake would give us nothing to report. The verdict is preserved
 * separately in `authorized` / `authorizationError` rather than being thrown away with
 * the connection.
 */
function describeTlsPeer(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    let socket;
    try {
      socket = tlsConnect({
        host,
        port,
        servername: host,          // SNI — without it a shared host serves the wrong cert
        rejectUnauthorized: false, // see above: we report the failure, we do not become it
        timeout: WEB_SCAN_TIMEOUT_MS,
      });
    } catch (e) {
      finish({ host, port, protocol: null, cipherName: null, cipherStandardName: null, authorized: false, authorizationError: null, certificate: null, handshakeError: e.message });
      return;
    }

    const fail = (message) => {
      try { socket.destroy(); } catch { /* already gone */ }
      finish({ host, port, protocol: null, cipherName: null, cipherStandardName: null, authorized: false, authorizationError: null, certificate: null, handshakeError: message });
    };
    socket.once('error', (e) => fail(e.message));
    socket.once('timeout', () => fail(`the TLS handshake timed out after ${WEB_SCAN_TIMEOUT_MS}ms`));

    socket.once('secureConnect', () => {
      let observation;
      try {
        const cert = socket.getPeerCertificate(false) || null;
        const cipher = socket.getCipher?.() || null;
        const hasCert = cert && Object.keys(cert).length > 0;
        observation = {
          host,
          port,
          protocol: socket.getProtocol?.() ?? null,
          cipherName: cipher?.name ?? null,
          cipherStandardName: cipher?.standardName ?? null,
          authorized: socket.authorized === true,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
          certificate: hasCert ? {
            subjectCommonName: cert.subject?.CN ?? null,
            // `subjectaltname` is one comma-joined string of `DNS:name` entries; the
            // Worker-side matcher wants a list, and splitting it HERE keeps the one
            // parsing quirk of Node's API at the edge that produced it.
            subjectAltNames: String(cert.subjectaltname || '')
              .split(',')
              .map((s) => s.trim().replace(/^DNS:/i, '').toLowerCase())
              .filter(Boolean),
            issuerCommonName: cert.issuer?.CN ?? null,
            issuerOrganization: cert.issuer?.O ?? null,
            valid_from: cert.valid_from ?? '',
            valid_to: cert.valid_to ?? '',
            signatureAlgorithm: cert.sigalg ?? null,
            // Node names the curve (`asn1Curve`/`nistCurve`) only for an EC key, so its
            // presence is the type discriminator; anything else with a modulus size is
            // RSA. Guessing wrong here would apply the wrong key-size floor.
            publicKeyType: (cert.asn1Curve || cert.nistCurve) ? 'ec' : (cert.bits ? 'rsa' : null),
            publicKeyBits: typeof cert.bits === 'number' ? cert.bits : null,
            // A leaf whose issuer DN equals its subject DN signed itself. Compared on
            // the rendered DN because that is all the socket gives us for both sides.
            selfSigned: JSON.stringify(cert.subject || {}) === JSON.stringify(cert.issuer || {}),
          } : null,
          handshakeError: null,
        };
      } catch (e) {
        observation = { host, port, protocol: null, cipherName: null, cipherStandardName: null, authorized: false, authorizationError: null, certificate: null, handshakeError: `the peer certificate could not be read: ${e.message}` };
      }
      try { socket.end(); } catch { /* best effort */ }
      finish(observation);
    });
  });
}

/** GET the target and return the surfaces a version fingerprint is read from. */
async function describeFingerprintSurface(origin) {
  const res = await fetch(origin, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': 'BuilderforceSecurityScanner/1.0 (+https://builderforce.ai)' },
    signal: AbortSignal.timeout(WEB_SCAN_TIMEOUT_MS),
  });
  const headers = {};
  res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  let body = '';
  const ctype = (headers['content-type'] || '').toLowerCase();
  if (ctype.includes('html') || ctype === '') {
    try { body = (await res.text()).slice(0, WEB_SCAN_BODY_LIMIT); } catch { body = ''; }
  }
  return { headers, body };
}

/**
 * Run both stages for one scan and report each independently.
 *
 * Independently is the requirement: a TLS handshake that fails must not cost the CVE
 * stage its result, and neither may end as silence — a stage that throws is posted
 * back as `error`, which the Worker records as `not_run` WITH the reason. The absence
 * of a stage report is the one outcome this function must never produce, because
 * downstream it is indistinguishable from a stage that found nothing wrong.
 */
async function runWebScanStages(spec) {
  await Promise.all([
    (async () => {
      try {
        await postWebScanStage(spec, 'tls', { tls: await describeTlsPeer(spec.host, spec.port) });
      } catch (e) {
        await postWebScanStage(spec, 'tls', { error: `the TLS stage failed inside the container: ${e.message}` });
      }
    })(),
    (async () => {
      try {
        await postWebScanStage(spec, 'cve', { cve: await describeFingerprintSurface(spec.origin) });
      } catch (e) {
        await postWebScanStage(spec, 'cve', { error: `the CVE fingerprint stage failed inside the container: ${e.message}` });
      }
    })(),
  ]);
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (isPreviewUrl(req.url)) { proxyPreviewHttp(req, res); return; }
  // Web-security-scan stages (TLS peer certificate + CVE fingerprint surface).
  // Acked immediately like /run: the stages report their own results back to the
  // Worker's ingest seam, so the Worker's dispatch never waits on a TLS handshake.
  if (req.method === 'POST' && req.url === '/web-scan') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let spec;
      try { spec = JSON.parse(raw); } catch { res.writeHead(400); res.end('bad request'); return; }
      if (!spec || typeof spec.auditId !== 'number' || !spec.token || !spec.internalBaseUrl || !spec.host || !spec.origin) {
        res.writeHead(400); res.end('missing web-scan spec fields'); return;
      }
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accepted: spec.auditId }));
      runWebScanStages(spec).catch((e) => console.error('[container] runWebScanStages crashed', e));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/run') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let spec;
      try { spec = JSON.parse(raw); } catch { res.writeHead(400); res.end('bad request'); return; }
      if (!spec || typeof spec.executionId !== 'number' || !spec.token || !spec.internalBaseUrl) {
        res.writeHead(400); res.end('missing run spec fields'); return;
      }
      // Ack immediately; the loop runs long in this persistent process so the
      // Worker's dispatch waitUntil is never blocked (no ~30s wall here).
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accepted: spec.executionId }));
      runLoop(spec).catch((e) => console.error('[container] runLoop crashed', e));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

// Proxy WebSocket upgrades (Vite/Metro HMR) for `/__preview__/*` to the dev server by
// re-issuing the handshake over a raw TCP socket and piping both directions.
server.on('upgrade', (req, socket, head) => {
  if (!isPreviewUrl(req.url) || !PREVIEW_PORT) { socket.destroy(); return; }
  const path = stripPreviewPrefix(req.url) || '/';
  const upstream = netConnect(PREVIEW_PORT, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${PREVIEW_PORT}` };
    const headerLines = Object.entries(headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n');
    upstream.write(`${req.method} ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, () => console.log(`[builderforce-agent-container] listening on :${PORT}`));
