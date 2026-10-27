/**
 * Cost levers — the ONE on/off decision for every LLM cost-optimization lever.
 *
 * Each lever in the PRD (A1…F3) ships behind its own id here instead of a
 * bespoke env flag per feature, so rollout, kill switch and the control group in
 * the cost metrics all read the same answer.
 *
 * Resolution, first match wins:
 *   1. `COST_LEVER_<ID>` in env — `on` / `off` (also 1/0, true/false), or an
 *      integer 0–100 = the share of tenants it is on for.
 *   2. `COST_LEVERS_ALL=off` — global kill switch for every lever.
 *   3. The manifest default (`rollout`, 0–100).
 *
 * A percentage is applied by a stable FNV-1a bucket of `<leverId>:<tenantId>`,
 * so a tenant stays in the same arm across requests and isolates, and different
 * levers split tenants independently. No tenant id → the lever is on only at 100.
 *
 * On-device hosts (the VS Code extension, the on-prem runtime) have no tenant on the
 * local path, so they bucket by a stable INSTALL id instead ({@link isOnDeviceCostLeverOn})
 * — one install stays in one arm, and a 10% lever reaches about 10% of installs rather
 * than none of them.
 */

export type CostLeverId =
  | 'a2_run_budget'
  | 'a3_progress_detector'
  | 'b1_stable_prefix'
  | 'b2_semantic_cache'
  | 'b3_single_flight'
  | 'b4_agent_answer_replay'
  | 'c1_deferred_tools'
  | 'c2_observation_masking'
  | 'c3_task_state'
  | 'c4_adaptive_context'
  | 'c5_cloud_repo_map'
  | 'c6_rerank'
  | 'c7_tool_output_policy'
  | 'c8_token_compression'
  | 'c9_price_tier_budget'
  | 'd1_verifier_cascade'
  | 'd2_difficulty_router'
  | 'd3_routing_exploration'
  | 'd4_role_reasoning'
  | 'd5_output_caps'
  | 'd6_batch_api'
  | 'd7_deterministic_handlers'
  | 'd8_parallel_tool_calls'
  | 'e1_skill_ranking'
  | 'e2_specialists'
  | 'e3_free_embeddings'
  | 'e5_verified_local_label';

export interface CostLeverSpec {
  id: CostLeverId;
  /** PRD requirement id, e.g. "C1". */
  requirement: string;
  /** Default share of tenants (0–100) the lever is on for when env says nothing. */
  rollout: number;
  summary: string;
}

/**
 * The manifest. A new lever is a row here, never a new flag helper.
 * Defaults: levers that only fix waste with no quality risk ship at 100; levers
 * that change what the model sees or which model answers start at 10 and are
 * raised through env as the A4 metrics hold.
 */
export const COST_LEVERS: readonly CostLeverSpec[] = [
  { id: 'a2_run_budget', requirement: 'A2', rollout: 100, summary: 'Token + USD run budget, shown to the loop' },
  { id: 'a3_progress_detector', requirement: 'A3', rollout: 100, summary: 'Repeat-read / edit-revert / no-progress steer' },
  { id: 'b1_stable_prefix', requirement: 'B1', rollout: 100, summary: 'Volatile blocks after the cache breakpoint' },
  { id: 'b2_semantic_cache', requirement: 'B2', rollout: 10, summary: 'Scoped semantic cache on tool-free chat' },
  { id: 'b3_single_flight', requirement: 'B3', rollout: 100, summary: 'Coalesce identical in-flight requests' },
  { id: 'b4_agent_answer_replay', requirement: 'B4', rollout: 10, summary: 'Memory answer replay for agent sub-questions' },
  { id: 'c1_deferred_tools', requirement: 'C1', rollout: 10, summary: 'Role core tool set + tool_search' },
  { id: 'c2_observation_masking', requirement: 'C2', rollout: 10, summary: 'Mask tool outputs older than N turns' },
  { id: 'c3_task_state', requirement: 'C3', rollout: 10, summary: 'Structured task state kept through compaction' },
  { id: 'c4_adaptive_context', requirement: 'C4', rollout: 10, summary: 'Start retrieval small, widen on low confidence' },
  { id: 'c5_cloud_repo_map', requirement: 'C5', rollout: 10, summary: 'Graph-ranked repo map on cloud runs' },
  { id: 'c6_rerank', requirement: 'C6', rollout: 10, summary: 'Cross-encoder rerank after hybrid retrieval' },
  { id: 'c7_tool_output_policy', requirement: 'C7', rollout: 100, summary: 'One shared tool-output budget + failure summaries' },
  // 10 like every lever that changes what the model sees; it runs only where the local
  // engine's health probe reports a loaded compressor, so it never triggers a download.
  { id: 'c8_token_compression', requirement: 'C8', rollout: 10, summary: 'LLMLingua-2 token compression of large context' },
  { id: 'c9_price_tier_budget', requirement: 'C9', rollout: 100, summary: 'Compaction budget under long-context price tiers' },
  { id: 'd1_verifier_cascade', requirement: 'D1', rollout: 10, summary: 'Weak model first, verifier, escalate one tier' },
  { id: 'd2_difficulty_router', requirement: 'D2', rollout: 10, summary: 'Predict weak-model failure, skip the wasted attempt' },
  { id: 'd3_routing_exploration', requirement: 'D3', rollout: 100, summary: 'Thompson exploration + decay in learned routing' },
  { id: 'd4_role_reasoning', requirement: 'D4', rollout: 10, summary: 'Reasoning effort by role' },
  { id: 'd5_output_caps', requirement: 'D5', rollout: 100, summary: 'Diff edits + per-role max_tokens' },
  { id: 'd6_batch_api', requirement: 'D6', rollout: 100, summary: 'Provider batch APIs for deferred background work' },
  { id: 'd7_deterministic_handlers', requirement: 'D7', rollout: 100, summary: 'Deterministic handlers + post-edit checks' },
  { id: 'd8_parallel_tool_calls', requirement: 'D8', rollout: 100, summary: 'Batch independent tool calls in one turn' },
  { id: 'e1_skill_ranking', requirement: 'E1', rollout: 100, summary: 'Inject only the most relevant approved skills' },
  { id: 'e2_specialists', requirement: 'E2', rollout: 10, summary: 'Admitted small specialist models for narrow jobs' },
  // Always on (operator, 2026-10-23): recall dual-reads the paid 1536 column for rows the
  // 1024 backfill has not reached yet, so it never had to wait for the backfill.
  { id: 'e3_free_embeddings', requirement: 'E3', rollout: 100, summary: 'Free Workers AI embeddings for memory' },
  { id: 'e5_verified_local_label', requirement: 'E5', rollout: 100, summary: 'Hybrid local label = passed the verifier' },
];

const BY_ID: ReadonlyMap<CostLeverId, CostLeverSpec> = new Map(COST_LEVERS.map((l) => [l.id, l]));

export function costLeverSpec(id: CostLeverId): CostLeverSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`unknown cost lever: ${id}`);
  return spec;
}

/** Env key for a lever: `c1_deferred_tools` → `COST_LEVER_C1_DEFERRED_TOOLS`. */
export function costLeverEnvKey(id: CostLeverId): string {
  return `COST_LEVER_${id.toUpperCase()}`;
}

/** FNV-1a 32-bit, mapped to a 0–99 bucket. Stable across runtimes. */
export function costLeverBucket(id: CostLeverId, tenantId: string | number): number {
  const s = `${id}:${tenantId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

function readEnv(env: unknown, key: string): string | undefined {
  const v = (env as Record<string, unknown> | null | undefined)?.[key];
  return v === undefined || v === null ? undefined : String(v).trim().toLowerCase();
}

/** The share (0–100) a lever is on for, after env overrides. */
export function costLeverRollout(env: unknown, id: CostLeverId): number {
  const raw = readEnv(env, costLeverEnvKey(id));
  if (raw !== undefined && raw !== '') {
    if (raw === 'on' || raw === '1' || raw === 'true') return 100;
    if (raw === 'off' || raw === '0' || raw === 'false') return 0;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  const all = readEnv(env, 'COST_LEVERS_ALL');
  if (all === 'off' || all === '0' || all === 'false') return 0;
  return costLeverSpec(id).rollout;
}

/**
 * THE gate. `tenantId` buckets a partial rollout; pass the tenant the request is
 * billed to. On-device hosts with no tenant pass `null` and get the lever only
 * when it is fully on.
 */
export function isCostLeverOn(env: unknown, id: CostLeverId, tenantId: string | number | null | undefined): boolean {
  const rollout = costLeverRollout(env, id);
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;
  if (tenantId === null || tenantId === undefined || tenantId === '') return false;
  return costLeverBucket(id, tenantId) < rollout;
}

/** Which arm a tenant is in for every lever — stamped on usage rows so A4 can compare arms. */
export function costLeverArms(env: unknown, tenantId: string | number | null | undefined): CostLeverId[] {
  return COST_LEVERS.filter((l) => isCostLeverOn(env, l.id, tenantId)).map((l) => l.id);
}

/**
 * The bucket subject for an on-device install. Prefixed so an install id can never land
 * in the same bucket as a tenant that happens to share its spelling.
 */
export function onDeviceLeverSubject(installId: string | null | undefined): string | null {
  const id = (installId ?? '').trim();
  return id ? `device:${id}` : null;
}

/**
 * THE gate for an on-device host — the one resolver the VS Code extension and the on-prem
 * runtime share. Env overrides and the manifest default resolve exactly as
 * {@link isCostLeverOn}; a partial rollout is bucketed by the host's stable install id
 * (`vscode.env.machineId`, the runtime's device id). No install id ⇒ on only at 100,
 * the same answer a tenant-less call gets.
 */
export function isOnDeviceCostLeverOn(env: unknown, id: CostLeverId, installId: string | null | undefined): boolean {
  return isCostLeverOn(env, id, onDeviceLeverSubject(installId));
}
