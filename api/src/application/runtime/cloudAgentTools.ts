/**
 * The cloud agent toolset, now just the cloud-SURFACE wiring over the shared,
 * runtime-agnostic registry (`@builderforce/agent-tools`). The tool DEFINITIONS live
 * in the shared package (`core-tools`) so the SAME definitions run on cloud Worker,
 * cloud Container, and on-prem Node — "any cloud tool is usable on-prem" is now
 * literally the same object, not a re-implementation.
 *
 * This module contributes only what is cloud-specific:
 *   • the two cloud surfaces' capability SETS (which derive their tool lists), and
 *   • the derived schema arrays their consumers expect (the in-Worker loop sends
 *     `schemasFor(provider)`; the container `llm` op advertises `CONTAINER_AGENT_TOOLS`,
 *     then runs the loop in its own image), plus
 *   • the step budgets and the finish-honesty matcher (loop policy).
 */

import { buildCoreToolRegistry, type Capability } from '@builderforce/agent-tools';

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
 * True when a code-bound run is about to `finish` having produced NO real code
 * deliverable — `writtenPaths` is empty or holds only the seeded `PRD.md` (the PRD
 * is committed during prep, so a PR with PRD.md but no code is the "wrote a plan,
 * shipped a scaffold/nothing" premature-finish footgun from execution #20).
 *
 * This is the cheap, deterministic half of the pre-finish completeness self-review
 * (ROADMAP #38): it does NOT judge requirement coverage, only that *something* was
 * built. Used to block `finish` ONCE and re-prompt the agent to self-review the PRD
 * requirements before accepting an empty finish — so a genuine "nothing to change"
 * run can still finish on the second attempt, while a premature one is forced to
 * reconsider. Pure → unit-testable in isolation.
 */
export function hasNoCodeDeliverable(writtenPaths: ReadonlySet<string>): boolean {
  let codeFiles = 0;
  for (const p of writtenPaths) if (p !== 'PRD.md') codeFiles += 1;
  return codeFiles === 0;
}

/** Deterministic JSON: object keys emitted in sorted order at every depth, so two
 *  structurally-identical tool-argument objects always stringify identically even when
 *  the model emitted their keys in a different order. Arrays keep their order (it is
 *  semantic). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** FNV-1a (32-bit), hex. Not cryptographic — this only needs to be stable, cheap, and
 *  short enough that a run's asked-gate list stays small in the persisted loop state.
 *  A collision would merely let one distinct call reuse another's approval, which is
 *  vanishingly unlikely and bounded by the gates a single run reaches. */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The identity of ONE `require-approval` decision: the gate, the tool it gated, and
 * the exact arguments of the call.
 *
 * Keying the run's asked-set by `gateId` ALONE (the original bug) made approval
 * once-per-RUN: a human approving `run_command("ls")` also silently pre-approved
 * `run_command("rm -rf /")` and every later call the same gate covered, for the whole
 * run — the gate stopped gating after its first hit. Keying by gate + tool + argument
 * hash makes approval once-per-CALL: each DISTINCT invocation is approved on its own
 * merits, while a RETRIED identical call (same tool, same args — e.g. the agent
 * re-issuing the call after the resume) matches the stored key and proceeds instead of
 * re-parking the run forever.
 *
 * A plain string so it stays JSON-serializable in {@link CloudLoopState.policyAskedGates}
 * across durable-object ticks. Pure → unit-testable.
 */
export function policyGateCallKey(gateId: string, toolName: string, args: Record<string, unknown>): string {
  return `${gateId}|${toolName}|${hash32(stableStringify(args))}`;
}

/** The one registry the cloud engine drives (schemas + dispatch). Seeded from the
 *  shared core tools — adding a tool there makes it available to every surface that
 *  backs its capability, with no array edit here. */
export const cloudToolRegistry = buildCoreToolRegistry();

/**
 * The durable/Worker surface: provider-API-backed, no shell. It can list/read/search
 * the repo over the git API, write + delete files as pending changes, statically
 * validate config (no shell), pause for a human, recall/remember durable facts
 * (Postgres-backed `agent_memory`), and read a public URL (`web`, backed by the
 * Worker's `fetch` behind an SSRF egress policy — see `cloudWeb.ts`).
 * → list_files, search_code, read_file, write_file, edit_file, delete_file,
 * run_checks, ask_human, memory_recall, memory_remember, web_fetch, finish.
 *
 * `web.search` is INTENTIONALLY omitted (a KNOWN gap, not an oversight): the two web
 * halves are gated separately because they need different backings, and this repo has
 * no web-search vendor integration and the LLM gateway exposes no search-capable path.
 * Advertising it would surface a `web_search` tool with nothing behind it. Tracked in
 * ROADMAP.md's Consolidated Gap Register; wiring a vendor into `buildCloudWebCapability`
 * and adding `'web.search'` here is the whole change.
 */
export const CLOUD_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'repo.read', 'repo.search', 'repo.write', 'repo.edit', 'repo.delete', 'static-check', 'human', 'memory', 'web',
]);

/**
 * The long-lived Container surface: a real Linux process with a shell + a local
 * clone. It greps via the shell (NOT the indexed searcher), commits via the
 * container-op, runs real build/test, and recalls/remembers durable facts by relaying
 * the `memory` container-op back to the Worker (the container holds no DB creds, so
 * the SAME `agent_memory`/`project_facts` backing serves both cloud surfaces) — so it
 * advertises repo.read + repo.write + shell + memory, and NOT repo.search /
 * static-check (shell-free) / human (not yet wired in the image).
 * → list_files, read_file, write_file, run_command, memory_recall, memory_remember,
 * finish — plus the six git tools `shell` also unlocks (git_status, git_diff,
 * git_history, git_sync_latest, git_undo, git_redo), which the image genuinely
 * implements in its `gitTool` handler.
 *
 * `repo.edit` is INTENTIONALLY omitted (not a gap): unlike the shell-less durable
 * surface — which must do surgical edits over the git API (read blob → string-replace
 * → commit), hence advertises `repo.edit` — the container edits files IN its local
 * clone via the shell and delegates only the whole-file COMMIT back to the Worker via
 * the `write` container-op. There is no `edit` container-op, so advertising `repo.edit`
 * here would surface an `edit_file` tool that 400s. If the image ever gains an in-loop
 * edit handler, add both `repo.edit` here AND the `edit` op in `handleContainerOp`.
 *
 * The container runs its OWN loop in its image; this set is only the schema it
 * advertises to the gateway, so it MUST match what that image implements.
 */
export const CONTAINER_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'repo.read', 'repo.write', 'shell', 'memory',
]);

/** Durable/Worker schema array — derived, not hand-maintained. */
export const CLOUD_AGENT_TOOLS = cloudToolRegistry.schemasForCapabilities(CLOUD_SURFACE_CAPS);

/** Container schema array — derived. Kept stable for the container image's loop. */
export const CONTAINER_AGENT_TOOLS = cloudToolRegistry.schemasForCapabilities(CONTAINER_SURFACE_CAPS);

// Read→edit→write workflows on a multi-file task need many turns: explore the
// repo, read several files, then write each change — 10 was too few (a real run
// burned all 10 just exploring and shipped a PRD-only PR). The durable (DO)
// surface runs ONE step per alarm tick and heartbeats `executions.updated_at`
// every tick, so the orphan reaper measures liveness from the heartbeat, not the
// total step count — a long, healthy run never trips it. 30 gives room to finish
// real edits (the long-lived Container surface allows 40).
export const MAX_CLOUD_TOOL_STEPS = 30;

// Anti-stub finish gate: how many finish attempts THIS RUN will have blocked for
// still shipping placeholder/stub code before letting the PR open anyway (human-
// reviewed, annotated unverified). The count is carried in `CloudLoopState` so it
// spans the durable surface's one-step-per-tick ticks — without that it reset every
// tick and this cap was unreachable, turning a "block twice, then relent" gate into
// block-forever.
export const MAX_PLACEHOLDER_FINISH_BLOCKS = 2;

// The Container surface is a long-lived process (not a per-tick DO), and its
// real-shell build/verify loop legitimately needs more turns than the durable
// surface. The container heartbeats `executions.updated_at` on every LLM step so a
// healthy long run never trips the orphan reaper.
export const CONTAINER_MAX_STEPS = 40;
