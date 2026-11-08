/**
 * Governance rule audits — the three endpoints the `governance_audit` agent tool calls
 * (PRD 08 §4.2; agent-runtime/src/agents/tools/governance-audit-tool.ts). Mounted by
 * governanceRoutes at /api/governance, so the paths below are exactly the tool's.
 *
 * GET  /rules/resolve?projectId&repoRef  – effective ruleset + its hash (member)
 * POST /audits                           – open a run; answers { runId } (developer+)
 * POST /audits/:id/findings              – findings + summary + gate verdict; closes the run (developer+)
 *
 * The logic is application/governance/governanceRuleAudits; both writes are recorded in the
 * ONE governance mutation-audit envelope.
 */
import { Hono } from 'hono';
import { requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { scope } from './segmentTrackerRoutes';
import { auditGovernanceMutation } from './governanceAudit';
import { parseBody, parseQuery, z, zQueryInt } from './requestBody';
import {
  finalizeGovernanceAudit, GOVERNANCE_AUDIT_TRIGGERS, GOVERNANCE_FINDING_CONFIDENCES,
  GOVERNANCE_FINDING_SOURCES, GOVERNANCE_GATE_RESULTS, resolveGovernanceRuleset, startGovernanceAudit,
} from '../../application/governance/governanceRuleAudits';

/** The tool sends `projectId` as a string; `repoRef` is accepted for the in-repo override seam (§3). */
const ResolveQuery = z.object({
  projectId: zQueryInt.optional(),
  repoRef: z.string().optional(),
});

const StartBody = z.object({
  // The tool sends its string param; a number names the same project.
  projectId: zQueryInt.nullish(),
  repoRef: z.string().max(500).nullish(),
  ref: z.string().max(200).nullish(),
  trigger: z.enum(GOVERNANCE_AUDIT_TRIGGERS),
  agentRunId: z.string().max(64).nullish(),
});

/** Bounds mirror migration 1336's column widths so an oversize value is a 400, not a 500. */
const FindingBody = z.object({
  ruleId: z.string().uuid().nullish(),
  ruleRef: z.string().min(1).max(80),
  severity: z.string().min(1).max(20),
  title: z.string().min(1).max(255),
  detail: z.string().min(1),
  filePath: z.string().max(1000).nullish(),
  line: z.number().int().nullish(),
  evidence: z.string().nullish(),
  remediation: z.string().nullish(),
  source: z.enum(GOVERNANCE_FINDING_SOURCES),
  confidence: z.enum(GOVERNANCE_FINDING_CONFIDENCES).nullish(),
});

const FinalizeBody = z.object({
  findings: z.array(FindingBody).max(5000),
  summary: z.record(z.string(), z.number().int().nonnegative()),
  gateResult: z.enum(GOVERNANCE_GATE_RESULTS).nullish(),
  rulesetHash: z.string().max(64).nullish(),
});

export function createGovernanceRuleAuditRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/rules/resolve', async (c) => {
    const q = parseQuery(c, ResolveQuery);
    const out = await resolveGovernanceRuleset(db, scope(c), q.projectId ?? null);
    return out.ok ? c.json(out.value) : c.json({ error: out.error }, out.status);
  });

  router.post('/audits', requireRole(TenantRole.DEVELOPER), async (c) => {
    const body = await parseBody(c, StartBody);
    const input = {
      projectId: body.projectId ?? null, repoRef: body.repoRef ?? null, ref: body.ref ?? null,
      trigger: body.trigger, agentRunId: body.agentRunId ?? null,
    };
    const out = await startGovernanceAudit(db, scope(c), input);
    if (!out.ok) return c.json({ error: out.error }, out.status);
    await auditGovernanceMutation(c, db, 'governance-audits', out.value.runId, 'run', null, input);
    return c.json(out.value, 201);
  });

  router.post('/audits/:id/findings', requireRole(TenantRole.DEVELOPER), async (c) => {
    const runId = c.req.param('id');
    if (!z.string().uuid().safeParse(runId).success) return c.json({ error: 'audit run not found' }, 404);
    const body = await parseBody(c, FinalizeBody);
    const out = await finalizeGovernanceAudit(db, scope(c), runId, {
      findings: body.findings, summary: body.summary,
      gateResult: body.gateResult ?? null, rulesetHash: body.rulesetHash ?? null,
    });
    if (!out.ok) return c.json({ error: out.error }, out.status);
    await auditGovernanceMutation(c, db, 'governance-audits', runId, 'update', null, {
      summary: body.summary, gateResult: body.gateResult ?? null, findings: out.value.findings,
    });
    return c.json(out.value);
  });

  return router;
}
