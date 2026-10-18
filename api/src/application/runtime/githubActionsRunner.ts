/**
 * The agent loop that runs ON a GitHub Actions runner — the executable half of
 * the "GitHub Actions" execution surface (`githubActionsWorkflow.ts` is the
 * committed half that fetches and starts it).
 *
 * This is `api/container/server.mjs` ported to the Actions surface. The loop (the
 * shared kernel + `agentImageLoop.mjs`, inlined), the tool set, and the op protocol
 * are deliberately the same, because the Worker
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

import { AGENT_RELAY_INLINE } from './generated/agentRelaySource';
import { AGENT_LOOP_INLINE } from './generated/agentLoopSource';
import { CODE_ANALYSIS_INLINE } from './generated/codeAnalysisSource';

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

// ── The shared Worker-relay dispatch table ──────────────────────────────────────
// Inlined VERBATIM from api/container/agentRelay.mjs — the same file the Cloudflare
// Container image imports. It is copied in rather than imported because this runner is
// one standalone file downloaded into a bare checkout, and it is GENERATED rather than
// re-typed because a hand-kept second copy is exactly the drift that used to force a
// capability to lag the deployed image. \`check:agent-relay\` fails the build if this
// copy and the module diverge.
${AGENT_RELAY_INLINE}
${CODE_ANALYSIS_INLINE}

// ── THE agent loop ─────────────────────────────────────────────────────────────
// Inlined VERBATIM from api/container/agentLoop.mjs (the @builderforce/agent-loop kernel,
// compiled by api/scripts/gen-agent-loop-bundle.mjs) and api/container/agentImageLoop.mjs
// (the image semantics on its hooks) — the same two files the Cloudflare Container
// imports, so both images run one loop. \`check:agent-loop\` fails the build if this
// copy drifts from them or the kernel source.
${AGENT_LOOP_INLINE}

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
 * Scope-aware glob: \`sub\` is where the walk started, so a glob written against THAT
 * folder must resolve against the scope-relative path too. Filtering only the
 * repo-root-relative path silently dropped every match (and the tool's zero-match
 * note then reported real files as missing). Mirrors \`matchGlobInScope\` in
 * \`@builderforce/agent-tools\` — this runner generates its own script text, so it
 * keeps a local copy.
 */
function matchGlobScoped(p, pattern, sub) {
  const scope = (sub ?? '').split('\\\\').join('/').trim().replace(/^\\.\\/+/, '').replace(/^\\/+|\\/+$/g, '');
  if (!scope) return matchGlob(p, pattern);
  if (p !== scope && !p.startsWith(scope + '/')) return false;
  return matchGlob(p, pattern) || matchGlob(p.slice(scope.length + 1), pattern);
}

/**
 * List repo files under \`dir\` (skipping .git/node_modules), capped. BREADTH-FIRST so
 * shallow files (root docs like ROADMAP.md) are collected before the cap is hit deep
 * in a large subtree; sorted for stable output.
 *
 * A GLOB IS APPLIED DURING THE WALK, not after it. Capping first and globbing only
 * the surviving 5,000 paths makes "0 matches" mean "not among the first 5,000", which
 * the agent read as "the file does not exist" — it then went hunting for hand-rolled
 * finders. With a glob the cap counts MATCHES, so a huge repo returns all 223
 * \`*.test.ts\` files instead of zero.
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
        const rel = relative(dir, full).split(sep).join('/');
        if (glob && !matchGlobScoped(rel, glob, sub)) continue;
        if (acc.length >= MAX_LIST_ENTRIES) { truncated = true; break; }
        acc.push(rel);
      }
    }
  }
  acc.sort((a, b) => a.localeCompare(b));
  return { ok: true, paths: acc, truncated };
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
    await op('event', { toolName: 'git_sync_latest', category: 'tool', result: r.output.slice(0, 300) })
      .catch((error) => console.error('[bf-runner] git_sync_latest telemetry failed', error));
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
    await op('event', { toolName: name, category: 'tool', result: r.output.slice(0, 300) })
      .catch((error) => console.error('[bf-runner] git history telemetry failed', error));
    return clip(r);
  }

  return { ok: false, error: "unknown git tool '" + name + "'" };
}

/** Execute one tool call. Reads/writes hit the local checkout; write also mirrors
 *  to the ticket branch via the Worker; run_command and the git_* tools run in the
 *  shell; memory_* and builtin_* relay to the Worker (no DB creds here). */
async function execTool(writtenPaths, name, parsed, proc, headBranch, loop) {
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
    try {
      await mkdir(dirname(join(WORKDIR, path)), { recursive: true });
      await writeFile(join(WORKDIR, path), content);
    } catch (error) {
      console.error('[bf-runner] local checkout mirror write failed; remote commit remains source of truth', { path, error });
    }
    const r = await op('write', { path, content, summary: parsed.summary, isNew });
    if (r.ok) writtenPaths.add(path);
    return r;
  }
  if (name === 'analyze_codebase') {
    return runCodeAnalysis(parsed, {
      run: async (command) => { const r = await runShell(command, WORKDIR, proc); return { ok: r.exitCode === 0, exitCode: r.exitCode, stdout: r.output }; },
      read: async (path) => ({ ok: true, content: await readFile(join(WORKDIR, path), 'utf8') }),
      persist: async (snapshot) => { const r = await op('audit_analysis', { snapshot }); if (!r.ok) throw new Error('Could not persist analyzer snapshot'); },
    });
  }
  if (name === 'run_command') {
    const command = typeof parsed.command === 'string' ? parsed.command : '';
    if (!command) return { ok: false, error: 'command is required' };
    const t0 = Date.now();
    const { exitCode, output } = await runShell(command, WORKDIR, proc);
    await op('event', { toolName: 'run_command', category: 'tool', detail: { command, exitCode }, result: output.slice(0, 300), durationMs: Date.now() - t0 })
      .catch((error) => console.error('[bf-runner] run_command telemetry failed', error));
    return { ok: exitCode === 0, exitCode, output: output.slice(0, 20000) };
  }
  if (name.startsWith('git_')) {
    return gitTool(proc, name, parsed, headBranch);
  }
  // Everything else the model can call is backed by the WORKER, not by this job:
  // durable memory, the ticket PRD, coordination leases + blackboard, web search,
  // delegation, the curated platform tools and the human-in-the-loop pause. All of it
  // is dispatched by the SHARED relay table inlined above — the same code the
  // Cloudflare Container image imports — so the two image surfaces cannot drift apart
  // in what they can execute. \`null\` means "not a relayed tool", which here means
  // nothing implements it.
  const relayed = await execRelayTool(op, name, parsed, {
    messages: loop && Array.isArray(loop.messages) ? loop.messages : [],
    step: loop && typeof loop.step === 'number' ? loop.step : 0,
    toolCallId: (loop && loop.toolCallId) || '',
    toolCallIds: (loop && loop.toolCallIds) || [],
    writtenPaths,
  });
  if (relayed !== null) return relayed;
  return { ok: false, error: "unknown tool '" + name + "'" };
}

/**
 * Drive the agent loop to completion, then finalize (PR) via the Worker.
 *
 * THREE ways out, and exactly one terminal op each: finished/cancelled -> \`finalize\`,
 * threw -> \`fail\`, and asked a human -> NEITHER (the run is parked in \`paused\` by the
 * \`ask_human\` op and this job exits clean; answering it re-dispatches the workflow).
 */
async function runLoop() {
  const writtenPaths = new Set();
  let finalOutput = '';
  let cancelled = false;
  let crashed = null;
  // Set when the agent called ask_human: the run is parked, not over.
  let paused = false;
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
      .catch((error) => console.error('[bf-runner] heartbeat failed; next interval will retry', error));
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
    }).catch((error) => console.error('[bf-runner] checkout telemetry failed', error));

    // A RESUMED run continues the conversation the previous job exited with; the
    // human's answer arrives separately as a pending steer the Worker injects into
    // the next \`llm\` op. Only a fresh run starts from the task prompt.
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
    // THE agent loop — the shared kernel with the image semantics on its hooks,
    // inlined above from the same two files the container imports. No step cap: the
    // kernel's failure-streak breaker is the only limit. This runner makes NO model
    // decision: the Worker's \`llm\` op owns the run's model hand-off policy, and a turn
    // that only narrated comes back with a re-prompt in \`steering\`.
    const outcome = await runImageLoop({
      messages,
      // This runner's capability HANDSHAKE — see SUPPORTED_TOOL_NAMES in the relay
      // table above. The Worker advertises the intersection of what the surface's
      // capability set permits and what this script can actually dispatch, so a new
      // capability never has to wait for every runner to be redeployed.
      llm: (transcript) => op('llm', { messages: transcript, supportedTools: SUPPORTED_TOOL_NAMES }),
      execTool: (name, parsed, loop) => execTool(writtenPaths, name, parsed, proc, headBranch, loop),
      // A heartbeat may have observed a cancel (and killed an in-flight command)
      // since the last step — stop before spending another LLM call.
      isCancelled: () => cancelled,
    });
    finalOutput = outcome.output;
    if (outcome.cancelled) cancelled = true;
    // A gateway error goes to the \`fail\` channel (self-heal/retry), never \`finalize\`.
    if (outcome.crashed) crashed = outcome.crashed;
    // Parked on a human question (a tool result reported \`result.paused\`): the
    // \`ask_human\` op already parked the row, so this job exits without a terminal op.
    if (outcome.paused) paused = true;
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
    // A PAUSED run posts NOTHING: the \`ask_human\` op already parked the row and
    // persisted the resume state. \`finalize\` would open a PR on half-done work and
    // \`fail\` would mark an answerable run as failed.
    if (paused) {
      if (crashed) {
        await op('event', { toolName: 'runtime.paused_exit', category: 'error', result: ('runner exited after pausing, with an error: ' + crashed).slice(0, 300) })
          .catch((error) => console.error('[bf-runner] paused-exit telemetry failed', error));
      }
    } else if (crashed) {
      await op('fail', { error: crashed }).catch((error) => console.error('[bf-runner] terminal fail callback failed', error));
    } else {
      await op('finalize', { writtenPaths: [...writtenPaths], finalOutput, cancelled })
        .catch((error) => console.error('[bf-runner] terminal finalize callback failed', error));
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
