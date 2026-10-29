/**
 * The cloud agent toolset, now just the cloud wiring over the shared, runtime-agnostic
 * registry (`@builderforce/agent-tools`). The tool DEFINITIONS live in the shared package
 * (`core-tools`) so the SAME definitions run in the cloud engine and on-prem Node — "any
 * cloud tool is usable on-prem" is literally the same object, not a re-implementation.
 *
 * This module contributes only what is cloud-specific:
 *   • the cloud run's capability SET (which derives its tool list — a run with a sandbox
 *     adds the sandbox's capabilities, `cloudAgent/runSurfaceCaps.ts`), and the derived
 *     schema array, plus
 *   • the step budgets and the finish-honesty matcher (loop policy).
 */

import { buildCoreToolRegistry, type Capability, SKILL_TOOLS, SUBAGENT_TOOLS } from '@builderforce/agent-tools';
import { isCostLeverOn, type CostLeverId } from '@builderforce/cost-levers';
import { classifyDeliverablePaths } from '../delivery/deliverableEvidence';
import { TenantRole } from '../../domain/shared/types';

/** The permission role every cloud run acts under — its platform-tool dispatch and the
 *  principal its B4 answer replay is scoped to. One value, so a
 *  replayed answer is always one produced under the role the run reads with. */
export const CLOUD_RUN_TENANT_ROLE = TenantRole.MANAGER;

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
  return classifyDeliverablePaths(writtenPaths) !== 'implementation';
}

/** The identity of ONE `require-approval` decision (gate + tool + argument hash): the one
 *  agent asks the same question on every surface, so it lives in `@builderforce/agent-tools`. */
export { policyGateCallKey } from '@builderforce/agent-tools';

/** The one registry the cloud engine drives (schemas + dispatch). Seeded from the
 *  shared core tools — adding a tool there makes it available to every surface that
 *  backs its capability, with no array edit here. */
export const cloudToolRegistry = buildCoreToolRegistry();
// Skill authoring is not a "core" task tool (it writes back into the capability
// catalogue, not into the ticket), so it is registered here rather than baked into
// every surface's core set — a surface gets it only by advertising `skill.author`.
for (const tool of SKILL_TOOLS) cloudToolRegistry.register(tool);
// Delegation, registered on the same terms and for the same reason: a run
// commissioning another run is not a core task tool, and a surface gets it only by
// advertising `orchestrate` — which it may do only where it can afford to run a
// nested loop inside one tool call.
for (const tool of SUBAGENT_TOOLS) cloudToolRegistry.register(tool);

/**
 * The durable/Worker surface: provider-API-backed, no shell. It can list/read/search
 * the repo over the git API, write + delete files as pending changes, statically
 * validate config (no shell), pause for a human, recall/remember durable facts
 * (Postgres-backed `agent_memory`), and read a public URL (`web`, backed by the
 * Worker's `fetch` behind an SSRF egress policy — see `cloudWeb.ts`).
 * → list_files, search_code, read_file, write_file, edit_file, delete_file,
 * run_checks, ask_human, memory_recall, memory_remember, memory_forget, claim_resource,
 * release_resource, workspace_note, workspace_read, web_fetch, finish.
 *
 * `memory.forget` and `coordinate` are surface capabilities here because the Worker
 * backs both authoritatively: memory is Postgres (a delete is a real delete, unlike the
 * on-prem SSM store which supersedes), and coordination is the `resource_leases` /
 * `coordination_notes` pair from migration 0370.
 *
 * `prd.write` is a surface capability here because the Worker owns the `specs` store
 * the ticket PRD lives in AND the branch-commit path that mirrors it — the same writer
 * the run's PRD-first prep used. Prep hands every run its PRD as context, so a surface
 * that can serve the PRD and not accept a correction to it leaves the agent able to read
 * a wrong requirement and unable to fix it.
 *
 * `web.search` IS in this constant, and it used to not be. It was tenant-gated while
 * search had no backing a tenant hadn't paid for; it is now a surface capability
 * because `resolveWebSearchBacking` always resolves one — a tenant BYO key, an
 * operator key, or the keyless encyclopedic floor. The rule that motivated the gate
 * still holds ("never advertise a tool that is certain to fail"); what changed is that
 * `web_search` can no longer be certain to fail. It stays a SEPARATE capability from
 * `web` because a surface can still legitimately back fetch without search.
 */
export const CLOUD_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'repo.read', 'repo.search', 'repo.write', 'repo.edit', 'repo.delete', 'static-check', 'human', 'memory', 'memory.forget',
  'coordinate', 'prd.write', 'web', 'web.search',
  // A run that produced a working procedure can propose it as a skill for review.
  // Safe to advertise because the proposal lands as a DRAFT: the tool cannot make
  // anything binding, and the backing service is the only writer that can.
  'skill.author',
  // Delegation. A child is its OWN durable run (`cloudLiveOrchestration.ts`) — one
  // backing for every cloud surface — so the owner keeps working and holds the verbs to
  // wait for, redirect and stop it (`orchestrate.live`). `spawn_agents` starts several,
  // each with scoped writers. A run with no place in a tree (a rehearsal) has all three
  // withheld by `delegationCaps`.
  'orchestrate', 'orchestrate.fanout', 'orchestrate.live',
]);

/**
 * Capabilities a cost lever ADDS to a cloud surface — data, one row per lever. Lever
 * off ⇒ the surface's constant set, exactly as before.
 *
 * C5 (`c5_cloud_repo_map`) adds `repo.semantic`, which unlocks the SHARED `repo_map` and
 * `semantic_search` definitions (`@builderforce/agent-tools` semantic-tools), backed by
 * `createCloudRepoSemantic` (`repos/cloudRepoMap.ts`): one tarball read per base commit,
 * the TS twin of bf-index's ranker, graph cached in R2.
 */
const COST_LEVER_CAPS: ReadonlyArray<{ lever: CostLeverId; caps: readonly Capability[] }> = [
  { lever: 'c5_cloud_repo_map', caps: ['repo.semantic'] },
];

/** `base` plus every capability an ON lever adds for this tenant. */
export function withCostLeverCaps(base: ReadonlySet<Capability>, env: unknown, tenantId: number | string | null | undefined): ReadonlySet<Capability> {
  const added = COST_LEVER_CAPS.filter((row) => isCostLeverOn(env, row.lever, tenantId)).flatMap((row) => row.caps);
  return added.length === 0 ? base : new Set<Capability>([...base, ...added]);
}

/** A cloud run's capability set for a tenant (levers applied). */
export function cloudSurfaceCapsFor(env: unknown, tenantId: number | string | null | undefined): ReadonlySet<Capability> {
  return withCostLeverCaps(CLOUD_SURFACE_CAPS, env, tenantId);
}

/** The schema array for a capability set — the ONE derivation. */
export function cloudAgentToolsFor(caps: ReadonlySet<Capability>) {
  return cloudToolRegistry.schemasForCapabilities(caps);
}

/** The cloud schema array — derived from {@link CLOUD_SURFACE_CAPS}, not hand-maintained. */
export const CLOUD_AGENT_TOOLS = cloudAgentToolsFor(CLOUD_SURFACE_CAPS);

// There is NO step cap on a cloud run (the durable and Worker surfaces). It used to be
// 30: a real run burned all of an earlier 10 just exploring and shipped a PRD-only PR,
// and 30 still cut off multi-file work mid-edit. The durable surface runs ONE step per
// alarm tick and heartbeats `executions.updated_at` every tick, so the orphan reaper
// measures liveness from the heartbeat, never the step count — a long, healthy run
// trips nothing. What ends a run that is NOT healthy is the loop kernel's
// consecutive-tool-failure breaker (`@builderforce/agent-loop`), the same one every
// other surface stops on — the Container image and the Actions runner included: both
// drive the same kernel (`api/runners/github-actions/agentImageLoop.mjs`).

// Anti-stub finish gate: how many finish attempts THIS RUN will have blocked for
// still shipping placeholder/stub code before letting the PR open anyway (human-
// reviewed, annotated unverified). The count is carried in `CloudLoopState` so it
// spans the durable surface's one-step-per-tick ticks — without that it reset every
// tick and this cap was unreachable, turning a "block twice, then relent" gate into
// block-forever.
export const MAX_PLACEHOLDER_FINISH_BLOCKS = 2;

