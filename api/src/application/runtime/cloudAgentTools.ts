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

import { buildCoreToolRegistry, type Capability, SKILL_TOOLS, SUBAGENT_TOOLS, stableStringify } from '@builderforce/agent-tools';
import { isCostLeverOn, type CostLeverId } from '@builderforce/cost-levers';
import { classifyDeliverablePaths } from '../delivery/deliverableEvidence';
import { TenantRole } from '../../domain/shared/types';

/** The permission role every cloud run acts under — its platform-tool dispatch (durable
 *  and container) and the principal its B4 answer replay is scoped to. One value, so a
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
 * The long-lived Container surface: a real Linux process with a shell + a local
 * clone. It greps via the shell (NOT the indexed searcher), commits via the
 * container-op, runs real build/test, and recalls/remembers durable facts by relaying
 * the `memory` container-op back to the Worker (the container holds no DB creds, so
 * the SAME `agent_memory`/`project_facts` backing serves both cloud surfaces) — so it
 * advertises repo.read + repo.write + shell + memory, and NOT repo.search /
 * static-check (shell-free).
 * → list_files, read_file, write_file, edit_file, run_command, memory_recall, memory_remember,
 * memory_forget, ask_human, finish — plus the six git tools `shell` also unlocks (git_status,
 * git_diff, git_history, git_sync_latest, git_undo, git_redo), which the image
 * genuinely implements in its `gitTool` handler. `memory_forget` relays through the
 * SAME `memory` container-op as recall/remember (action:'forget'), so it needs no new
 * op in the image.
 *
 * `coordinate` relays through the Worker just like memory. The image can therefore
 * reserve work before its first write and read the shared blackboard while the Worker
 * remains the sole owner of the lease/note stores.
 *
 * `prd.write` relays the same way, through the `prd` op — BOTH images that run this
 * toolset (the Cloudflare Container and the GitHub Actions runner) dispatch `update_prd`
 * to it, so the capability is backed on every surface it is advertised to.
 *
 * `skill.author` relays the same way, through the `skill` op (`cloudAgent/skillOp.ts`),
 * which runs the durable surface's own `skill_propose` / `skill_list` definitions
 * against the same `buildSkillAuthoringCapability` — so a container or Actions run that
 * produced a working procedure can propose it as a DRAFT, exactly as a durable run can.
 * Both images dispatch the two tools through the shared relay module.
 *
 * Adding it did not have to wait for a redeploy. Each image is a separately shipped
 * artifact, so a capability used to have to follow the DEPLOYED image rather than the
 * source, or a run would be offered a tool its image answered with `unknown tool`. Every
 * image now sends the tool names it can actually dispatch on each `llm` op and the Worker
 * advertises the intersection (`imageToolHandshake.ts`), so a capability can be added
 * the moment its op exists: an older image simply does not name the tool and is never
 * offered it (and an image too old to send a manifest is covered by
 * `HANDSHAKE_ONLY_TOOLS`).
 *
 * `repo.edit` IS in the set now (cost lever D5 — defects 4/5). It used to be omitted
 * because the image had no edit handler, so the container could only re-send whole files
 * through the `write` op — the most expensive output a coding turn produces. The image
 * now handles `edit_file` (search/replace with the SAME semantics as `edit_file` in
 * `@builderforce/agent-tools` core-tools: {path, old_string, new_string, replace_all?})
 * against its local clone (there is no `repo.edit` container op — the edit is applied
 * in the image, then committed through the Worker's `write` op with `isNew: false`,
 * which accepts the empty body an edit that clears a file produces). Only the Container
 * implements it (`CONTAINER_LOCAL_TOOL_NAMES` in `container/server.mjs`); the Actions
 * runner does not. The handshake (`imageToolHandshake.ts`) keeps both safe: an image
 * whose manifest omits `edit_file` is never offered it, and `edit_file` is in
 * `HANDSHAKE_ONLY_TOOLS`, so an image too old to send a manifest is not offered it either.
 *
 * `human` IS wired now (it was the last documented residual). Both images that run
 * this toolset — the Cloudflare Container and the GitHub Actions runner — handle
 * `ask_human` by posting the `ask_human` container-op with their conversation and
 * then exiting WITHOUT a terminal op, and `resumePausedExecution` restarts them
 * seeded with that conversation plus the human's answer (exit-and-redispatch; see
 * the op's own comment for why blocking-and-polling was rejected for a runtime
 * whose process is billed by the second and can be recycled).
 *
 * The container runs its OWN loop in its image; this set is only the schema it
 * advertises to the gateway, so it MUST match what that image implements.
 */
export const CONTAINER_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'repo.read', 'repo.write', 'repo.edit', 'shell', 'memory', 'memory.forget', 'coordinate', 'prd.write', 'human',
  // Delegation — the SAME backing as the durable runner. Every delegation verb relays
  // to the `subagent` container-op, which runs the shared tool definitions against
  // `cloudLiveOrchestration.ts` with this image run as the owner: each child is its own
  // durable run, and its report reaches the image as a steer on the `llm` op.
  'orchestrate', 'orchestrate.fanout', 'orchestrate.live',
  // `web.search` — PARITY with the durable surface, and only now safe to advertise.
  // It was absent because the container's capabilities come from the image's own tool
  // loop and there was no op behind them, so the tool would have 400'd mid-run. The
  // `search` container-op is that backing (see `handleContainerOp`), and the image
  // dispatches `web_search` to it, so the rule that kept this out — never advertise a
  // tool that is certain to fail — is satisfied rather than waived.
  //
  // Deliberately NOT `web` (fetch): there is no `fetch` op, and a container with a
  // shell can already curl. Search is the one that genuinely needs the Worker, because
  // the vendor credential, the read-through cache and the meter all live there.
  'web.search',
  // Skill authoring — PARITY with the durable surface. Backed by the `skill` container-op,
  // which runs the same tool definitions against the same authoring service, so a
  // proposal from an image lands as a draft for review and can never be binding.
  'skill.author',
]);

/**
 * Capabilities a cost lever ADDS to a cloud surface — data, one row per lever. Lever
 * off ⇒ the surface's constant set, exactly as before.
 *
 * C5 (`c5_cloud_repo_map`) adds `repo.semantic`, which unlocks the SHARED `repo_map` and
 * `semantic_search` definitions (`@builderforce/agent-tools` semantic-tools):
 *   • durable — backed by `createCloudRepoSemantic` (`repos/cloudRepoMap.ts`): one
 *     tarball read per base commit, the TS twin of bf-index's ranker, graph cached in R2;
 *   • container — backed by the image's own `bf-context` binary over its clone
 *     (`container/repoIndex.mjs`). The image names the two tools in its handshake only
 *     when the run spec turned the lever on AND its binary is present, so an older image
 *     is never offered them.
 */
const COST_LEVER_CAPS: ReadonlyArray<{ lever: CostLeverId; caps: readonly Capability[] }> = [
  { lever: 'c5_cloud_repo_map', caps: ['repo.semantic'] },
];

/** `base` plus every capability an ON lever adds for this tenant. */
export function withCostLeverCaps(base: ReadonlySet<Capability>, env: unknown, tenantId: number | string | null | undefined): ReadonlySet<Capability> {
  const added = COST_LEVER_CAPS.filter((row) => isCostLeverOn(env, row.lever, tenantId)).flatMap((row) => row.caps);
  return added.length === 0 ? base : new Set<Capability>([...base, ...added]);
}

/** The durable surface's capability set for a tenant's run (levers applied). */
export function cloudSurfaceCapsFor(env: unknown, tenantId: number | string | null | undefined): ReadonlySet<Capability> {
  return withCostLeverCaps(CLOUD_SURFACE_CAPS, env, tenantId);
}

/** The container surface's capability set for a tenant's run (levers applied). */
export function containerSurfaceCapsFor(env: unknown, tenantId: number | string | null | undefined): ReadonlySet<Capability> {
  return withCostLeverCaps(CONTAINER_SURFACE_CAPS, env, tenantId);
}

/** The schema array for a capability set — the ONE derivation both constants below use. */
export function cloudAgentToolsFor(caps: ReadonlySet<Capability>) {
  return cloudToolRegistry.schemasForCapabilities(caps);
}

/** Durable/Worker schema array — derived from {@link CLOUD_SURFACE_CAPS}, not
 *  hand-maintained. */
export const CLOUD_AGENT_TOOLS = cloudAgentToolsFor(CLOUD_SURFACE_CAPS);

/** Container schema array — derived. Kept stable for the container image's loop. */
export const CONTAINER_AGENT_TOOLS = cloudAgentToolsFor(CONTAINER_SURFACE_CAPS);

// There is NO step cap on a cloud run (the durable and Worker surfaces). It used to be
// 30: a real run burned all of an earlier 10 just exploring and shipped a PRD-only PR,
// and 30 still cut off multi-file work mid-edit. The durable surface runs ONE step per
// alarm tick and heartbeats `executions.updated_at` every tick, so the orphan reaper
// measures liveness from the heartbeat, never the step count — a long, healthy run
// trips nothing. What ends a run that is NOT healthy is the loop kernel's
// consecutive-tool-failure breaker (`@builderforce/agent-loop`), the same one every
// other surface stops on — the Container image and the Actions runner included: both
// drive the same kernel (`api/container/agentImageLoop.mjs`).

// Anti-stub finish gate: how many finish attempts THIS RUN will have blocked for
// still shipping placeholder/stub code before letting the PR open anyway (human-
// reviewed, annotated unverified). The count is carried in `CloudLoopState` so it
// spans the durable surface's one-step-per-tick ticks — without that it reset every
// tick and this cap was unreachable, turning a "block twice, then relent" gate into
// block-forever.
export const MAX_PLACEHOLDER_FINISH_BLOCKS = 2;

// LEGACY — the step ceiling a Container image built BEFORE the shared kernel
// (`agentImageLoop.mjs`) still reads from its /run body (`spec.maxSteps || 20`).
// A current image ignores it: no step cap, the failure-streak breaker is the limit.
// Sent only so an image still deployed from before the kernel keeps its 40 rather
// than falling back to 20; delete it (and the launcher's `maxSteps`) once every
// deployed image runs `agentImageLoop.mjs`.
export const CONTAINER_MAX_STEPS = 40;
