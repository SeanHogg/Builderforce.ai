/**
 * governanceRuleAudits — the API half of the `governance_audit` agent tool (PRD 08 §4.2,
 * `agent-runtime/src/agents/tools/governance-audit-tool.ts`), over the migration-1336
 * policy-pack domain (`governance_policy_packs` / `governance_rules` /
 * `governance_audit_runs` / `governance_findings`).
 *
 * The tool is model-free and talks to exactly three endpoints; each is one function here:
 *   1. {@link resolveGovernanceRuleset}   — the effective ruleset for (tenant, segment, project), hashed.
 *   2. {@link startGovernanceAudit}       — open a run (`running`) and hand back its id.
 *   3. {@link finalizeGovernanceAudit}    — record the run's findings + summary + gate verdict.
 *
 * DISTINCT from `policyPackService` (migration 0348): those packs carry tool-call GATES the
 * runtime enforces at the wire; these carry RULES an auditor checks a repo against.
 *
 * Every read and write is (tenantId, segmentId)-scoped. A pack whose `segment_id` is NULL is
 * tenant-wide; a pack whose `project_id` is NULL applies to every project (the org baseline).
 */
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  governanceAuditRuns, governanceFindings, governancePolicyPacks, governanceRules,
} from '../../infrastructure/database/schema';
import { inTransaction, type Db } from '../../infrastructure/database/connection';
import { sha256Hex } from '../../domain/shared/hash';
import { projectInTenant } from '../project/projectOwnership';

export interface GovernanceScope { tenantId: number; segmentId: string }

export const GOVERNANCE_AUDIT_TRIGGERS = ['manual', 'agent_pr', 'schedule'] as const;
export type GovernanceAuditTrigger = (typeof GOVERNANCE_AUDIT_TRIGGERS)[number];

export const GOVERNANCE_FINDING_SOURCES = ['prefilter', 'agent', 'vuln_scan'] as const;
export const GOVERNANCE_FINDING_CONFIDENCES = ['high', 'medium', 'low'] as const;
export const GOVERNANCE_GATE_RESULTS = ['pass', 'blocked'] as const;

/** One rule as the tool consumes it (`GovernanceRule` in the tool, plus the pack it came from). */
export interface ResolvedGovernanceRule {
  id: string;
  packId: string;
  ruleRef: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  check: unknown;
  guidance: string | null;
  enabled: true;
}

export interface ResolvedGovernanceRuleset {
  rulesetHash: string;
  packsApplied: Array<{ packId: string; name: string; source: 'db' }>;
  rules: ResolvedGovernanceRule[];
}

export type GovernanceAuditOutcome<T> = { ok: true; value: T } | { ok: false; status: 404 | 409; error: string };

const projectNotFound = { ok: false, status: 404, error: 'project not found' } as const;

/** A caller-named project must belong to the tenant; `null` (tenant-wide) always passes. */
async function projectAllowed(db: Db, tenantId: number, projectId: number | null): Promise<boolean> {
  return projectId == null || projectInTenant(db, tenantId, projectId);
}

/**
 * The effective ruleset: every ACTIVE pack in scope (tenant-wide or this segment; org-wide or
 * this project) and every ENABLED rule they carry, in a stable order so the same configuration
 * always hashes to the same `rulesetHash` — the run records which ruleset governed it.
 *
 * Deliberately NOT read through `getOrSetCached`: the answer is audit EVIDENCE (the hash a run
 * records as the ruleset that governed it), so a stale entry would put a wrong hash on a
 * compliance record — and nothing in the API writes `governance_policy_packs` / `governance_rules`
 * yet (both are read-only entities), so there is no write path to hang the invalidation on. It is
 * read once per audit run, two indexed queries; cache it here, with invalidation in the same
 * change, when a pack/rule writer lands.
 */
export async function resolveGovernanceRuleset(
  db: Db, scope: GovernanceScope, projectId: number | null,
): Promise<GovernanceAuditOutcome<ResolvedGovernanceRuleset>> {
  if (!(await projectAllowed(db, scope.tenantId, projectId))) return projectNotFound;

  const packs = await db
    .select({ id: governancePolicyPacks.id, name: governancePolicyPacks.name })
    .from(governancePolicyPacks)
    .where(and(
      eq(governancePolicyPacks.tenantId, scope.tenantId),
      or(isNull(governancePolicyPacks.segmentId), eq(governancePolicyPacks.segmentId, scope.segmentId)),
      eq(governancePolicyPacks.status, 'active'),
      projectId == null
        ? isNull(governancePolicyPacks.projectId)
        : or(isNull(governancePolicyPacks.projectId), eq(governancePolicyPacks.projectId, projectId)),
    ))
    .orderBy(asc(governancePolicyPacks.createdAt), asc(governancePolicyPacks.id));

  const rows = packs.length === 0 ? [] : await db
    .select({
      id: governanceRules.id, packId: governanceRules.packId, ruleRef: governanceRules.ruleRef,
      category: governanceRules.category, title: governanceRules.title, description: governanceRules.description,
      severity: governanceRules.severity, check: governanceRules.check, guidance: governanceRules.guidance,
    })
    .from(governanceRules)
    .where(and(
      eq(governanceRules.tenantId, scope.tenantId),
      inArray(governanceRules.packId, packs.map((p) => p.id)),
      eq(governanceRules.enabled, true),
    ))
    .orderBy(asc(governanceRules.ruleRef), asc(governanceRules.id));

  const rules: ResolvedGovernanceRule[] = rows.map((r) => ({ ...r, enabled: true }));
  const packsApplied = packs.map((p) => ({ packId: p.id, name: p.name, source: 'db' as const }));
  const rulesetHash = await sha256Hex(JSON.stringify({ packs: packsApplied, rules }));
  return { ok: true, value: { rulesetHash, packsApplied, rules } };
}

export interface StartGovernanceAuditInput {
  projectId: number | null;
  repoRef: string | null;
  ref: string | null;
  trigger: GovernanceAuditTrigger;
  agentRunId: string | null;
}

/** Open an audit run in `running` — the tool posts its findings against the returned id. */
export async function startGovernanceAudit(
  db: Db, scope: GovernanceScope, input: StartGovernanceAuditInput,
): Promise<GovernanceAuditOutcome<{ runId: string }>> {
  if (!(await projectAllowed(db, scope.tenantId, input.projectId))) return projectNotFound;
  const [row] = await db.insert(governanceAuditRuns).values({
    tenantId: scope.tenantId,
    segmentId: scope.segmentId,
    projectId: input.projectId,
    repoRef: input.repoRef,
    ref: input.ref,
    trigger: input.trigger,
    agentRunId: input.agentRunId,
    status: 'running',
    startedAt: new Date(),
  }).returning({ id: governanceAuditRuns.id });
  return { ok: true, value: { runId: row!.id } };
}

export interface GovernanceFindingInput {
  ruleId?: string | null;
  ruleRef: string;
  severity: string;
  title: string;
  detail: string;
  filePath?: string | null;
  line?: number | null;
  evidence?: string | null;
  remediation?: string | null;
  source: (typeof GOVERNANCE_FINDING_SOURCES)[number];
  confidence?: (typeof GOVERNANCE_FINDING_CONFIDENCES)[number] | null;
}

export interface FinalizeGovernanceAuditInput {
  findings: GovernanceFindingInput[];
  summary: Record<string, number>;
  gateResult: (typeof GOVERNANCE_GATE_RESULTS)[number] | null;
  rulesetHash: string | null;
  /** The `packsApplied` the resolve answered — recorded so the run names exactly which packs governed it. */
  packsApplied?: Array<{ packId?: string; name?: string; source?: string }> | null;
}

/**
 * Rows per findings INSERT. Each row binds 14 parameters and Postgres caps one statement at
 * 65 535, so a 5 000-finding run in one statement would be refused; 1 000 rows is 14 000.
 */
export const GOVERNANCE_FINDINGS_INSERT_CHUNK = 1000;

/**
 * Close a run with its verdict and write its findings — ONE transaction, so a failed findings
 * insert rolls the close back and the caller's retry still finds the run open.
 *
 * The close is a compare-and-set on `status IN (queued, running)`, so a retried (or concurrent)
 * POST answers 409 instead of writing the findings twice. A finding's `ruleId` is kept only when
 * it names a rule of THIS tenant in this segment (or tenant-wide) — the FK alone would accept
 * another tenant's rule id — and dropped otherwise; `rule_ref` is always stored, so the finding
 * survives either way.
 */
export async function finalizeGovernanceAudit(
  db: Db, scope: GovernanceScope, runId: string, input: FinalizeGovernanceAuditInput,
): Promise<GovernanceAuditOutcome<{ runId: string; findings: number }>> {
  return inTransaction<GovernanceAuditOutcome<{ runId: string; findings: number }>>(db, async (tx) => {
    const runScope = and(
      eq(governanceAuditRuns.id, runId),
      eq(governanceAuditRuns.tenantId, scope.tenantId),
      eq(governanceAuditRuns.segmentId, scope.segmentId),
    );
    const closed = await tx.update(governanceAuditRuns)
      .set({
        status: 'completed',
        summary: input.summary,
        gateResult: input.gateResult,
        ...(input.rulesetHash ? { rulesetHash: input.rulesetHash } : {}),
        ...(input.packsApplied ? { packsApplied: input.packsApplied } : {}),
        finishedAt: new Date(),
      })
      .where(and(runScope, inArray(governanceAuditRuns.status, ['queued', 'running'])))
      .returning({ id: governanceAuditRuns.id });
    if (closed.length === 0) {
      const [exists] = await tx.select({ id: governanceAuditRuns.id }).from(governanceAuditRuns).where(runScope).limit(1);
      return exists
        ? { ok: false, status: 409, error: 'audit run is already finalized' }
        : { ok: false, status: 404, error: 'audit run not found' };
    }

    const claimedRuleIds = [...new Set(input.findings.map((f) => f.ruleId).filter((id): id is string => !!id))];
    const ownRuleIds = new Set(claimedRuleIds.length === 0 ? [] : (await tx
      .select({ id: governanceRules.id })
      .from(governanceRules)
      .where(and(
        eq(governanceRules.tenantId, scope.tenantId),
        or(isNull(governanceRules.segmentId), eq(governanceRules.segmentId, scope.segmentId)),
        inArray(governanceRules.id, claimedRuleIds),
      ))
    ).map((r) => r.id));

    const rows = input.findings.map((f) => ({
      tenantId: scope.tenantId,
      segmentId: scope.segmentId,
      runId,
      ruleId: f.ruleId && ownRuleIds.has(f.ruleId) ? f.ruleId : null,
      ruleRef: f.ruleRef,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      filePath: f.filePath ?? null,
      line: f.line ?? null,
      evidence: f.evidence ?? null,
      remediation: f.remediation ?? null,
      source: f.source,
      confidence: f.confidence ?? null,
    }));
    for (let i = 0; i < rows.length; i += GOVERNANCE_FINDINGS_INSERT_CHUNK) {
      await tx.insert(governanceFindings).values(rows.slice(i, i + GOVERNANCE_FINDINGS_INSERT_CHUNK));
    }
    return { ok: true, value: { runId, findings: rows.length } };
  });
}
