/**
 * Governance & Security — /api/governance/*
 *
 * The security TOOLSET surfaces (doc 07). This first slice is the SOC 2 Control
 * Tracker (SEC-1). Unlike the legacy tables that lean on the default-segment
 * trigger, governance is fully Segment-THREADED: every read and write scopes by
 * BOTH (tenantId, segmentId) from request context, so it is correct for
 * segmented tenants too — the model the whole platform is migrating toward.
 *
 * GET   /api/governance/soc2/controls          – list this segment's controls
 * POST  /api/governance/soc2/seed              – seed the CC1–CC9 baseline once (manager+)
 * PATCH /api/governance/soc2/controls/:id      – update a control's status (manager+)
 * POST  /api/governance/soc2/controls/:id/evidence – attach evidence (manager+)
 * GET   /api/governance/soc2/evidence          – recent evidence incl. automated (member)
 * GET   /api/governance/soc2/gaps              – governance-auditor open gaps (member)
 * POST  /api/governance/dsr/:id/execute        – execute a data subject request for the segment (manager+)
 *
 * Every mutation here (and every generic tracker write) is recorded in the ONE governance
 * mutation-audit envelope — see application/governance/mutationAudit.ts.
 *
 * It also hosts the POLICY-PACK store (migration 0348) — the authoring surface
 * behind the runtime's `PolicyGate` enforcement. Reads are member-level (anyone
 * may see the posture they run under); every write is manager+.
 *
 * GET    /api/governance/policy-packs                 – packs + their gates
 * POST   /api/governance/policy-packs                 – create a pack (manager+)
 * PATCH  /api/governance/policy-packs/:id             – rename/scope/enable (manager+)
 * DELETE /api/governance/policy-packs/:id             – delete a pack (manager+)
 * POST   /api/governance/policy-packs/:id/gates       – add a gate (manager+)
 * PATCH  /api/governance/policy-gates/:gateId         – edit a gate (manager+)
 * DELETE /api/governance/policy-gates/:gateId         – delete a gate (manager+)
 * GET    /api/governance/policy-gates/effective       – resolved wire gates (preview)
 *
 * The policy-pack RULE audits (migration 1336) the `governance_audit` agent tool drives —
 * GET /rules/resolve, POST /audits, POST /audits/:id/findings — live in
 * governanceRuleAuditRoutes.ts.
 *
 * Vulnerability FINDINGS (what a tracked scan found) live in
 * vulnerabilityFindingRoutes.ts, mounted under /vuln-scans/:scanId/findings.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { gatesForWireLevel } from '@builderforce/agent-tools';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { mountTrackers, scope, type TrackerOpts } from './segmentTrackerRoutes';
import {
  socControls,
  securityVendors, securityIncidents, piiDataAssets, securityDpas,
  securityTrainings, complianceEvents, dataSubjectRequests, dataSuppressionList,
  accessReviews, vulnerabilityScans,
} from '../../infrastructure/database/schema';
import {
  createPolicyGate, createPolicyPack, deletePolicyGate, deletePolicyPack,
  listPolicyPacks, resolvePolicyGates, updatePolicyGate, updatePolicyPack,
} from '../../application/governance/policyPackService';
import { soc2EvidenceExportSource } from '../../application/governance/soc2EvidenceExport';
import { ensureSoc2Baseline } from '../../application/governance/soc2Baseline';
import { listOpenGaps, listRecentEvidence } from '../../application/governance/soc2Overview';
import {
  dsrExportKey, executeDataSubjectRequest, guardDsrTrackerWrite, markDsrDelivered, planDataSubjectRequest,
  projectDsrRow, toPublicDsrResult, verifyDsrIdentity, type PersistExport,
} from '../../application/governance/dsrExecution';
import {
  attachManualEvidence, CONTROL_STATUSES, isControlStatus, patchSocControl, type ControlStatus,
} from '../../application/governance/soc2Controls';
import { guardScanMutation } from '../../application/security/scanMutationGuard';
import { readPrivateObject, storePrivateObject } from '../../application/assets/tenantAssetStore';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import { auditGovernanceMutation } from './governanceAudit';
import { exportSourceHandler } from './exportSourceRoute';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { createStakeholderAlignmentRoutes } from './stakeholderAlignmentRoutes';
import { createVulnerabilityFindingRoutes } from './vulnerabilityFindingRoutes';
import { createGovernanceRuleAuditRoutes } from './governanceRuleAuditRoutes';
import { parseBody, z } from './requestBody';

/** `status` stays a string so the handler's own "must be one of" answer wins. */
const ControlPatchBody = z.object({
  status: z.string().optional(),
  ownerId: z.string().nullish(),
  notes: z.string().nullish(),
});

/** Blank or absent title/evidenceType fall through to the handler's "required" answer. */
const EvidenceBody = z.object({
  title: z.string().nullish(),
  evidenceType: z.string().nullish(),
  url: z.string().nullish(),
  note: z.string().nullish(),
});

/**
 * Every field `PolicyPackInput` accepts — the body is handed to the service
 * whole, and the service owns the rules (a blank name, a bad scope). `name`
 * refuses `null` because the update path `.trim()`s it.
 */
const PolicyPackBody = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  enabled: z.boolean().optional(),
  projectId: z.number().nullish(),
  agentRef: z.string().nullish(),
});

/**
 * Every field `PolicyGateInput` accepts. `effect` stays a string so the service's
 * own effect check answers; `gateKey` refuses `null` because update `.trim()`s it.
 */
const PolicyGateBody = z.object({
  gateKey: z.string().optional(),
  tool: z.string().nullish(),
  sideEffect: z.enum(['read', 'verify', 'mutate']).nullish(),
  effect: z.string().optional(),
  directive: z.string().nullish(),
  reason: z.string().nullish(),
  position: z.number().optional(),
});

/** Field whitelists per governance tracker — the one place each tracker's editable shape lives. */
const TRACKERS: Array<{ path: string; table: unknown; opts: TrackerOpts }> = [
  { path: '/vendors', table: securityVendors, opts: { fields: ['name', 'purpose', 'region', 'dataClasses', 'isSubprocessor', 'dpaStatus', 'dpaUrl', 'renewalDate', 'contactEmail', 'website', 'notes'], required: ['name'] } },
  { path: '/incidents', table: securityIncidents, opts: { fields: ['title', 'severity', 'status', 'detectionSource', 'impact', 'rootCause', 'postmortemUrl', 'reportedBy', 'assignedTo', 'resolvedAt'], required: ['title'] } }, // `sourceRef` is NOT writable: it is the dedupe key of platform-opened incidents
  { path: '/data-inventory', table: piiDataAssets, opts: { fields: ['name', 'classification', 'dataCategories', 'storageLocation', 'retentionDays', 'legalBasis', 'ownerTeam', 'lastReviewedAt', 'notes'], required: ['name'] } },
  { path: '/dpa', table: securityDpas, opts: { fields: ['counterpartyName', 'counterpartyType', 'status', 'signedAt', 'effectiveDate', 'renewalDate', 'dpaUrl', 'sccVersion', 'notes'], required: ['counterpartyName'] } },
  { path: '/training', table: securityTrainings, opts: { fields: ['userId', 'userName', 'userEmail', 'trainingType', 'trainingName', 'completedAt', 'dueDate', 'status', 'certificateUrl', 'notes'], required: ['userName', 'trainingType', 'trainingName'] } },
  { path: '/compliance-calendar', table: complianceEvents, opts: { fields: ['title', 'framework', 'eventType', 'dueDate', 'status', 'assignedTo', 'isRecurring', 'recurringEvery', 'notes', 'completedAt'], required: ['title', 'framework', 'dueDate'] } },
  { path: '/dsr', table: dataSubjectRequests, opts: { fields: ['requestType', 'subjectEmail', 'jurisdiction', 'notes', 'status', 'rejectionReason'], guardMutation: guardDsrTrackerWrite, project: projectDsrRow, required: ['requestType', 'subjectEmail'] } },
  { path: '/suppression', table: dataSuppressionList, opts: { fields: ['identifierType', 'identifierValue', 'reason', 'notes'], required: ['identifierType', 'identifierValue', 'reason'] } },
  { path: '/access-reviews', table: accessReviews, opts: { fields: ['period', 'scope', 'scopeRef', 'status', 'reviewerId', 'dueDate', 'completedAt', 'findings', 'notes'], required: ['period'] } },
  { path: '/vuln-scans', table: vulnerabilityScans, opts: { fields: ['repoRef', 'ref', 'scanType', 'status', 'triggeredBy', 'startedAt', 'finishedAt', 'summary', 'notes'], required: ['scanType'], guardMutation: guardScanMutation } },
];

export function createGovernanceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // List controls for the active segment.
  router.get('/soc2/controls', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const rows = await db
      .select()
      .from(socControls)
      .where(and(eq(socControls.tenantId, tenantId), eq(socControls.segmentId, segmentId)));
    return c.json(rows);
  });

  // Seed the CC1–CC9 baseline once per segment.
  router.post('/soc2/seed', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const seeded = await ensureSoc2Baseline(db, tenantId, segmentId);
    if (seeded === 0) return c.json({ seeded: 0, message: 'Baseline already present' });
    await auditGovernanceMutation(c, db, 'soc2-baseline', null, 'create', null, { seeded });
    return c.json({ seeded }, 201);
  });

  // Update a control's status.
  router.patch('/soc2/controls/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const body = await parseBody(c, ControlPatchBody);
    if (body.status !== undefined && !isControlStatus(body.status)) {
      return c.json({ error: `status must be one of ${CONTROL_STATUSES.join(', ')}` }, 400);
    }
    const changed = await patchSocControl(db, { tenantId, segmentId }, id, {
      status: body.status as ControlStatus | undefined, ownerId: body.ownerId, notes: body.notes,
    });
    if (!changed) return c.json({ error: 'control not found' }, 404);
    await auditGovernanceMutation(c, db, 'soc2-control', changed.updated.id, 'update', changed.before, changed.updated);
    return c.json(changed.updated);
  });

  // The segment's SOC 2 controls WITH their evidence (SEC-1 evidence export) —
  // a registered export source: JSON package by default, csv|xlsx grid on
  // request (also at /api/exports/sources/governance.soc2-evidence).
  router.get('/soc2/export', exportSourceHandler(soc2EvidenceExportSource, db));

  // The segment's recent evidence — automated rows (evidence_type 'automated') carry their
  // provenance in `sourceRef` / `note`. Read-only, member-level like the control list.
  router.get('/soc2/evidence', async (c) => {
    const { tenantId, segmentId } = scope(c);
    return c.json(await listRecentEvidence(db, { tenantId, segmentId }));
  });

  // The governance-auditor's OPEN gaps (merged PRs without a scan/review, controls without evidence).
  router.get('/soc2/gaps', async (c) => {
    const { tenantId, segmentId } = scope(c);
    return c.json(await listOpenGaps(db, { tenantId, segmentId }));
  });

  // What executing a data subject request would do (the API owns the answer; the client never
  // re-derives it from the request type). Static paths below win over the tracker's `/:id`.
  router.get('/dsr/:id/plan', async (c) => {
    const plan = await planDataSubjectRequest(db, scope(c), c.req.param('id'));
    return plan ? c.json(plan) : c.json({ error: 'request not found' }, 404);
  });

  // Execute a data subject request for THIS segment (PRD 08 §10): export / suppress / erase through
  // the Segment-scoped subject-store adapters. An export is persisted to file storage and offered at
  // GET /dsr/:id/export; it is never auto-completed (see POST /dsr/:id/deliver).
  router.post('/dsr/:id/execute', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    const bucket = (c.env as { UPLOADS?: R2Bucket }).UPLOADS;
    // A PRIVATE key (`<tenant>/private/dsr/...`): `/api/assets/*`, the tenant upload reader and signing all refuse it.
    const persistExport: PersistExport = (fileName, json) =>
      storePrivateObject(bucket, tenantId, 'dsr', fileName, json, 'application/json');
    const out = await executeDataSubjectRequest(c.env as Env, db, { tenantId, segmentId }, c.req.param('id'), actor, { persistExport });
    if (!out.ok) return c.json({ error: out.error }, out.status);
    // The storage key stays server-side: the client gets the download URL, nothing else.
    return c.json({ ok: true, result: toPublicDsrResult(out.result, c.req.param('id')) });
  });

  // A manager records that the subject's identity was verified - the only way `verifiedAt` is set.
  router.post('/dsr/:id/verify-identity', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    const out = await verifyDsrIdentity(c.env as Env, db, { tenantId, segmentId }, c.req.param('id'), actor);
    if (!out.ok) return c.json({ error: out.error }, out.status);
    return c.json(out);
  });

  // Download the persisted export - MANAGER only (it is the subject's personal data), tenant-checked, and
  // only for a request of THIS segment. The object lives under a private key prefix `/api/assets` refuses.
  router.get('/dsr/:id/export', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const key = await dsrExportKey(db, { tenantId, segmentId }, c.req.param('id'));
    if (!key) return c.json({ error: 'no export has been prepared for this request' }, 404);
    const res = await readPrivateObject((c.env as { UPLOADS?: R2Bucket }).UPLOADS, key, tenantId);
    if (res === 'unconfigured') return c.json({ error: 'File storage not configured' }, 503);
    if (res === 'not-found') return c.json({ error: 'Not found' }, 404);
    const headers = new Headers(res.headers);
    headers.set('Content-Disposition', `attachment; filename="dsr-${c.req.param('id')}.json"`);
    headers.set('Cache-Control', 'private, no-store'); // personal data: never cache
    return new Response(res.body, { headers });
  });

  // A manager confirms the subject received what was prepared: the only way an export completes.
  router.post('/dsr/:id/deliver', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    const out = await markDsrDelivered(c.env as Env, db, { tenantId, segmentId }, c.req.param('id'), actor, (c.env as { UPLOADS?: R2Bucket }).UPLOADS);
    if (!out.ok) return c.json({ error: out.error }, out.status);
    return c.json({ ok: true, result: toPublicDsrResult(out.result, c.req.param('id')) });
  });

  // Attach evidence to a control.
  router.post('/soc2/controls/:id/evidence', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const controlId = c.req.param('id');
    const body = await parseBody(c, EvidenceBody);
    if (!body.title?.trim() || !body.evidenceType?.trim()) {
      return c.json({ error: 'title and evidenceType are required' }, 400);
    }
    const attached = await attachManualEvidence(db, { tenantId, segmentId }, controlId, {
      title: body.title, evidenceType: body.evidenceType, url: body.url, note: body.note,
    });
    if (!attached.ok) {
      return attached.reason === 'reserved_type'
        ? c.json({ error: `evidenceType '${body.evidenceType.trim()}' is reserved for evidence the platform records itself` }, 403)
        : c.json({ error: 'control not found' }, 404);
    }
    await auditGovernanceMutation(c, db, 'soc2-evidence', attached.evidence.id, 'evidence', null, attached.evidence);
    return c.json(attached.evidence, 201);
  });

  // -------------------------------------------------------------------------
  // Policy packs — the authoring store the runtime's PolicyGate enforcement reads.
  // Reads are member-level; every write is manager+ and invalidates the tenant's
  // resolution cache (inside the service, so no route can forget).
  // -------------------------------------------------------------------------

  router.get('/policy-packs', async (c) => {
    const { tenantId, segmentId } = scope(c);
    return c.json(await listPolicyPacks(db, tenantId, segmentId));
  });

  // Preview EXACTLY what the runtime would receive for a scope — the same
  // resolver dispatch calls, so the UI can never disagree with enforcement.
  router.get('/policy-gates/effective', async (c) => {
    const tenantId = c.get('tenantId');
    const projectRaw = c.req.query('project');
    const projectId = projectRaw != null && Number.isFinite(Number(projectRaw)) ? Number(projectRaw) : null;
    const gates = await resolvePolicyGates(c.env, db, {
      tenantId, projectId, agentRef: c.req.query('agent') ?? null,
    });
    // A client that declared `?gates=2` reads compact `sideEffect` gates; an older one gets them spelled out per tool.
    return c.json({ gates: gatesForWireLevel(gates, c.req.query('gates')) });
  });

  router.post('/policy-packs', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await parseBody(c, PolicyPackBody);
    const res = await createPolicyPack(c.env, db, tenantId, segmentId ?? null, {
      ...body, createdBy: c.get('userId'),
    });
    return 'error' in res ? c.json(res, 400) : c.json(res, 201);
  });

  router.patch('/policy-packs/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, PolicyPackBody);
    const res = await updatePolicyPack(c.env, db, c.get('tenantId'), c.req.param('id'), body);
    if ('error' in res) return c.json(res, res.error === 'pack not found' ? 404 : 400);
    return c.json(res);
  });

  router.delete('/policy-packs/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const res = await deletePolicyPack(c.env, db, c.get('tenantId'), c.req.param('id'));
    if ('error' in res) return c.json(res, 404);
    return c.json(res);
  });

  router.post('/policy-packs/:id/gates', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, PolicyGateBody);
    const res = await createPolicyGate(c.env, db, c.get('tenantId'), c.req.param('id'), body);
    if ('error' in res) return c.json(res, res.error === 'pack not found' ? 404 : 400);
    return c.json(res, 201);
  });

  router.patch('/policy-gates/:gateId', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, PolicyGateBody);
    const res = await updatePolicyGate(c.env, db, c.get('tenantId'), c.req.param('gateId'), body);
    if ('error' in res) return c.json(res, res.error === 'gate not found' ? 404 : 400);
    return c.json(res);
  });

  router.delete('/policy-gates/:gateId', requireRole(TenantRole.MANAGER), async (c) => {
    const res = await deletePolicyGate(c.env, db, c.get('tenantId'), c.req.param('gateId'));
    if ('error' in res) return c.json(res, 404);
    return c.json(res);
  });

  // What a scan FOUND — static `/:scanId/findings` subpaths, mounted before the
  // tracker so they win over its `/:id`.
  router.route('/vuln-scans', createVulnerabilityFindingRoutes(db));
  // The `governance_audit` agent tool's ruleset resolve + audit run endpoints (PRD 08 §4.2).
  router.route('/', createGovernanceRuleAuditRoutes(db));
  // Every other tracker is the same segment-scoped CRUD — one factory, mounted N times.
  mountTrackers(router, db, TRACKERS.map((t) => ({ ...t, opts: { ...t.opts, auditEntity: t.path.slice(1) } })));
  router.route('/stakeholder-alignment', createStakeholderAlignmentRoutes(db));

  return router;
}
