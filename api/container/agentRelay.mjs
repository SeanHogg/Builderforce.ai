/**
 * THE Worker-relayed tool dispatch — one implementation, every image surface.
 *
 * Two long-lived surfaces execute their own agent loop in their own process: the
 * Cloudflare Container (`api/container/server.mjs`) and the GitHub Actions runner
 * (rendered by `api/src/application/runtime/githubActionsRunner.ts`). Neither can
 * import the TypeScript tool registry — the container image has no build step and the
 * runner is downloaded into a bare checkout where `npm install` may not have run — so
 * for a long time each image carried its OWN hand-written copy of the same dispatch
 * table. That is what made a new tool a THREE-file change and made a capability have
 * to lag the deployed image: `CONTAINER_SURFACE_CAPS` could only advertise what the
 * least-recently-deployed copy happened to implement.
 *
 * This module is that table, once. It is plain ESM with NO imports (not even node
 * builtins), which is what lets it be BOTH:
 *   • imported directly by the container image, which ships this file beside it, and
 *   • inlined verbatim into the single-file Actions runner script, from the generated
 *     `api/src/application/runtime/generated/agentRelaySource.ts`.
 * A ratchet (`api/scripts/gen-agent-relay-source.mjs --check`) fails the build if that
 * generated copy drifts from this file, so "the source of truth" is not a convention
 * someone has to remember.
 *
 * What lives here is exactly the set of tools whose backing is the WORKER: durable
 * memory, the ticket PRD, coordination leases + blackboard, web search, the curated
 * platform tools, the human-in-the-loop pause, delegation, and skill authoring. What does NOT live here
 * is everything genuinely surface-shaped — `list_files`, `read_file`, `write_file`,
 * `run_command` and the `git_*` family all touch a local filesystem/shell that the two
 * images obtain differently (the container clones; Actions gets a checkout), so each
 * image keeps its own.
 *
 * The one thing each image must supply is `op(name, args) => Promise<object>`: post a
 * container-op back to the Worker and return the parsed body. The container authenticates
 * with a per-run HMAC token, the runner with a GitHub OIDC bearer — a difference this
 * module deliberately knows nothing about.
 */

/**
 * Tool names this module dispatches. A trailing `*` is a PREFIX match (the platform
 * catalog is relayed wholesale, so an image supports every `builtin_` tool the Worker
 * chooses to advertise without needing to be redeployed for each one).
 *
 * Sent to the Worker on every `llm` op as the image's capability handshake — see
 * `supportedToolNames` below.
 */
export const RELAY_TOOL_NAMES = [
  'memory_recall',
  'memory_remember',
  'memory_forget',
  'update_prd',
  'claim_resource',
  'release_resource',
  'workspace_note',
  'workspace_read',
  'web_search',
  'ask_human',
  'spawn_agent',
  'skill_propose',
  'skill_list',
  'builtin_*',
];

/**
 * Tool names an image implements ITSELF, against its own filesystem and shell. Both
 * images that run this module implement all of them — the container against the clone
 * it made, the runner against the checkout `actions/checkout` produced — so the list is
 * shared even though the implementations are not.
 *
 * `finish` is the loop's own control signal rather than a dispatched tool, and is
 * included because the handshake describes what the image can HANDLE, and it handles it.
 */
export const IMAGE_LOCAL_TOOL_NAMES = [
  'finish',
  'list_files',
  'read_file',
  'write_file',
  'run_command',
  'git_status',
  'git_diff',
  'git_history',
  'git_sync_latest',
  'git_undo',
  'git_redo',
];

/**
 * The image's capability handshake: every tool name this process can actually
 * dispatch. Sent with each `llm` op so the Worker advertises the INTERSECTION of what
 * the surface's capability set permits and what the calling image implements.
 *
 * This is what retires the rule that a capability had to follow the deployed image. A
 * new tool can be added to `CONTAINER_SURFACE_CAPS` the moment its Worker-side op
 * exists: an image that predates the tool simply does not name it here and is never
 * offered it, instead of being offered a tool it would answer with `unknown tool`.
 */
export const SUPPORTED_TOOL_NAMES = [...IMAGE_LOCAL_TOOL_NAMES, ...RELAY_TOOL_NAMES];

/** Trimmed string, or '' for anything that is not a non-empty string. */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Dispatch one Worker-relayed tool call.
 *
 * @param op     Post a container-op and return the parsed body: `(name, args) => Promise<object>`.
 * @param name   The tool the model called.
 * @param parsed The call's already-JSON-parsed arguments.
 * @param loop   The image's live loop state, needed only by the two tools that
 *               suspend or branch the run: `{ messages, step, toolCallId, toolCallIds,
 *               writtenPaths }`. `writtenPaths` is the image's own live `Set` — passed
 *               rather than copied because a delegated child's commits must land in it,
 *               and doing that merge HERE is what keeps it from being transcribed into
 *               both images.
 * @returns      The tool result to push onto the transcript, or `null` when `name` is
 *               not a relayed tool — the image then tries its own local table and is
 *               the one that decides what an unknown tool means.
 */
export async function execRelayTool(op, name, parsed, loop) {
  const state = loop || {};

  // ── Durable cross-run memory ────────────────────────────────────────────────
  // The images hold no DB credentials, so all three verbs relay to the Worker's
  // `memory` op — which drives the SAME governed capability the durable surface uses
  // (scope chain, provenance, TTL), so a fact stored by a container run is recalled by
  // an Actions or durable run and vice versa, under one set of rules.
  if (name === 'memory_recall') {
    return op('memory', { action: 'recall', query: parsed.query, limit: parsed.limit });
  }
  if (name === 'memory_remember') {
    return op('memory', {
      action: 'remember',
      key: parsed.key,
      content: parsed.content,
      tags: parsed.tags,
      importance: parsed.importance,
      // How widely the fact applies and when it lapses. The Worker resolves the
      // concrete scope owner from the run.
      scope: parsed.scope,
      ttl_days: parsed.ttl_days,
    });
  }
  if (name === 'memory_forget') {
    return op('memory', { action: 'forget', key: parsed.key });
  }

  // ── The ticket's PRD ────────────────────────────────────────────────────────
  // It lives in the platform's spec store, not the checkout, so both modes relay to
  // the Worker's `prd` op — the same capability the durable loop calls, so an
  // `update_prd` on an image surface lands identically to one on that surface.
  if (name === 'update_prd') {
    return op('prd', {
      action: parsed.mode === 'section' ? 'section' : 'append',
      section: parsed.section,
      content: parsed.content,
    });
  }

  // ── Multi-agent leases + the shared blackboard ──────────────────────────────
  // The Worker owns both stores; the images only relay the four verbs.
  if (name === 'claim_resource') {
    return op('coordinate', { action: 'claim', resource: parsed.resource, mode: parsed.mode, reason: parsed.reason });
  }
  if (name === 'release_resource') {
    return op('coordinate', { action: 'release', resource: parsed.resource });
  }
  if (name === 'workspace_note') {
    return op('coordinate', { action: 'note', key: parsed.key, content: parsed.content });
  }
  if (name === 'workspace_read') {
    return op('coordinate', { action: 'read', query: parsed.query, limit: parsed.limit });
  }

  // ── Web search ──────────────────────────────────────────────────────────────
  // Relayed for the reason memory is: the vendor credential, the shared read-through
  // cache and the spend meter all live in the Worker. Deliberately NOT web FETCH —
  // an image with a shell can already curl.
  if (name === 'web_search') {
    const query = text(parsed.query);
    if (!query) return { ok: false, error: 'query is required' };
    return op('search', { query });
  }

  // ── Skill authoring ─────────────────────────────────────────────────────────
  // A run that worked out a repeatable procedure proposes it as a skill DRAFT. Both
  // verbs relay to the Worker's `skill` op, which runs the same tool definitions
  // against the same authoring service the durable surface uses — so the proposal is
  // validated identically and can only ever land as a draft awaiting human review.
  // The arguments pass through untouched: the tool's own validation is the authority.
  if (name === 'skill_propose') {
    return op('skill', {
      action: 'propose',
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      evidence: parsed.evidence,
    });
  }
  if (name === 'skill_list') {
    return op('skill', { action: 'list' });
  }

  // ── Delegation ──────────────────────────────────────────────────────────────
  // The child RUN happens in the WORKER, not here, and that is the point: an image
  // has no gateway credential, no metering and no tool registry, so a nested loop run
  // in this process would have to reimplement all three. Relaying means a sub-agent
  // spawned from a container is the same sub-agent the durable surface spawns —
  // `runSubagent` from the shared kernel, the same budget, the same withheld
  // capabilities (a child never gets `orchestrate`, so recursion is impossible by
  // construction rather than by a depth counter), the same timeline event.
  //
  // The call is synchronous from the image's point of view: one op that returns when
  // the child has finished. That is a long op, so the Worker heartbeats the run while
  // the child works and the image's own heartbeat timer keeps beating throughout —
  // a delegation is never mistaken for a dead run by the orphan reaper.
  if (name === 'spawn_agent') {
    const task = text(parsed.task);
    if (!task) {
      return { ok: false, error: 'task is required — the child sees none of your conversation' };
    }
    const spawned = await op('spawn', {
      task,
      label: text(parsed.label) || task.slice(0, 60),
      // Default read-only, matching the tool's own contract on every other surface: a
      // parent asking for a writable child must say so.
      read_only: parsed.read_only !== false,
    });
    // A writable child commits through the Worker, so its files are on the ticket
    // branch but not yet in THIS process's set — and `finalize` reports that set. Merge
    // them or the PR lists every file except the ones the sub-agent wrote.
    if (spawned && Array.isArray(spawned.writtenPaths) && state.writtenPaths) {
      for (const path of spawned.writtenPaths) if (typeof path === 'string') state.writtenPaths.add(path);
    }
    return spawned;
  }

  // ── Human-in-the-loop ───────────────────────────────────────────────────────
  // The one tool that ENDS the image's process. Neither surface can sit blocked
  // waiting for an answer — the container is billed by the second and can be
  // recycled, and an Actions job has a hard wall-clock limit and burns the tenant's
  // minutes — so the pause is exit-and-redispatch, not block-and-poll: hand the
  // Worker the conversation, it parks the run, the process exits WITHOUT a terminal
  // op, and answering the question starts a fresh process seeded with this
  // conversation plus the answer.
  //
  // We deliberately send `messages` rather than a summary: the resumed process must
  // continue the run, not re-derive it.
  if (name === 'ask_human') {
    const question = text(parsed.question);
    if (!question) return { ok: false, error: 'question is required to ask a human' };
    const r = await op('ask_human', {
      question,
      context: typeof parsed.context === 'string' ? parsed.context : undefined,
      messages: Array.isArray(state.messages) ? state.messages : [],
      writtenPaths: state.writtenPaths ? [...state.writtenPaths] : [],
      step: typeof state.step === 'number' ? state.step : 0,
      // This turn's tool-call ids, so the Worker can close the pairing before it
      // freezes the transcript: our own call has no result yet, and any sibling call
      // never runs because the loop stops here.
      toolCallId: state.toolCallId || '',
      toolCallIds: state.toolCallIds || [],
    });
    // `paused` is what stops the loop; anything else (a cancelled run, a rejected
    // question) is an ordinary tool failure the agent can react to.
    if (r && r.paused) return { ok: true, paused: true, note: r.note };
    return r && typeof r === 'object' ? r : { ok: false, error: 'could not park the run on a human question' };
  }

  // ── The curated platform (project-management) tools ─────────────────────────
  // Relayed wholesale: the Worker runs the subset-guarded tool in-process (create
  // task / update OKR / read remaining work) against credentials the image lacks.
  if (name.startsWith('builtin_')) {
    return op('platform_tool', { name, arguments: parsed });
  }

  // Not ours. The image tries its own local table next.
  return null;
}
