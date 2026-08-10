#!/usr/bin/env node
/**
 * Builderforce "dispatch a cloud agent" GitHub Action.
 *
 * Talks to the public remote MCP server (`POST /mcp`, JSON-RPC 2.0) rather than
 * the REST API, for one reason: that endpoint is the supported machine surface
 * for a `bfk_*` tenant key, so CI needs exactly one credential and exactly one
 * URL. It is also the same door third-party MCP clients come through, which
 * means this action exercises the surface our marketplace listings advertise.
 *
 * Dependency-free on purpose — a composite/JS action that needs `npm install`
 * is a slow action, and everything here is one fetch and a poll loop.
 */

import fs from 'node:fs';

// ── The tool names this action calls ─────────────────────────────────────────
// These are ADVERTISED names (`advertisedName()` output), not catalog ids. A
// prompt or client that hand-types a catalog id calls a door that does not
// exist and fails silently — the exact failure documented in `toolNaming.ts`.
// `api/src/presentation/routes/mcpServerRoutes.test.ts` asserts every name below
// is really advertised by the catalog, so a rename breaks the build, not a user.
const TOOL = {
  createTask: 'builtin_tasks_create',
  submitExecution: 'builtin_executions_submit',
  getExecution: 'builtin_executions_get',
};

const TERMINAL = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'error', 'timeout']);
const SUCCESS = new Set(['completed', 'succeeded']);

/**
 * GitHub exports an input as `INPUT_<NAME>` with spaces — and ONLY spaces —
 * replaced by underscores, so `api-key` arrives as the hyphenated `INPUT_API-KEY`.
 * The underscore form is accepted as a fallback because a hyphenated name cannot
 * be assigned in POSIX shell syntax, which makes running this locally awkward.
 */
const input = (name) => {
  const base = `INPUT_${name.toUpperCase().replace(/ /g, '_')}`;
  return (process.env[base] ?? process.env[base.replace(/-/g, '_')] ?? '').trim();
};
const bool = (name) => /^(1|true|yes)$/i.test(input(name));

function fail(message) {
  process.stdout.write(`::error::${message}\n`);
  process.exit(1);
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  const line = `${name}=${String(value ?? '')}\n`;
  if (file) fs.appendFileSync(file, line);
  else process.stdout.write(`[output] ${line}`);
}

const endpoint = input('endpoint') || 'https://api.builderforce.ai/mcp';
const apiKey = input('api-key');
if (!apiKey) fail('api-key is required. Store your bfk_… key as a repository secret.');

let rpcId = 0;

/** One JSON-RPC round trip. Transport-level problems throw; tool errors are returned. */
async function rpc(method, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: (rpcId += 1), method, params }),
  });

  if (res.status === 401) fail('Builderforce rejected the API key (401). Check the secret is a current bfk_… tenant key.');
  if (res.status === 429) fail('Builderforce rate-limited this run (429). Retry later or reduce dispatch frequency.');

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`Builderforce returned a non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (body.error) fail(`${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

/**
 * Call one tool and unwrap it. MCP returns content blocks; the platform tools
 * answer with JSON, so prefer `structuredContent` and fall back to parsing the
 * text block for clients/servers that only emit the latter.
 */
async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = result?.content?.[0]?.text ?? '';
  if (result?.isError) fail(`${name} failed: ${text || 'unknown tool error'}`);
  if (result?.structuredContent !== undefined) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The ticket's deep link. `/projects?tab=tasks&task=<id>` opens the board with
 * that ticket's detail drawer already open — the same target the Brain's ticket
 * chips route to. `/tasks/<id>` is NOT a route; the legacy `/tasks` page only
 * redirects, so a path-style link would land on an empty board.
 */
function taskUrl(id, projectId) {
  const params = new URLSearchParams({ tab: 'tasks' });
  if (projectId != null && Number.isFinite(projectId)) params.set('project', String(projectId));
  params.set('task', String(id));
  return `https://builderforce.ai/projects?${params.toString()}`;
}

// ── 1. Resolve the ticket ────────────────────────────────────────────────────
let taskId = input('task-id') ? Number(input('task-id')) : null;
let taskProjectId = null;
let deduped = false;

if (taskId != null && Number.isNaN(taskId)) fail(`task-id must be a number, got "${input('task-id')}"`);

if (taskId == null) {
  const projectId = Number(input('project-id'));
  taskProjectId = projectId;
  const title = input('title');
  if (!Number.isFinite(projectId)) fail('project-id is required when task-id is not given.');
  if (!title) fail('title is required when task-id is not given.');

  const priority = input('priority') || 'medium';
  if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
    fail(`priority must be low, medium, high or urgent — got "${priority}"`);
  }

  const created = await callTool(TOOL.createTask, {
    projectId,
    title,
    ...(input('body') ? { description: input('body') } : {}),
    priority,
  });

  taskId = created?.id ?? created?.task?.id;
  deduped = created?.deduped === true;
  if (!taskId) fail(`Ticket creation returned no id: ${JSON.stringify(created).slice(0, 300)}`);

  // `tasks.create` auto-dispatches when the ticket lands in a lane that can start
  // work. Reporting that honestly matters: `dispatched:false` means NO agent
  // picked it up, and treating it as a start is how a stalled ticket gets
  // mistaken for one in progress.
  const autoRun = created?.autoRun;
  if (autoRun && autoRun.dispatched === false && autoRun.detail) {
    process.stdout.write(`::notice::Ticket created but not auto-started — ${autoRun.detail}\n`);
  }
}

setOutput('task-id', taskId);
setOutput('task-url', taskUrl(taskId, taskProjectId));
setOutput('deduped', String(deduped));
process.stdout.write(`${deduped ? 'Reusing' : 'Created'} Builderforce ticket #${taskId}\n`);

// ── 2. Dispatch ──────────────────────────────────────────────────────────────
const submitted = await callTool(TOOL.submitExecution, { taskId });
const executionId = submitted?.id ?? submitted?.execution?.id ?? null;
setOutput('execution-id', executionId ?? '');

if (executionId == null) {
  process.stdout.write('::warning::Builderforce accepted the ticket but returned no execution id; nothing to wait for.\n');
  setOutput('status', 'dispatched');
  process.exit(0);
}

process.stdout.write(`Dispatched execution #${executionId}\n`);

if (!bool('wait')) {
  setOutput('status', 'dispatched');
  process.exit(0);
}

// ── 3. Wait ──────────────────────────────────────────────────────────────────
const timeoutMs = Math.max(1, Number(input('timeout-minutes') || '30')) * 60_000;
const deadline = Date.now() + timeoutMs;
// Back off from 5s to 30s: a short run should report quickly, a long one should
// not spend the whole window burning rate-limit budget on polls.
let intervalMs = 5_000;
let status = 'unknown';

while (Date.now() < deadline) {
  await sleep(intervalMs);
  intervalMs = Math.min(intervalMs * 1.5, 30_000);

  const execution = await callTool(TOOL.getExecution, { id: executionId });
  status = String(execution?.status ?? 'unknown').toLowerCase();
  if (TERMINAL.has(status)) break;
}

setOutput('status', status);

if (!TERMINAL.has(status)) {
  const message = `Execution #${executionId} did not finish within ${input('timeout-minutes') || '30'} minutes (last status: ${status}).`;
  if (bool('fail-on-error')) fail(message);
  process.stdout.write(`::warning::${message}\n`);
  process.exit(0);
}

if (SUCCESS.has(status)) {
  process.stdout.write(`::notice::Execution #${executionId} ${status}.\n`);
  process.exit(0);
}

const message = `Execution #${executionId} ended as ${status}.`;
if (bool('fail-on-error')) fail(message);
process.stdout.write(`::warning::${message}\n`);
