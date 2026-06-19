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

/** The one registry the cloud engine drives (schemas + dispatch). Seeded from the
 *  shared core tools — adding a tool there makes it available to every surface that
 *  backs its capability, with no array edit here. */
export const cloudToolRegistry = buildCoreToolRegistry();

/**
 * The durable/Worker surface: provider-API-backed, no shell. It can list/read/search
 * the repo over the git API, write + delete files as pending changes, statically
 * validate config (no shell), pause for a human, and recall/remember durable facts
 * (Postgres-backed `agent_memory`). → list_files, search_code, read_file, write_file,
 * delete_file, run_checks, ask_human, memory_recall, memory_remember, finish.
 */
export const CLOUD_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'repo.read', 'repo.search', 'repo.write', 'repo.edit', 'repo.delete', 'static-check', 'human', 'memory',
]);

/**
 * The long-lived Container surface: a real Linux process with a shell + a local
 * clone. It greps via the shell (NOT the indexed searcher), commits via the
 * container-op, and runs real build/test — so it advertises repo.read + repo.write +
 * shell, and NOT repo.search / static-check (shell-free) / human (not yet wired in
 * the image). → list_files, read_file, write_file, run_command, finish.
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
  'repo.read', 'repo.write', 'shell',
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
