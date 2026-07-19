/**
 * policyPackService — the READ/WRITE path for governance policy packs, and the
 * one resolver that turns them into the `PolicyGate[]` the runtime enforces.
 *
 * Background: `evaluatePolicyGate` (packages/agent-tools) is hard-enforced at three
 * tool-call seams (cloud engine, VS Code agent, on-prem relay) and gates travel to a
 * run on its payload (`policyGates` → `parsePolicyGates`). Until migration 0348 there
 * was no store, so `policyGates` was `[]` on every real run. This module is the
 * missing half: packs are authored here, and {@link resolvePolicyGates} projects the
 * effective set for a (tenant, project, agent) onto the exact wire shape.
 *
 * Matching lives in ONE place by design:
 *   - pack SCOPE matching (which packs apply to this run) is here, and only here;
 *   - gate TOOL matching (which gate fires for this tool call) is `evaluatePolicyGate`,
 *     and only there.
 * Nothing re-implements either.
 *
 * Hot path: the resolver runs on every dispatch, so it is served through the
 * canonical read-through cache (L1 Map + L2 KV). The keyspace is unbounded
 * (project × agent), so the key embeds a per-tenant version token — every pack/gate
 * write bumps it and orphans the whole tenant's cached resolutions at once, instead
 * of enumerating keys.
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { coercePolicyGates, type PolicyGate } from '@builderforce/agent-tools';
import { policyGates, policyPacks } from '../../infrastructure/database/schema';
import {
  bumpCacheVersion,
  getCacheVersion,
  getOrSetCached,
} from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export type PolicyGateEffect = PolicyGate['effect'];

export const POLICY_GATE_EFFECTS: readonly PolicyGateEffect[] = [
  'inject-directive',
  'require-approval',
  'block',
];

export function isPolicyGateEffect(v: unknown): v is PolicyGateEffect {
  return typeof v === 'string' && (POLICY_GATE_EFFECTS as readonly string[]).includes(v);
}

/** A gate row as the CRUD surface exposes it (superset of the wire `PolicyGate`). */
export interface PolicyGateRow {
  id: string;
  packId: string;
  gateKey: string;
  tool: string | null;
  effect: PolicyGateEffect;
  directive: string | null;
  reason: string | null;
  position: number;
}

/** A pack plus its gates — the shape the management UI renders. */
export interface PolicyPackRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  projectId: number | null;
  agentRef: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  gates: PolicyGateRow[];
}

export interface PolicyPackInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  projectId?: number | null;
  agentRef?: string | null;
}

export interface PolicyGateInput {
  gateKey?: string;
  tool?: string | null;
  effect?: string;
  directive?: string | null;
  reason?: string | null;
  position?: number;
}

/** Scope a resolution is asked for. Absent project/agent = "unscoped run". */
export interface PolicyScope {
  tenantId: number;
  projectId?: number | null;
  agentRef?: string | null;
}

/** Version token bumped by every pack/gate write; folded into resolution keys. */
function policyVersionKey(tenantId: number): string {
  return `policy-packs-version:tenant:${tenantId}`;
}

function resolutionKey(scope: PolicyScope, version: string): string {
  const project = scope.projectId ?? 'all';
  const agent = scope.agentRef?.trim() || 'all';
  return `policy-gates:t:${scope.tenantId}:p:${project}:a:${agent}:v:${version}`;
}

/** Orphan every cached resolution for a tenant. Call from EVERY pack/gate write. */
export async function invalidatePolicyCache(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, policyVersionKey(tenantId)).catch(() => {});
}

const isBlank = (v: string | null | undefined): boolean => !v || v.trim().length === 0;

function toGateRow(g: typeof policyGates.$inferSelect): PolicyGateRow {
  return {
    id: g.id,
    packId: g.packId,
    gateKey: g.gateKey,
    tool: g.tool,
    effect: (isPolicyGateEffect(g.effect) ? g.effect : 'inject-directive'),
    directive: g.directive,
    reason: g.reason,
    position: g.position,
  };
}

/**
 * The EFFECTIVE gates for a run, in the exact shape `coercePolicyGates` /
 * `evaluatePolicyGate` consume.
 *
 * A pack applies when it is enabled AND its scope columns are either NULL
 * (wildcard) or equal to the run's project / agent. A run with no project (or no
 * agent) therefore only picks up the wildcard packs — a project-pinned pack never
 * leaks onto an unrelated run.
 *
 * The result is run through `coercePolicyGates` so a hand-edited DB row with a
 * bogus `effect` can never reach the engine: there is ONE validator for the wire
 * shape and this path uses it like every other reader.
 */
export async function resolvePolicyGates(
  env: Env,
  db: Db,
  scope: PolicyScope,
): Promise<PolicyGate[]> {
  const version = await getCacheVersion(env, policyVersionKey(scope.tenantId));
  return getOrSetCached<PolicyGate[]>(
    env,
    resolutionKey(scope, version),
    () => loadPolicyGates(db, scope),
    { kvTtlSeconds: 300 },
  );
}

/** Uncached load — the resolver's loader, exported for tests. */
export async function loadPolicyGates(db: Db, scope: PolicyScope): Promise<PolicyGate[]> {
  const agentRef = scope.agentRef?.trim() || null;
  const projectId = scope.projectId ?? null;

  const rows = await db
    .select({
      gateKey: policyGates.gateKey,
      tool: policyGates.tool,
      effect: policyGates.effect,
      directive: policyGates.directive,
      reason: policyGates.reason,
    })
    .from(policyGates)
    .innerJoin(policyPacks, eq(policyGates.packId, policyPacks.id))
    .where(
      and(
        eq(policyPacks.tenantId, scope.tenantId),
        eq(policyPacks.enabled, true),
        // NULL scope column = wildcard; otherwise it must equal the run's scope.
        projectId == null
          ? isNull(policyPacks.projectId)
          : or(isNull(policyPacks.projectId), eq(policyPacks.projectId, projectId)),
        agentRef == null
          ? isNull(policyPacks.agentRef)
          : or(isNull(policyPacks.agentRef), eq(policyPacks.agentRef, agentRef)),
      ),
    )
    .orderBy(asc(policyGates.position));

  // One validator for the wire shape — the same `coercePolicyGates` the payload
  // parser and the on-prem relay use.
  return coercePolicyGates(
    rows.map((r) => ({
      id: r.gateKey,
      ...(r.tool ? { tool: r.tool } : {}),
      effect: r.effect,
      ...(r.directive ? { directive: r.directive } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    })),
  );
}

// ---------------------------------------------------------------------------
// CRUD — every write invalidates the tenant's resolution cache.
// ---------------------------------------------------------------------------

/** Every pack for a tenant/segment, gates included, newest first. */
export async function listPolicyPacks(
  db: Db,
  tenantId: number,
  segmentId?: string | null,
): Promise<PolicyPackRow[]> {
  const packs = await db
    .select()
    .from(policyPacks)
    .where(
      segmentId
        ? and(eq(policyPacks.tenantId, tenantId), eq(policyPacks.segmentId, segmentId))
        : eq(policyPacks.tenantId, tenantId),
    )
    .orderBy(asc(policyPacks.name));
  if (packs.length === 0) return [];

  const gates = await db
    .select()
    .from(policyGates)
    .where(eq(policyGates.tenantId, tenantId))
    .orderBy(asc(policyGates.position));

  const byPack = new Map<string, PolicyGateRow[]>();
  for (const g of gates) {
    const list = byPack.get(g.packId) ?? [];
    list.push(toGateRow(g));
    byPack.set(g.packId, list);
  }

  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    enabled: p.enabled,
    projectId: p.projectId,
    agentRef: p.agentRef,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
    gates: byPack.get(p.id) ?? [],
  }));
}

export async function createPolicyPack(
  env: Env,
  db: Db,
  tenantId: number,
  segmentId: string | null,
  input: PolicyPackInput & { createdBy?: string | null },
): Promise<PolicyPackRow | { error: string }> {
  const name = input.name?.trim();
  if (!name) return { error: 'name is required' };

  const [row] = await db
    .insert(policyPacks)
    .values({
      tenantId,
      segmentId,
      name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      projectId: input.projectId ?? null,
      agentRef: input.agentRef?.trim() || null,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  await invalidatePolicyCache(env, tenantId);
  return {
    id: row!.id,
    name: row!.name,
    description: row!.description,
    enabled: row!.enabled,
    projectId: row!.projectId,
    agentRef: row!.agentRef,
    createdAt: row!.createdAt ? new Date(row!.createdAt).toISOString() : null,
    updatedAt: row!.updatedAt ? new Date(row!.updatedAt).toISOString() : null,
    gates: [],
  };
}

export async function updatePolicyPack(
  env: Env,
  db: Db,
  tenantId: number,
  packId: string,
  input: PolicyPackInput,
): Promise<{ ok: true } | { error: string }> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: 'name cannot be empty' };
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.agentRef !== undefined) patch.agentRef = input.agentRef?.trim() || null;

  const [row] = await db
    .update(policyPacks)
    .set(patch)
    .where(and(eq(policyPacks.id, packId), eq(policyPacks.tenantId, tenantId)))
    .returning({ id: policyPacks.id });
  if (!row) return { error: 'pack not found' };

  await invalidatePolicyCache(env, tenantId);
  return { ok: true };
}

export async function deletePolicyPack(
  env: Env,
  db: Db,
  tenantId: number,
  packId: string,
): Promise<{ ok: true } | { error: string }> {
  const [row] = await db
    .delete(policyPacks)
    .where(and(eq(policyPacks.id, packId), eq(policyPacks.tenantId, tenantId)))
    .returning({ id: policyPacks.id });
  if (!row) return { error: 'pack not found' };
  await invalidatePolicyCache(env, tenantId);
  return { ok: true };
}

export async function createPolicyGate(
  env: Env,
  db: Db,
  tenantId: number,
  packId: string,
  input: PolicyGateInput,
): Promise<PolicyGateRow | { error: string }> {
  const gateKey = input.gateKey?.trim();
  if (!gateKey) return { error: 'gateKey is required' };
  if (!isPolicyGateEffect(input.effect)) {
    return { error: `effect must be one of ${POLICY_GATE_EFFECTS.join(', ')}` };
  }
  if (input.effect === 'inject-directive' && isBlank(input.directive)) {
    return { error: 'directive is required for an inject-directive gate' };
  }

  const [pack] = await db
    .select({ id: policyPacks.id })
    .from(policyPacks)
    .where(and(eq(policyPacks.id, packId), eq(policyPacks.tenantId, tenantId)))
    .limit(1);
  if (!pack) return { error: 'pack not found' };

  const [row] = await db
    .insert(policyGates)
    .values({
      tenantId,
      packId,
      gateKey,
      tool: input.tool?.trim() || null,
      effect: input.effect,
      directive: input.directive ?? null,
      reason: input.reason ?? null,
      position: input.position ?? 0,
    })
    .returning();

  await invalidatePolicyCache(env, tenantId);
  return toGateRow(row!);
}

export async function updatePolicyGate(
  env: Env,
  db: Db,
  tenantId: number,
  gateId: string,
  input: PolicyGateInput,
): Promise<{ ok: true } | { error: string }> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.gateKey !== undefined) {
    const key = input.gateKey.trim();
    if (!key) return { error: 'gateKey cannot be empty' };
    patch.gateKey = key;
  }
  if (input.effect !== undefined) {
    if (!isPolicyGateEffect(input.effect)) {
      return { error: `effect must be one of ${POLICY_GATE_EFFECTS.join(', ')}` };
    }
    patch.effect = input.effect;
  }
  if (input.tool !== undefined) patch.tool = input.tool?.trim() || null;
  if (input.directive !== undefined) patch.directive = input.directive;
  if (input.reason !== undefined) patch.reason = input.reason;
  if (input.position !== undefined) patch.position = input.position;

  const [row] = await db
    .update(policyGates)
    .set(patch)
    .where(and(eq(policyGates.id, gateId), eq(policyGates.tenantId, tenantId)))
    .returning({ id: policyGates.id });
  if (!row) return { error: 'gate not found' };

  await invalidatePolicyCache(env, tenantId);
  return { ok: true };
}

export async function deletePolicyGate(
  env: Env,
  db: Db,
  tenantId: number,
  gateId: string,
): Promise<{ ok: true } | { error: string }> {
  const [row] = await db
    .delete(policyGates)
    .where(and(eq(policyGates.id, gateId), eq(policyGates.tenantId, tenantId)))
    .returning({ id: policyGates.id });
  if (!row) return { error: 'gate not found' };
  await invalidatePolicyCache(env, tenantId);
  return { ok: true };
}
