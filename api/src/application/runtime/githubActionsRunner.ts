/**
 * The agent loop that runs ON a GitHub Actions runner — the executable half of
 * the "GitHub Actions" execution surface (`githubActionsWorkflow.ts` is the
 * committed half that fetches and starts it).
 *
 * This is `api/container/server.mjs` ported to the Actions surface. The loop, the
 * tool set, and the op protocol are deliberately the same, because the Worker
 * stays the source of truth: every LLM step, file commit, memory verb, and the
 * finalize/PR is delegated back to us, so metering, commit, and PR logic is never
 * duplicated on the runner and no DB credentials ever leave the Worker.
 *
 * Three differences from the container, all forced by the surface:
 *
 *  1. PULL, not push. Nobody can POST a run spec into a GitHub runner, so the
 *     runner asks us for its spec instead of being handed one. `workflow_dispatch`
 *     carries only the execution id; everything else is fetched.
 *
 *  2. OIDC, not HMAC. The container is our own image and holds a per-run shared
 *     secret. A tenant repo holds nothing, so the runner authenticates with the
 *     short-lived GitHub OIDC token the workflow minted — `Authorization: Bearer`
 *     on every op, verified against GitHub's JWKS. See `githubOidc.ts`.
 *
 *  3. NO CLONE. `actions/checkout` already ran, so the working tree exists before
 *     we do — the runner operates in `process.cwd()` and must not clone. Cloning
 *     would also be wrong, not just wasteful: it would discard the exact ref the
 *     dispatch asked for and any setup steps a tenant added to the workflow.
 *
 * Emitted as a string rather than shipped as a file so the route can serve it
 * with no build step and no asset pipeline, exactly as the workflow renderer
 * emits YAML. The runner is plain Node ESM with NO npm dependencies — node
 * builtins plus global fetch — because it is downloaded into a bare checkout
 * where `npm install` may not have run and must not be forced to.
 */

/**
 * Render the runner script served at `/api/runtime/github-actions/runner.mjs`.
 *
 * Kept as a plain template string for the same reason the workflow is: what you
 * read here is byte-for-byte what executes on the runner.
 */
export function renderAgentRunnerScript(): string {
  return `/**
 * Builderforce Agent Runner (GitHub Actions surface) — served by Builderforce,
 * downloaded and executed by .github/workflows/builderforce-agent.yml.
 *
 * Plain Node ESM, no dependencies. Every side effect that touches Builderforce
 * state goes through one authenticated endpoint:
 *
 *   POST $BUILDERFORCE_API/api/runtime/github-actions/op
 *   Authorization: Bearer <GitHub OIDC token>
 *   { executionId, op, args }
 *
 * Tools run LOCALLY here — a real shell and a real filesystem, against the
 * checkout actions/checkout already made in the working directory.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';

const API = String(process.env.BUILDERFORCE_API || '').replace(/\\/$/, '');
const TOKEN = process.env.BUILDERFORCE_TOKEN || '';
const EXECUTION_ID = Number(process.env.BUILDERFORCE_EXECUTION_ID || 0);

/** The checkout actions/checkout produced. We never clone; this already exists. */
const WORKDIR = process.cwd();

const MAX_LIST_ENTRIES = 500;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000; // a build/test step may take minutes
// Liveness heartbeat cadence, matching the container: the Worker reaps a cloud run
// whose last activity is older than 90s, and a single run_command can run for
// minutes with no LLM round-trip. ~3 beats fit the window, so a dropped beat is
// covered by the next.
const HEARTBEAT_MS = 30 * 1000;

if (!API || !TOKEN || !EXECUTION_ID) {
  console.error('[bf-runner] missing BUILDERFORCE_API / BUILDERFORCE_TOKEN / BUILDERFORCE_EXECUTION_ID');
  process.exit(1);
}

/** POST an op back to the Worker; returns the parsed JSON body. */
async function op(name, args) {
  const res = await fetch(API + '/api/runtime/github-actions/op', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + TOKEN,
    },
    body: JSON.stringify({ executionId: EXECUTION_ID, op: name, args: args || {} }),
  });
  if (!res.ok) throw new Error('op ' + name + ' -> ' + res.status);
  return res.json();
}

/** Run a shell command in \`cwd\`, capturing combined stdout/stderr and the exit
 *  code. \`proc\` (optional) is a holder whose \`.current\` is set to the live child so
 *  the heartbeat loop can SIGKILL an in-flight command when the run is cancelled. */
function runShell(command, cwd, proc) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], { cwd, env: process.env });
    if (proc) proc.current = child;
    let out = '';
    const cap = (chunk) => { out += chunk; if (out.length > 60000) out = out.slice(-60000); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, COMMAND_TIMEOUT_MS);
    const done = (result) => { clearTimeout(timer); if (proc && proc.current === child) proc.current = null; resolve(result); };
    child.on('close', (code) => done({ exitCode: code ?? -1, output: out }));
    child.on('error', (e) => done({ exitCode: -1, output: out + '\\n' + e.message }));
  });
}

/** Case-insensitive glob -> RegExp (mirror of packages/agent-tools \`globToRegExp\`;
 *  inlined because this runner is standalone ESM with no package imports).
 *  \`**\` crosses \`/\`, \`*\` stays within a segment, \`?\` is one non-slash char. */
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^\${}()|[\\]\\\\]/g, '\\\\$&');
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

/** A slash-free glob matches the basename at any depth; otherwise the full path. */
function matchGlob(p, pattern) {
  const re = globToRegExp(pattern);
  return pattern.includes('/') ? re.test(p) : re.test(p.slice(p.lastIndexOf('/') + 1));
}

/**
 * List repo files under \`dir\` (skipping .git/node_modules), capped. BREADTH-FIRST so
 * shallow files (root docs like ROADMAP.md) are collected before the cap is hit deep
 * in a large subtree; sorted for stable output.
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

/**
 * Git / version-control tools. The Worker persists every write as a GitHub-API
 * commit to the remote ticket branch, so the local checkout does NOT carry those
 * commits. Before any MUTATING op we fast-forward to the remote branch head
 * (absorb the API commits), then operate, then push — otherwise a local
 * reset/merge+push would clobber the agent's committed work. Read ops
 * (status/diff/history) run against the checkout directly.
 */
async function gitTool(proc, name, parsed, headBranch) {
  const safe = (v) => (typeof v === 'string' && /^[\\w./@-]+$/.test(v) ? v : null);
  const run = (cmd) => runShell(cmd, WORKDIR, proc);
  const head = safe(headBranch) || 'HEAD';
  const clip = (r) => ({ ok: r.exitCode === 0, exitCode: r.exitCode, output: r.output.slice(0, 20000) });

  if (name === 'git_status') return clip(await run('git status --short --branch'));
  if (name === 'git_diff') {
    const p = safe(parsed.path);
    return clip(await run('git --no-pager diff' + (p ? ' -- "' + p + '"' : '')));
  }
  if (name === 'git_history') {
    const p = safe(parsed.path);
    const limit = Number.isFinite(parsed.limit) && parsed.limit > 0 ? Math.min(Math.floor(parsed.limit), 200) : 30;
    return clip(await run('git --no-pager log --oneline -n ' + limit + (p ? ' -- "' + p + '"' : '')));
  }

  // Identity + absorb any Worker-side API commits the checkout is missing, so a
  // subsequent merge/reset+push builds on the agent's real latest work.
  const preamble = [
    'set -e',
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'git fetch origin "' + head + '" 2>/dev/null && git merge --ff-only "origin/' + head + '" 2>/dev/null || true',
  ];

  if (name === 'git_sync_latest') {
    const base = safe(parsed.baseBranch);
    const resolveBase = base
      ? 'BASE="' + base + '"'
      : 'BASE="$(git remote show origin 2>/dev/null | sed -n \\'s/.*HEAD branch: //p\\')"; [ -n "$BASE" ] || BASE=main';
    const cmd = [
      ...preamble,
      resolveBase,
      // checkout ran with fetch-depth: 0, so the base branch and a shared
      // merge-base are already present.
      'git fetch origin "$BASE"',
      'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
      'git push origin HEAD',
      'echo "Synced with origin/$BASE"',
    ].join('\\n');
    const r = await run(cmd);
    if (r.exitCode === 3 || /MERGE_CONFLICT/.test(r.output)) {
      return { ok: false, error: 'merge conflict — the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve the conflicting files and retry, or ask a human.', output: r.output.slice(0, 4000) };
    }
    await op('event', { toolName: 'git_sync_latest', category: 'tool', result: r.output.slice(0, 300) }).catch(() => {});
    return clip(r);
  }

  if (name === 'git_undo' || name === 'git_redo') {
    const target = name === 'git_undo' ? 'HEAD~1' : '"HEAD@{1}"';
    const msg = name === 'git_undo' ? 'Undid the last commit (use git_redo to reapply)' : 'Reapplied the last undone change';
    const cmd = [
      ...preamble,
      '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
      'git reset --hard ' + target,
      // Branch history rewound — publish it (the agent's own ticket branch).
      'git push --force-with-lease origin HEAD',
      'echo "' + msg + '"',
    ].join('\\n');
    const r = await run(cmd);
    if (r.exitCode === 4 || /\\bDIRTY\\b/.test(r.output)) {
      return { ok: false, error: 'you have uncommitted changes — commit or discard them before ' + name + ' (it refuses to discard uncommitted work).' };
    }
    await op('event', { toolName: name, category: 'tool', result: r.output.slice(0, 300) }).catch(() => {});
    return clip(r);
  }

  return { ok: false, error: "unknown git tool '" + name + "'" };
}

/** Execute one tool call. Reads/writes hit the local checkout; write also mirrors
 *  to the ticket branch via the Worker; run_command and the git_* tools run in the
 *  shell; memory_* and builtin_* relay to the Worker (no DB creds here). */
async function execTool(writtenPaths, name, parsed, proc, headBranch) {
  if (name === 'list_files') {
    return listFiles(
      WORKDIR,
      typeof parsed.path === 'string' ? parsed.path : undefined,
      typeof parsed.glob === 'string' && parsed.glob.trim() ? parsed.glob.trim() : undefined,
    );
  }
  if (name === 'read_file') {
    const path = typeof parsed.path === 'string' ? parsed.path : '';
    if (!path) return { ok: false, error: 'path is required' };
    try {
      const content = await readFile(join(WORKDIR, path), 'utf8');
      return { ok: true, path, content: content.slice(0, 100000), truncated: content.length > 100000 };
    } catch (e) { return { ok: false, error: 'read failed: ' + e.message }; }
  }
  if (name === 'write_file') {
    const path = typeof parsed.path === 'string' ? parsed.path : '';
    const content = typeof parsed.content === 'string' ? parsed.content : '';
    if (!path || !content) return { ok: false, error: 'path and content are both required' };
    const isNew = !writtenPaths.has(path);
    // Mirror to the checkout so run_command builds against the new code.
    try { await mkdir(dirname(join(WORKDIR, path)), { recursive: true }); await writeFile(join(WORKDIR, path), content); } catch { /* non-fatal; the commit is the source of truth */ }
    const r = await op('write', { path, content, summary: parsed.summary, isNew });
    if (r.ok) writtenPaths.add(path);
    return r;
  }
  if (name === 'run_command') {
    const command = typeof parsed.command === 'string' ? parsed.command : '';
    if (!command) return { ok: false, error: 'command is required' };
    const t0 = Date.now();
    const { exitCode, output } = await runShell(command, WORKDIR, proc);
    await op('event', { toolName: 'run_command', category: 'tool', detail: { command, exitCode }, result: output.slice(0, 300), durationMs: Date.now() - t0 }).catch(() => {});
    return { ok: exitCode === 0, exitCode, output: output.slice(0, 20000) };
  }
  if (name.startsWith('git_')) {
    return gitTool(proc, name, parsed, headBranch);
  }
  // Durable cross-run memory. Like the platform tools, the runner holds no DB
  // creds, so both verbs relay to the Worker's \`memory\` op — which drives the SAME
  // capability the other surfaces use, so a fact stored by an Actions run is
  // recalled by a durable or container run and vice versa.
  if (name === 'memory_recall') {
    return op('memory', { action: 'recall', query: parsed.query, limit: parsed.limit });
  }
  if (name === 'memory_remember') {
    return op('memory', { action: 'remember', key: parsed.key, content: parsed.content, tags: parsed.tags, importance: parsed.importance });
  }
  // Platform (project-management) tools — relayed to the Worker, which runs the
  // curated, subset-guarded tool in-process (create task / update OKR / read
  // remaining work).
  if (name.startsWith('builtin_')) {
    return op('platform_tool', { name, arguments: parsed });
  }
  return { ok: false, error: "unknown tool '" + name + "'" };
}

/** Drive the agent loop to completion, then finalize (PR) via the Worker. */
async function runLoop() {
  const writtenPaths = new Set();
  let finalOutput = '';
  let cancelled = false;
  let crashed = null;
  // Holds the live child process so the heartbeat can kill it on cancel.
  const proc = { current: null };
  // Liveness heartbeat: bump the run's \`updated_at\` on a timer so a long shell step
  // (build/test) doesn't look orphaned to the Worker's reaper (90s ceiling). A beat
  // that reports the run cancelled also SIGKILLs an in-flight command so a cancel
  // during a multi-minute build takes effect immediately instead of after timeout.
  const heartbeat = setInterval(() => {
    op('heartbeat', {})
      .then((r) => {
        if (r && r.cancelled) {
          cancelled = true;
          if (proc.current) proc.current.kill('SIGKILL');
        }
      })
      .catch(() => { /* a missed beat is covered by the next */ });
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  try {
    // PULL the run spec. Unlike the container, nothing was pushed to us: the
    // workflow_dispatch input carried only the execution id, so the prompt, the
    // step budget, and the branch names are fetched here.
    const spec = await op('spec', {});
    if (!spec || spec.ok === false) {
      throw new Error('could not load run spec: ' + ((spec && spec.error) || 'unknown'));
    }
    const headBranch = (spec.repo && spec.repo.headBranch) || null;

    // No clone: actions/checkout already produced the working tree we are in.
    await op('event', {
      toolName: 'runtime.checkout',
      category: 'planning',
      detail: { workdir: WORKDIR, branch: headBranch },
      result: 'using the GitHub Actions checkout at ' + WORKDIR,
    }).catch(() => {});

    const messages = [
      { role: 'system', content: spec.systemPrompt },
      { role: 'user', content: spec.userContent },
    ];
    const maxSteps = Number(spec.maxSteps) || 20;

    for (let step = 0; step < maxSteps; step++) {
      // A heartbeat may have observed a cancel (and killed an in-flight command)
      // since the last step — stop before spending another LLM call.
      if (cancelled) break;
      const turn = await op('llm', { messages });
      // A gateway LLM error (cascade exhausted: 429 / 413 context-too-big / etc.) is a
      // FAILURE, not an orderly finish — the model produced no turn. Route it to the
      // \`fail\` channel (self-heal/retry), NOT \`finalize\`, so the run is never marked
      // COMPLETED on a gateway error.
      if (turn.error) { crashed = 'gateway error: ' + turn.error; break; }
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
        const name = (tc.function && tc.function.name) || 'unknown';
        let parsed = {};
        try { parsed = tc.function && tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { /* empty */ }
        let result;
        if (name === 'finish') {
          finalOutput = typeof parsed.summary === 'string' ? parsed.summary : finalOutput;
          finished = true;
          result = { ok: true };
        } else {
          result = await execTool(writtenPaths, name, parsed, proc, headBranch);
        }
        messages.push({ role: 'tool', tool_call_id: tc.id ?? '', content: JSON.stringify(result) });
      }
      // Apply steers AFTER this turn's tool results so the agent reacts to them next
      // step. A steer also overrides a finish in the same turn: the user added work.
      for (const steer of steering) { messages.push({ role: 'user', content: steer }); finished = false; }
      if (finished) break;
    }
  } catch (e) {
    // The loop threw. Capture the REAL reason and report it on the dedicated \`fail\`
    // channel (NOT finalize, which implies an orderly finish) so the Worker can
    // self-heal or fail the run with what actually broke.
    crashed = e instanceof Error ? e.message : String(e);
  } finally {
    clearInterval(heartbeat); // stop beating before the terminal op
    // EXACTLY ONE terminal op, always: \`fail\` if the loop threw, otherwise
    // \`finalize\`. The finally block is what guarantees it — a run that dies without
    // one is left for the Worker's reaper, which is a much worse outcome than a
    // reported failure.
    if (crashed) {
      await op('fail', { error: crashed }).catch(() => {});
    } else {
      await op('finalize', { writtenPaths: [...writtenPaths], finalOutput, cancelled }).catch(() => {});
    }
  }
  return crashed;
}

const failure = await runLoop();
// Fail the GitHub job when the agent crashed, so the run is red in the Actions UI
// and not just in Builderforce. An orderly finish (including a cancel) is green.
if (failure) {
  console.error('[bf-runner] ' + failure);
  process.exit(1);
}
`;
}
