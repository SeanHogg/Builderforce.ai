/** Agent-run identity boundary: freezes mutable definitions and mints one expiring,
 * least-privilege machine principal per execution. */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { sha256Hex } from '../../domain/shared/hash';
import {
  agentCapabilityGrants,
  agentCredentialDelegations,
  agentDefinitionVersions,
  agentDefinitionReleases,
  agentDefinitionPromotions,
  agentRunPrincipals,
  executionLimits,
  executions,
  ideAgents,
  agents,
  agentRegistrations,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { selectAgentRelease } from '../../domain/agentIdentity/releaseSelection';

export interface FrozenAgentDefinition {
  id: string;
  sourceKind: string;
  sourceRef: string;
  version: number;
  definition: Record<string, unknown>;
}

async function appendDefinitionVersion(db: Db, tenantId: number, sourceKind: string, sourceRef: string, definition: Record<string, unknown>): Promise<FrozenAgentDefinition> {
  const fingerprint = await sha256Hex(canonical(definition));
  const [existing] = await db.select().from(agentDefinitionVersions).where(scopedToTenant(
    agentDefinitionVersions, tenantId,
    eq(agentDefinitionVersions.sourceKind, sourceKind),
    eq(agentDefinitionVersions.sourceRef, sourceRef),
    eq(agentDefinitionVersions.fingerprint, fingerprint),
  )).limit(1);
  if (existing) return existing as FrozenAgentDefinition;
  const [latest] = await db.select({ version: agentDefinitionVersions.version }).from(agentDefinitionVersions).where(scopedToTenant(
    agentDefinitionVersions, tenantId,
    eq(agentDefinitionVersions.sourceKind, sourceKind),
    eq(agentDefinitionVersions.sourceRef, sourceRef),
  )).orderBy(desc(agentDefinitionVersions.version)).limit(1);
  await db.insert(agentDefinitionVersions).values({ tenantId, sourceKind, sourceRef, version: (latest?.version ?? 0) + 1, fingerprint, definition }).onConflictDoNothing();
  const [created] = await db.select().from(agentDefinitionVersions).where(scopedToTenant(
    agentDefinitionVersions, tenantId,
    eq(agentDefinitionVersions.sourceKind, sourceKind),
    eq(agentDefinitionVersions.sourceRef, sourceRef),
    eq(agentDefinitionVersions.fingerprint, fingerprint),
  )).limit(1);
  if (!created) throw new Error('could not freeze agent definition');
  return created as FrozenAgentDefinition;
}

export interface RunLimitInput {
  maxFiles?: number | null;
  maxRepositories?: number | null;
  maxSpendMillicents?: number | null;
}

function parseRunLimits(payload: string | null | undefined): RunLimitInput {
  if (!payload) return {};
  try {
    const value = (JSON.parse(payload) as { containmentLimits?: Record<string, unknown> }).containmentLimits;
    if (!value) return {};
    const read = (key: string): number | null | undefined => {
      const n = value[key];
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
    };
    return { maxFiles: read('maxFiles'), maxRepositories: read('maxRepositories'), maxSpendMillicents: read('maxSpendMillicents') };
  } catch { return {}; }
}

const DEFAULT_LIMITS: Required<RunLimitInput> = {
  maxFiles: 50,
  maxRepositories: 1,
  maxSpendMillicents: 2_500_000,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Return the existing content-addressed version, or append a new immutable one. */
export async function freezeIdeAgentDefinition(db: Db, tenantId: number, agentRef: string): Promise<FrozenAgentDefinition | null> {
  const [agent] = await db.select({
    id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, bio: ideAgents.bio,
    skills: ideAgents.skills, roleKeys: ideAgents.roleKeys, psychometric: ideAgents.psychometric,
    baseModel: ideAgents.baseModel, runtimeSupport: ideAgents.runtimeSupport,
    preferredRuntime: ideAgents.preferredRuntime, runtimeSurface: ideAgents.runtimeSurface,
    builtinKind: ideAgents.builtinKind, inferenceMode: ideAgents.inferenceMode,
  }).from(ideAgents).where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, agentRef))).limit(1);
  if (!agent) return null;

  return appendDefinitionVersion(db, tenantId, 'ide_agent', agentRef, { ...agent });
}

export async function freezeDispatchAgentDefinition(db: Db, args: { tenantId: number; agentId?: number | null; agentRegistrationId?: string | null }): Promise<FrozenAgentDefinition | null> {
  if (args.agentRegistrationId) {
    const [row] = await db.select().from(agentRegistrations).where(and(eq(agentRegistrations.tenantId, args.tenantId), eq(agentRegistrations.id, args.agentRegistrationId))).limit(1);
    if (row) {
      const { credentialRef: _secretReference, ...definition } = row;
      return appendDefinitionVersion(db, args.tenantId, 'agent_registration', row.id, definition);
    }
  }
  if (args.agentId != null) {
    const [row] = await db.select().from(agents).where(and(eq(agents.tenantId, args.tenantId), eq(agents.id, args.agentId))).limit(1);
    if (row) {
      const { apiKeyHash: _credentialHash, ...definition } = row;
      return appendDefinitionVersion(db, args.tenantId, 'legacy_agent', String(row.id), definition);
    }
  }
  return null;
}

/** Idempotently binds a frozen definition, principal, grants, and limits to a run. */
export async function ensureAgentRunIdentity(
  db: Db,
  args: { tenantId: number; executionId: number; agentRef?: string; issuedBy: string; capabilities: readonly string[]; limits?: RunLimitInput },
): Promise<{ principalId: string; definitionVersionId: string | null; definition: Record<string, unknown> | null }> {
  const frozen = args.agentRef ? await resolveReleasedIdeAgentDefinition(db, args.tenantId, args.agentRef, args.executionId) : null;
  if (frozen) await db.update(executions).set({ agentDefinitionVersionId: frozen.id }).where(and(eq(executions.id, args.executionId), eq(executions.tenantId, args.tenantId)));

  await db.insert(agentRunPrincipals).values({
    tenantId: args.tenantId, executionId: args.executionId,
    agentDefinitionVersionId: frozen?.id ?? null, issuedBy: args.issuedBy,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).onConflictDoNothing();
  const [principal] = await db.select({ id: agentRunPrincipals.id }).from(agentRunPrincipals).where(and(
    eq(agentRunPrincipals.tenantId, args.tenantId), eq(agentRunPrincipals.executionId, args.executionId),
  )).limit(1);
  if (!principal) throw new Error('could not establish the execution principal');

  if (args.capabilities.length > 0) {
    await db.insert(agentCapabilityGrants).values([...new Set(args.capabilities)].map((capability) => ({
      tenantId: args.tenantId, principalId: principal.id, capability,
    }))).onConflictDoNothing();
  }
  const [execution] = await db.select({ payload: executions.payload }).from(executions).where(and(eq(executions.tenantId, args.tenantId), eq(executions.id, args.executionId))).limit(1);
  const limits = { ...DEFAULT_LIMITS, ...parseRunLimits(execution?.payload), ...args.limits };
  await db.insert(executionLimits).values({ tenantId: args.tenantId, executionId: args.executionId, ...limits }).onConflictDoNothing();
  return { principalId: principal.id, definitionVersionId: frozen?.id ?? null, definition: frozen?.definition ?? null };
}

async function resolveReleasedIdeAgentDefinition(db: Db, tenantId: number, agentRef: string, executionId: number): Promise<FrozenAgentDefinition | null> {
  const [run] = await db.select({ versionId: executions.agentDefinitionVersionId }).from(executions).where(and(eq(executions.id, executionId), eq(executions.tenantId, tenantId))).limit(1);
  if (run?.versionId) {
    const [pinned] = await db.select().from(agentDefinitionVersions).where(and(eq(agentDefinitionVersions.id, run.versionId), eq(agentDefinitionVersions.tenantId, tenantId))).limit(1);
    return pinned ? pinned as FrozenAgentDefinition : null;
  }
  const current = await freezeIdeAgentDefinition(db, tenantId, agentRef);
  if (!current) return null;
  await db.insert(agentDefinitionReleases).values({ tenantId, sourceKind: 'ide_agent', sourceRef: agentRef, stableVersionId: current.id }).onConflictDoNothing();
  const [release] = await db.select().from(agentDefinitionReleases).where(and(eq(agentDefinitionReleases.tenantId, tenantId), eq(agentDefinitionReleases.sourceKind, 'ide_agent'), eq(agentDefinitionReleases.sourceRef, agentRef))).limit(1);
  const chosenId = release ? selectAgentRelease(executionId, release) : current.id;
  const [chosen] = await db.select().from(agentDefinitionVersions).where(and(eq(agentDefinitionVersions.id, chosenId), eq(agentDefinitionVersions.tenantId, tenantId))).limit(1);
  return chosen ? chosen as FrozenAgentDefinition : current;
}

export async function releaseIdeAgentVersion(db: Db, args: { tenantId: number; agentRef: string; versionId: string; mode: 'stable' | 'canary' | 'rollback'; canaryPercent?: number; actorRef?: string }): Promise<void> {
  const [version] = await db.select({ id: agentDefinitionVersions.id }).from(agentDefinitionVersions).where(and(
    eq(agentDefinitionVersions.id, args.versionId), eq(agentDefinitionVersions.tenantId, args.tenantId),
    eq(agentDefinitionVersions.sourceKind, 'ide_agent'), eq(agentDefinitionVersions.sourceRef, args.agentRef),
  )).limit(1);
  if (!version) throw new Error('agent version not found');
  const [previous] = await db.select().from(agentDefinitionReleases).where(and(eq(agentDefinitionReleases.tenantId, args.tenantId), eq(agentDefinitionReleases.sourceKind, 'ide_agent'), eq(agentDefinitionReleases.sourceRef, args.agentRef))).limit(1);
  const percent = Math.min(100, Math.max(0, Math.trunc(args.canaryPercent ?? 10)));
  await db.insert(agentDefinitionReleases).values({
    tenantId: args.tenantId, sourceKind: 'ide_agent', sourceRef: args.agentRef, stableVersionId: version.id,
    ...(args.mode === 'canary' ? { canaryVersionId: version.id, canaryPercent: percent } : {}), updatedBy: args.actorRef ?? null,
  }).onConflictDoUpdate({
    target: [agentDefinitionReleases.tenantId, agentDefinitionReleases.sourceKind, agentDefinitionReleases.sourceRef],
    set: args.mode === 'canary'
      ? { canaryVersionId: version.id, canaryPercent: percent, updatedBy: args.actorRef ?? null, updatedAt: new Date() }
      : { stableVersionId: version.id, canaryVersionId: null, canaryPercent: 0, updatedBy: args.actorRef ?? null, updatedAt: new Date() },
  });
  await db.insert(agentDefinitionPromotions).values({
    tenantId: args.tenantId, sourceKind: 'ide_agent', sourceRef: args.agentRef,
    fromVersionId: args.mode === 'canary' ? previous?.canaryVersionId ?? null : previous?.stableVersionId ?? null,
    toVersionId: version.id, action: args.mode, actorRef: args.actorRef ?? null,
  });
}

export async function listIdeAgentVersions(db: Db, tenantId: number, agentRef: string) {
  const [versions, release] = await Promise.all([
    db.select().from(agentDefinitionVersions).where(and(eq(agentDefinitionVersions.tenantId, tenantId), eq(agentDefinitionVersions.sourceKind, 'ide_agent'), eq(agentDefinitionVersions.sourceRef, agentRef))).orderBy(desc(agentDefinitionVersions.version)),
    db.select().from(agentDefinitionReleases).where(and(eq(agentDefinitionReleases.tenantId, tenantId), eq(agentDefinitionReleases.sourceKind, 'ide_agent'), eq(agentDefinitionReleases.sourceRef, agentRef))).limit(1),
  ]);
  return { versions, release: release[0] ?? null };
}

export async function revokeRunPrincipal(db: Db, tenantId: number, executionId: number): Promise<boolean> {
  const rows = await db.update(agentRunPrincipals).set({ status: 'revoked', revokedAt: new Date() }).where(and(
    eq(agentRunPrincipals.tenantId, tenantId), eq(agentRunPrincipals.executionId, executionId), eq(agentRunPrincipals.status, 'active'),
  )).returning({ id: agentRunPrincipals.id });
  return rows.length > 0;
}

/** Authenticate a callback against live database state, not just possession of the
 * signed container token. This makes expiry, revocation, cancellation, and terminal
 * completion effective immediately even when a container still holds its URL. */
export async function authorizeExecutionPrincipal(db: Db, tenantId: number, executionId: number): Promise<boolean> {
  const [row] = await db.select({ id: agentRunPrincipals.id })
    .from(agentRunPrincipals)
    .innerJoin(executions, and(
      eq(executions.id, agentRunPrincipals.executionId),
      eq(executions.tenantId, agentRunPrincipals.tenantId),
    ))
    .where(scopedToTenant(
      agentRunPrincipals,
      tenantId,
      eq(agentRunPrincipals.executionId, executionId),
      eq(agentRunPrincipals.status, 'active'),
      gt(agentRunPrincipals.expiresAt, new Date()),
      inArray(executions.status, ['pending', 'running']),
    ))
    .limit(1);
  return Boolean(row);
}

/** Grant a principal permission to ask the owning adapter for one credential. The
 * decrypted credential never enters this table or an agent-visible payload. */
export async function delegateCredential(db: Db, args: {
  tenantId: number; principalId: string; credentialKind: string; credentialRef: string;
  scopes: readonly string[]; ttlMinutes?: number;
}): Promise<string> {
  const [principal] = await db.select({ id: agentRunPrincipals.id, status: agentRunPrincipals.status, expiresAt: agentRunPrincipals.expiresAt })
    .from(agentRunPrincipals).where(and(eq(agentRunPrincipals.id, args.principalId), eq(agentRunPrincipals.tenantId, args.tenantId))).limit(1);
  if (!principal || principal.status !== 'active' || new Date(principal.expiresAt).getTime() <= Date.now()) throw new Error('run principal is not active');
  const [existing] = await db.select({ id: agentCredentialDelegations.id }).from(agentCredentialDelegations).where(and(
    eq(agentCredentialDelegations.tenantId, args.tenantId), eq(agentCredentialDelegations.principalId, args.principalId),
    eq(agentCredentialDelegations.credentialKind, args.credentialKind), eq(agentCredentialDelegations.credentialRef, args.credentialRef),
    sql`${agentCredentialDelegations.revokedAt} IS NULL`, sql`${agentCredentialDelegations.expiresAt} > NOW()`,
  )).limit(1);
  if (existing) return existing.id;
  const expiresAt = new Date(Math.min(new Date(principal.expiresAt).getTime(), Date.now() + (args.ttlMinutes ?? 30) * 60_000));
  const [row] = await db.insert(agentCredentialDelegations).values({
    tenantId: args.tenantId, principalId: args.principalId,
    credentialKind: args.credentialKind, credentialRef: args.credentialRef,
    scopes: [...new Set(args.scopes)], expiresAt,
  }).returning({ id: agentCredentialDelegations.id });
  if (!row) throw new Error('could not create credential delegation');
  return row.id;
}

export async function authorizeCredentialDelegation(db: Db, args: { tenantId: number; principalId: string; delegationId: string; requiredScope: string }): Promise<boolean> {
  const [row] = await db.select({ scopes: agentCredentialDelegations.scopes }).from(agentCredentialDelegations)
    .innerJoin(agentRunPrincipals, eq(agentRunPrincipals.id, agentCredentialDelegations.principalId))
    .where(and(
      eq(agentCredentialDelegations.id, args.delegationId), eq(agentCredentialDelegations.tenantId, args.tenantId),
      eq(agentCredentialDelegations.principalId, args.principalId), eq(agentRunPrincipals.status, 'active'),
      sql`${agentCredentialDelegations.revokedAt} IS NULL`, sql`${agentCredentialDelegations.expiresAt} > NOW()`,
      sql`${agentRunPrincipals.expiresAt} > NOW()`,
    )).limit(1);
  return Array.isArray(row?.scopes) && row.scopes.some((scope) => scope === args.requiredScope || scope === '*');
}
