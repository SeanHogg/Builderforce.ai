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
 * Plain Node ESM (no build step) — node:22 ships global fetch + the APIs used here.
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
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
 *  in the shell; memory_* and builtin_* relay to the Worker (no DB creds here). */
async function execTool(spec, workdir, writtenPaths, name, parsed, proc) {
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
  // creds, so both verbs relay to the Worker's `memory` op — which drives the SAME
  // capability the durable surface uses, so a fact stored by a container run is
  // recalled by a durable one and vice versa.
  if (name === 'memory_recall') {
    return op(spec, { op: 'memory', args: { action: 'recall', query: parsed.query, limit: parsed.limit } });
  }
  if (name === 'memory_remember') {
    return op(spec, { op: 'memory', args: { action: 'remember', key: parsed.key, content: parsed.content, tags: parsed.tags, importance: parsed.importance } });
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

/** Drive the agent loop to completion, then finalize (PR) via the Worker. */
async function runLoop(spec) {
  let workdir = null;
  const writtenPaths = new Set();
  let finalOutput = '';
  let cancelled = false;
  let crashed = null;
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

    const messages = [
      { role: 'system', content: spec.systemPrompt },
      { role: 'user', content: spec.userContent },
    ];
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
          result = await execTool(spec, workdir, writtenPaths, name, parsed, proc);
        }
        messages.push({ role: 'tool', tool_call_id: tc.id ?? '', content: JSON.stringify(result) });
      }
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
      if (crashed) {
        await op(spec, { op: 'fail', args: { error: crashed } }).catch(() => {});
      } else {
        await op(spec, { op: 'finalize', args: { writtenPaths: [...writtenPaths], finalOutput, cancelled } }).catch(() => {});
      }
    } finally {
      if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (isPreviewUrl(req.url)) { proxyPreviewHttp(req, res); return; }
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
