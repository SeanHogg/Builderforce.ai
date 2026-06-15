/**
 * BuilderForce Agent Container — the long-lived process behind a "V2 Cloud Agent
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
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = Number(process.env.PORT || 8080);
const MAX_LIST_ENTRIES = 500;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000; // a build/test step may legitimately take minutes

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

/** Run a shell command in `cwd`, capturing combined stdout/stderr and the exit code. */
function runShell(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], { cwd, env: process.env });
    let out = '';
    const cap = (chunk) => { out += chunk; if (out.length > 60_000) out = out.slice(-60_000); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, COMMAND_TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, output: out }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ exitCode: -1, output: `${out}\n${e.message}` }); });
  });
}

/** Recursively list repo files under `dir` (skipping .git/node_modules), capped. */
async function listFiles(dir, sub) {
  const root = sub ? join(dir, sub) : dir;
  const acc = [];
  async function walk(d) {
    if (acc.length >= MAX_LIST_ENTRIES) return;
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (acc.length >= MAX_LIST_ENTRIES) return;
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else acc.push(relative(dir, full).split(sep).join('/'));
    }
  }
  await walk(root);
  return { ok: true, paths: acc, truncated: acc.length >= MAX_LIST_ENTRIES };
}

/** Execute one tool call. Repo reads/writes hit local disk (the clone); write also
 *  mirrors to the ticket branch via the Worker; run_command runs in the shell. */
async function execTool(spec, workdir, writtenPaths, name, parsed) {
  if (name === 'list_files') {
    if (!workdir) return { ok: false, error: 'no repository bound to this task' };
    return listFiles(workdir, typeof parsed.path === 'string' ? parsed.path : undefined);
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
    const { exitCode, output } = await runShell(command, workdir);
    await op(spec, { op: 'event', args: { toolName: 'run_command', category: 'tool', detail: { command, exitCode }, result: output.slice(0, 300), durationMs: Date.now() - t0 } }).catch(() => {});
    return { ok: exitCode === 0, exitCode, output: output.slice(0, 20_000) };
  }
  return { ok: false, error: `unknown tool '${name}'` };
}

/** Drive the agent loop to completion, then finalize (PR) via the Worker. */
async function runLoop(spec) {
  let workdir = null;
  const writtenPaths = new Set();
  let finalOutput = '';
  let cancelled = false;
  let crashed = null;
  try {
    if (spec.repo && spec.repo.cloneUrl) {
      workdir = await mkdtemp(join(tmpdir(), `bf-exec-${spec.executionId}-`));
      const branch = spec.repo.baseBranch ? `-b ${spec.repo.baseBranch}` : '';
      const clone = await runShell(`git clone --depth 1 ${branch} "${spec.repo.cloneUrl}" .`, workdir);
      if (clone.exitCode !== 0) {
        await op(spec, { op: 'event', args: { toolName: 'runtime.clone', category: 'planning', result: `clone failed: ${clone.output.slice(0, 200)}` } }).catch(() => {});
        workdir = null; // continue without a shell workspace; writes still commit via the Worker
      }
    }

    const messages = [
      { role: 'system', content: spec.systemPrompt },
      { role: 'user', content: spec.userContent },
    ];
    const maxSteps = Number(spec.maxSteps) || 20;

    for (let step = 0; step < maxSteps; step++) {
      const turn = await op(spec, { op: 'llm', args: { messages } });
      if (turn.error) { finalOutput = turn.error; break; }
      if (turn.cancelled) { cancelled = true; break; }
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
          result = await execTool(spec, workdir, writtenPaths, name, parsed);
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

server.listen(PORT, () => console.log(`[builderforce-agent-container] listening on :${PORT}`));
