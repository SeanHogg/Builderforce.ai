/**
 * Tool schemas + step budgets for the cloud agent loops — the durable/Worker
 * surface (`CLOUD_AGENT_TOOLS`, provider-API-backed, no shell) and the long-lived
 * Container surface (`CONTAINER_AGENT_TOOLS`, real shell via `run_command`).
 *
 * Extracted from the runtime routes so the schema lives in ONE place that both the
 * in-Worker loop and the container-op `llm` handler import — no duplication, and
 * the routes file stops being a god module that also owns the tool catalogue.
 */

/** Shape of one tool call in an OpenAI-compatible completion response. */
export interface RawToolCall { id?: string; type?: string; function?: { name?: string; arguments?: string } }

/** True when a finish summary claims a build / type-check / lint / test passed —
 *  which the serverless cloud executor cannot have run (it has no shell). Used to
 *  block a fabricated "checks pass" claim once and force an honest summary. Kept
 *  deliberately narrow (a check noun AND a success verb) to avoid false positives
 *  on legitimate descriptions of the work. */
export function assertsUnrunVerification(summary: string): boolean {
  const s = summary.toLowerCase();
  const check = /(type[\s-]?check|typecheck|typescript|\btsc\b|lint|eslint|\btest(s|ing|ed)?\b|\bbuild(s|ing)?\b|compil)/;
  const pass = /(pass(es|ed|ing)?|succeed(s|ed)?|success|green|no\s+errors?|error[\s-]?free|will\s+now\s+pass|are\s+resolved|is\s+resolved)/;
  return check.test(s) && pass.test(s);
}

/**
 * Tools the cloud (Worker) agent loop can actually execute. The Worker has no
 * filesystem/shell, so the toolset is provider-API-backed: `write_file` lands a
 * file on the ticket branch as a pending change; `finish` ends the run. Both V1
 * and V2 cloud runs use this same loop so they genuinely *execute tools* (not a
 * single completion) and every call is recorded to the Observability timeline.
 */
export const CLOUD_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass a subdirectory to scope the listing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search the ENTIRE repo for a string/symbol in one call (indexed code search) — use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. 0 results means the term does not appear in the indexed codebase (so "remove all references to X" with 0 results means there is nothing to remove — say so, do not invent a change). Recently-pushed code may lag the index; confirm a specific file with read_file. Then read_file the matches you intend to edit.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Exact text or symbol to find, e.g. a model id, function name, import path, or config key.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the FULL current contents of a repo file on the ticket branch. Always read a file before editing it so you preserve existing code and only change what is needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path, e.g. "src/feature.ts".' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or update a file on the ticket branch as a reviewable pending change (a PR is opened/updated for the run). Use once per deliverable file. Provide the FULL file content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path, e.g. "src/feature.ts".' },
          content: { type: 'string', description: 'Complete file content (no placeholders).' },
          summary: { type: 'string', description: 'One-line description of the change.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Remove a file from the ticket branch so it does NOT ship in the pull request. Use this to clean up dead code: a stub/placeholder, an unreferenced file, or a file a PRIOR pass on this branch created that should not be part of the final change. The "Files already on this branch" list in your context shows what a prior pass left — reconcile against it. Verify the file is genuinely unused (search_code for its exports) before deleting. Deleting a file not on the branch is a no-op (reported back), not an error.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path to remove, e.g. "src/utils/email.ts".' },
          reason: { type: 'string', description: 'One-line why this file should not ship (e.g. "stub superseded by existing email infra").' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_checks',
      description: 'Statically validate the files you have written: it parses your committed JSON and YAML config files in-place and reports any syntax errors to fix BEFORE finishing. IMPORTANT: this serverless executor has NO shell, so it does NOT run the build, project-wide type-check, lint, or tests — those run in CI on the pull request your changes open (the source of truth). Call this after writing config files. Never claim the build/type-check/lint/tests passed — you cannot run those here; only the JSON/YAML syntax check is real.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call ONLY when the task is fully complete — every deliverable file written with real, working content (no stubs/placeholders) and every task/PRD requirement implemented. Your changes open a pull request for human review, so a partial scaffold is not "done". Provide a concise summary of what was delivered. Do NOT assert that a build/type-check/lint/test passed — you cannot run those here (CI on the PR verifies).',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'What was delivered.' } },
        required: ['summary'],
      },
    },
  },
] as const;

// Read→edit→write workflows on a multi-file task need many turns: explore the
// repo, read several files, then write each change — 10 was too few (a real run
// burned all 10 just exploring and shipped a PRD-only PR). The durable (DO)
// surface runs ONE step per alarm tick and heartbeats `executions.updated_at`
// every tick, so the orphan reaper measures liveness from the heartbeat, not the
// total step count — a long, healthy run never trips it. 30 gives room to finish
// real edits (the long-lived Container surface allows 40).
export const MAX_CLOUD_TOOL_STEPS = 30;

// Anti-stub finish gate: how many times a single synchronous loop invocation will
// block a finish that still ships placeholder/stub code before letting the PR open
// anyway (human-reviewed, annotated unverified). The durable surface resets this
// per tick, so there it is effectively block-until-clean, bounded by the step cap.
export const MAX_PLACEHOLDER_FINISH_BLOCKS = 2;

// The Container surface is a long-lived process (not a per-tick DO), and its
// real-shell build/verify loop legitimately needs more turns than the durable
// surface. The container heartbeats `executions.updated_at` on every LLM step so a
// healthy long run never trips the orphan reaper.
export const CONTAINER_MAX_STEPS = 40;

/** Pick a CLOUD_AGENT_TOOLS entry by name — name-based (not index) so adding a
 *  tool to the durable set can't silently re-map the container's toolset. */
const cloudTool = (name: string) => {
  const t = CLOUD_AGENT_TOOLS.find((x) => x.function.name === name);
  if (!t) throw new Error(`cloud tool '${name}' not found`);
  return t;
};

/**
 * Toolset for the long-lived Container executor (the `container` runtime surface).
 * Same file tools as the durable loop, but `run_checks` (a no-op confessing "no
 * shell") is replaced by a REAL `run_command` — the Container's whole reason to
 * exist. list_files/read_file run against the container's local clone; write_file
 * mirrors to the ticket branch via the container-op endpoint; run_command runs in
 * the container's shell. The container drives this loop in its own process and
 * sends each assistant turn to the `llm` op (which calls the gateway with THIS
 * toolset), so the schema lives in one place.
 */
export const CONTAINER_AGENT_TOOLS = [
  cloudTool('list_files'),
  // No search_code here: the container has a real shell, so it greps via
  // run_command natively (and only the Worker handler implements search_code).
  cloudTool('read_file'),
  cloudTool('write_file'),
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run, e.g. "npm install" or "npm test".' },
        },
        required: ['command'],
      },
    },
  },
  cloudTool('finish'),
] as const;
