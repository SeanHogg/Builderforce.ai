#!/usr/bin/env node
/**
 * AgentHost API-contract mirror guard.
 *
 * `api/src/openapi/schema.ts` declares the BuilderForce Agents ↔ Builderforce HTTP
 * and relay contract. `agent-runtime/src/infra/api-contract.ts` RE-DECLARES the
 * same interfaces by hand — deliberately, so the agent host takes no runtime
 * dependency on the Worker package (it is a published plugin SDK with its own
 * dependency graph and its own release cadence).
 *
 * Two hand-written copies of one wire format is a drift machine, and it had
 * already drifted: `ApprovalDecisionMessage` grew `responseText` on the sending
 * side while the receiving side's declaration never learned about it — the field
 * the whole "answer a question" flow rides on. That is the class of bug this
 * guard exists to make impossible: the contract may only change in BOTH files, in
 * the same commit.
 *
 * ── WHAT IS COMPARED ─────────────────────────────────────────────────────────
 * Each exported `interface` is reduced to a sorted list of `name: type` members,
 * with comments, quote style and whitespace normalised away. The comparison then
 * runs over the intersection declared in {@link MIRRORED}, which names the api
 * interface and its agent-runtime twin — a pair, because one of them is renamed.
 *
 * ── THE ONE DECLARED DIFFERENCE ──────────────────────────────────────────────
 * agent-runtime speaks "agentNode" where the platform says "agentHost" (an older
 * name for the same thing, still load-bearing in its public tool surface and its
 * env vars — `BUILDERFORCE_AGENT_NODE_ID`). Renaming it there is an SDK-breaking
 * change, not a mirror fix, so the vocabulary difference is DECLARED here and
 * normalised on both sides ({@link normalizeVocabulary}) rather than flagged
 * every run. Every other difference is drift and fails the build.
 *
 * Run via `npm run check:api-contract-mirror`; wired into `npm test` through
 * `scripts/checks.manifest.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const API_SCHEMA = resolve(here, '../src/openapi/schema.ts');
const RUNTIME_CONTRACT = resolve(here, '../../agent-runtime/src/infra/api-contract.ts');

/**
 * The mirrored pairs: `[api interface, agent-runtime interface]`.
 *
 * An interface that exists on only ONE side is intentional and stays out of this
 * list — the api's `OPENAPI_*` document constants have no agent-side twin, and an
 * SDK-private shape has no business in the platform's schema. Adding a mirrored
 * interface to one file and not the other is caught by the "declared but missing"
 * check below, which is why the list is the contract rather than a convenience.
 */
const MIRRORED = [
  ['AgentHostRegistration', 'AgentNodeRegistration'],
  ['HeartbeatPayload', 'HeartbeatPayload'],
  ['RemoteTaskPayload', 'RemoteTaskPayload'],
  ['TelemetrySpan', 'TelemetrySpan'],
  ['DirectorySyncPayload', 'DirectorySyncPayload'],
  ['TaskAssignMessage', 'TaskAssignMessage'],
  ['TaskBroadcastMessage', 'TaskBroadcastMessage'],
  ['ApprovalDecisionMessage', 'ApprovalDecisionMessage'],
  ['FleetEntry', 'FleetEntry'],
  ['WorkflowGraphNode', 'WorkflowGraphNode'],
  ['WorkflowGraphEdge', 'WorkflowGraphEdge'],
  ['WorkflowGraph', 'WorkflowGraph'],
  ['TeamMemoryEntry', 'TeamMemoryEntry'],
  ['ContextBundleResponse', 'ContextBundleResponse'],
];

/** The declared vocabulary difference, applied to both sides before comparing. */
function normalizeVocabulary(text) {
  return text.replace(/AgentNode/g, 'AgentHost').replace(/agentNode/g, 'agentHost');
}

/** Strip comments so a doc-comment rewrite is never reported as contract drift. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Collapse a member's type to a comparable form: one line, single-quoted string
 * literals, no incidental spacing. `type: "task.assign"` and `type: 'task.assign'`
 * are the same contract; only the members and their types are the contract.
 */
function normalizeType(type) {
  return type
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}<>|;,])\s*/g, '$1')
    .replace(/;+\}/g, '}')
    .replace(/\{/g, '{ ')
    .replace(/\}/g, ' }')
    .trim();
}

/**
 * Split an interface body into `name: type` members at DEPTH ZERO, so a nested
 * object member (`metadata?: { source?: string; … }`) stays one member rather
 * than being shredded into its own fields.
 */
function splitMembers(body) {
  const members = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '{' || char === '(' || char === '[' || char === '<') depth += 1;
    if (char === '}' || char === ')' || char === ']' || char === '>') depth -= 1;
    if ((char === ';' || char === ',' || char === '\n') && depth === 0) {
      if (current.trim()) members.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) members.push(current.trim());
  return members;
}

/** `{ [interfaceName]: Map<memberName, normalizedType> }` for one contract file. */
function parseInterfaces(file) {
  const source = normalizeVocabulary(stripComments(readFileSync(file, 'utf8')));
  const out = new Map();
  const header = /export\s+interface\s+([A-Za-z0-9_]+)\s*\{/g;
  let match;
  while ((match = header.exec(source)) !== null) {
    let depth = 1;
    let index = header.lastIndex;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      index += 1;
    }
    const members = new Map();
    for (const member of splitMembers(source.slice(header.lastIndex, index - 1))) {
      const colon = member.indexOf(':');
      if (colon <= 0) continue;
      members.set(member.slice(0, colon).trim(), normalizeType(member.slice(colon + 1)));
    }
    out.set(match[1], members);
    header.lastIndex = index;
  }
  return out;
}

if (!existsSync(RUNTIME_CONTRACT)) {
  // agent-runtime is a sibling workspace, not an api dependency. A checkout that
  // does not contain it (a sparse clone, a published-package consumer) has nothing
  // to mirror — that is not a contract failure.
  console.log('⏭️  API-contract mirror skipped — agent-runtime/src/infra/api-contract.ts is not in this checkout.');
  process.exit(0);
}

const apiSide = parseInterfaces(API_SCHEMA);
const runtimeSide = parseInterfaces(RUNTIME_CONTRACT);
const problems = [];

for (const [apiName, runtimeName] of MIRRORED) {
  // After normalizeVocabulary, `AgentNodeRegistration` IS `AgentHostRegistration`.
  const runtimeKey = normalizeVocabulary(runtimeName);
  const apiMembers = apiSide.get(normalizeVocabulary(apiName));
  const runtimeMembers = runtimeSide.get(runtimeKey);

  if (!apiMembers) {
    problems.push(`${apiName}: declared mirrored, but not exported from src/openapi/schema.ts.`);
    continue;
  }
  if (!runtimeMembers) {
    problems.push(`${runtimeName}: declared mirrored, but not exported from agent-runtime/src/infra/api-contract.ts.`);
    continue;
  }

  for (const [member, type] of apiMembers) {
    if (!runtimeMembers.has(member)) {
      problems.push(`${apiName}.${member}: declared in the api, missing from agent-runtime's ${runtimeName}.`);
    } else if (runtimeMembers.get(member) !== type) {
      problems.push(
        `${apiName}.${member}: type differs — api \`${type}\`, agent-runtime \`${runtimeMembers.get(member)}\`.`,
      );
    }
  }
  for (const member of runtimeMembers.keys()) {
    if (!apiMembers.has(member)) {
      problems.push(`${runtimeName}.${member}: declared in agent-runtime, missing from the api's ${apiName}.`);
    }
  }
}

if (problems.length > 0) {
  console.error(`❌  API contract mirror drifted (${problems.length}):\n`);
  for (const problem of problems) console.error(`      - ${problem}`);
  console.error(
    '\n   api/src/openapi/schema.ts and agent-runtime/src/infra/api-contract.ts declare' +
      '\n   ONE wire format twice, on purpose — the agent host takes no runtime dependency' +
      '\n   on the Worker package. Change BOTH, in the same commit. The only difference this' +
      "\n   guard tolerates is the SDK's `agentNode` vocabulary for the platform's `agentHost`;" +
      '\n   anything else means a message one side sends is a message the other cannot read.\n',
  );
  process.exit(1);
}

console.log(`✅  API contract mirror OK — ${MIRRORED.length} interface(s) identical across both declarations.`);
