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
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { mountTrackers, scope, type TrackerOpts } from './segmentTrackerRoutes';
import {
  socControls, socEvidence,
  securityVendors, securityIncidents, piiDataAssets, securityDpas,
  securityTrainings, complianceEvents, dataSubjectRequests, dataSuppressionList,
  accessReviews, vulnerabilityScans,
} from '../../infrastructure/database/schema';
import {
  createPolicyGate, createPolicyPack, deletePolicyGate, deletePolicyPack,
  listPolicyPacks, resolvePolicyGates, updatePolicyGate, updatePolicyPack,
  type PolicyGateInput, type PolicyPackInput,
} from '../../application/governance/policyPackService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const CONTROL_STATUSES = ['not_started', 'in_progress', 'ready', 'out_of_scope'] as const;
type ControlStatus = (typeof CONTROL_STATUSES)[number];
const isControlStatus = (v: unknown): v is ControlStatus =>
  typeof v === 'string' && (CONTROL_STATUSES as readonly string[]).includes(v);

/** SOC 2 Common Criteria baseline (seeded on first use). */
const SOC2_BASELINE: Array<{ controlRef: string; category: string; name: string; requirement: string }> = [
  { controlRef: 'CC1.1', category: 'CC1', name: 'Integrity & ethical values', requirement: 'The entity demonstrates a commitment to integrity and ethical values.' },
  { controlRef: 'CC1.2', category: 'CC1', name: 'Board independence & oversight', requirement: 'The board exercises oversight independent of management.' },
  { controlRef: 'CC1.3', category: 'CC1', name: 'Structures & reporting lines', requirement: 'Management establishes structures, reporting lines, authorities and responsibilities.' },
  { controlRef: 'CC1.4', category: 'CC1', name: 'Commitment to competence', requirement: 'The entity attracts, develops and retains competent individuals.' },
  { controlRef: 'CC2.1', category: 'CC2', name: 'Quality information', requirement: 'The entity obtains and uses relevant, quality information.' },
  { controlRef: 'CC2.2', category: 'CC2', name: 'Internal communication', requirement: 'The entity internally communicates information needed for controls.' },
  { controlRef: 'CC2.3', category: 'CC2', name: 'External communication', requirement: 'The entity communicates with external parties about controls.' },
  { controlRef: 'CC3.1', category: 'CC3', name: 'Objectives & risk', requirement: 'The entity specifies objectives to enable identification of risks.' },
  { controlRef: 'CC3.2', category: 'CC3', name: 'Risk identification', requirement: 'The entity identifies and analyzes risks to its objectives.' },
  { controlRef: 'CC3.3', category: 'CC3', name: 'Fraud risk', requirement: 'The entity considers the potential for fraud in assessing risks.' },
  { controlRef: 'CC3.4', category: 'CC3', name: 'Change risk', requirement: 'The entity identifies and assesses changes that could impact controls.' },
  { controlRef: 'CC4.1', category: 'CC4', name: 'Control monitoring', requirement: 'The entity selects, develops and performs evaluations of controls.' },
  { controlRef: 'CC4.2', category: 'CC4', name: 'Deficiency communication', requirement: 'The entity evaluates and communicates control deficiencies.' },
  { controlRef: 'CC5.1', category: 'CC5', name: 'Control activities', requirement: 'The entity selects and develops control activities that mitigate risk.' },
  { controlRef: 'CC5.2', category: 'CC5', name: 'Technology controls', requirement: 'The entity selects and develops general control activities over technology.' },
  { controlRef: 'CC5.3', category: 'CC5', name: 'Policies & procedures', requirement: 'The entity deploys control activities through policies and procedures.' },
  { controlRef: 'CC6.1', category: 'CC6', name: 'Logical access', requirement: 'The entity implements logical access security over protected information assets.' },
  { controlRef: 'CC6.2', category: 'CC6', name: 'Access provisioning', requirement: 'Access is registered, authorized and de-provisioned in a timely manner.' },
  { controlRef: 'CC6.3', category: 'CC6', name: 'Access removal', requirement: 'The entity removes access to protected assets when no longer required.' },
  { controlRef: 'CC6.6', category: 'CC6', name: 'External threats', requirement: 'The entity implements controls to protect against external threats.' },
  { controlRef: 'CC6.7', category: 'CC6', name: 'Data transmission', requirement: 'The entity restricts the transmission/movement of information.' },
  { controlRef: 'CC7.1', category: 'CC7', name: 'Vulnerability detection', requirement: 'The entity uses detection/monitoring to identify vulnerabilities.' },
  { controlRef: 'CC7.2', category: 'CC7', name: 'Security monitoring', requirement: 'The entity monitors system components for anomalies.' },
  { controlRef: 'CC7.3', category: 'CC7', name: 'Incident evaluation', requirement: 'The entity evaluates security events to determine a response.' },
  { controlRef: 'CC7.4', category: 'CC7', name: 'Incident response', requirement: 'The entity responds to identified security incidents.' },
  { controlRef: 'CC8.1', category: 'CC8', name: 'Change management', requirement: 'The entity authorizes, designs, tests and approves changes.' },
  { controlRef: 'CC9.1', category: 'CC9', name: 'Risk mitigation', requirement: 'The entity identifies and develops risk mitigation activities.' },
  { controlRef: 'CC9.2', category: 'CC9', name: 'Vendor risk', requirement: 'The entity assesses and manages risks from vendors and partners.' },
];

/** Field whitelists per governance tracker — the one place each tracker's editable shape lives. */
const TRACKERS: Array<{ path: string; table: unknown; opts: TrackerOpts }> = [
  { path: '/vendors', table: securityVendors, opts: { fields: ['name', 'purpose', 'region', 'dataClasses', 'isSubprocessor', 'dpaStatus', 'dpaUrl', 'renewalDate', 'contactEmail', 'website', 'notes'], required: ['name'] } },
  { path: '/incidents', table: securityIncidents, opts: { fields: ['title', 'severity', 'status', 'detectionSource', 'impact', 'rootCause', 'postmortemUrl', 'reportedBy', 'assignedTo', 'resolvedAt', 'sourceRef'], required: ['title'] } },
  { path: '/data-inventory', table: piiDataAssets, opts: { fields: ['name', 'classification', 'dataCategories', 'storageLocation', 'retentionDays', 'legalBasis', 'ownerTeam', 'lastReviewedAt', 'notes'], required: ['name'] } },
  { path: '/dpa', table: securityDpas, opts: { fields: ['counterpartyName', 'counterpartyType', 'status', 'signedAt', 'effectiveDate', 'renewalDate', 'dpaUrl', 'sccVersion', 'notes'], required: ['counterpartyName'] } },
  { path: '/training', table: securityTrainings, opts: { fields: ['userId', 'userName', 'userEmail', 'trainingType', 'trainingName', 'completedAt', 'dueDate', 'status', 'certificateUrl', 'notes'], required: ['userName', 'trainingType', 'trainingName'] } },
  { path: '/compliance-calendar', table: complianceEvents, opts: { fields: ['title', 'framework', 'eventType', 'dueDate', 'status', 'assignedTo', 'isRecurring', 'recurringEvery', 'notes', 'completedAt'], required: ['title', 'framework', 'dueDate'] } },
  { path: '/dsr', table: dataSubjectRequests, opts: { fields: ['requestType', 'subjectEmail', 'jurisdiction', 'notes', 'status', 'rejectionReason'], required: ['requestType', 'subjectEmail'] } },
  { path: '/suppression', table: dataSuppressionList, opts: { fields: ['identifierType', 'identifierValue', 'reason', 'notes'], required: ['identifierType', 'identifierValue', 'reason'] } },
  { path: '/access-reviews', table: accessReviews, opts: { fields: ['period', 'scope', 'scopeRef', 'status', 'reviewerId', 'dueDate', 'completedAt', 'findings', 'notes'], required: ['period'] } },
  { path: '/vuln-scans', table: vulnerabilityScans, opts: { fields: ['repoRef', 'ref', 'scanType', 'status', 'triggeredBy', 'startedAt', 'finishedAt', 'summary', 'notes'], required: ['scanType'] } },
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
    const existing = await db
      .select({ id: socControls.id })
      .from(socControls)
      .where(and(eq(socControls.tenantId, tenantId), eq(socControls.segmentId, segmentId)))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ seeded: 0, message: 'Baseline already present' });
    }
    await db.insert(socControls).values(
      SOC2_BASELINE.map((ctl) => ({ ...ctl, tenantId, segmentId })),
    );
    return c.json({ seeded: SOC2_BASELINE.length }, 201);
  });

  // Update a control's status.
  router.patch('/soc2/controls/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const body = await c.req.json<{ status?: string; ownerId?: string; notes?: string }>();
    if (body.status !== undefined && !isControlStatus(body.status)) {
      return c.json({ error: `status must be one of ${CONTROL_STATUSES.join(', ')}` }, 400);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) patch.status = body.status;
    if (body.ownerId !== undefined) patch.ownerId = body.ownerId;
    if (body.notes !== undefined) patch.notes = body.notes;

    const [updated] = await db
      .update(socControls)
      .set(patch)
      .where(and(eq(socControls.id, id), eq(socControls.tenantId, tenantId), eq(socControls.segmentId, segmentId)))
      .returning();
    if (!updated) return c.json({ error: 'control not found' }, 404);
    return c.json(updated);
  });

  // Export the segment's SOC 2 controls WITH their attached evidence as one
  // structured JSON audit package (SEC-1 evidence export). Read for any member —
  // an auditor/host pulls the whole posture in a single call. Segment-threaded
  // like every other governance read, so a segmented tenant exports only the
  // active segment's controls + evidence.
  router.get('/soc2/export', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const [controls, evidence] = await Promise.all([
      db
        .select()
        .from(socControls)
        .where(and(eq(socControls.tenantId, tenantId), eq(socControls.segmentId, segmentId))),
      db
        .select()
        .from(socEvidence)
        .where(and(eq(socEvidence.tenantId, tenantId), eq(socEvidence.segmentId, segmentId))),
    ]);

    // Group evidence under its control so the package is control-centric.
    const byControl = new Map<string, Array<Record<string, unknown>>>();
    for (const e of evidence as Array<Record<string, unknown>>) {
      const cid = String(e.controlId);
      const list = byControl.get(cid) ?? [];
      list.push(e);
      byControl.set(cid, list);
    }
    const controlsWithEvidence = (controls as Array<Record<string, unknown>>).map((ctl) => ({
      ...ctl,
      evidence: byControl.get(String(ctl.id)) ?? [],
    }));

    return c.json({
      framework: 'SOC 2',
      exportedAt: new Date().toISOString(),
      tenantId,
      segmentId,
      controlCount: controlsWithEvidence.length,
      evidenceCount: (evidence as unknown[]).length,
      controls: controlsWithEvidence,
    });
  });

  // Attach evidence to a control.
  router.post('/soc2/controls/:id/evidence', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const controlId = c.req.param('id');
    const body = await c.req.json<{ title?: string; evidenceType?: string; url?: string; note?: string }>();
    if (!body.title?.trim() || !body.evidenceType?.trim()) {
      return c.json({ error: 'title and evidenceType are required' }, 400);
    }
    // Ensure the control belongs to this segment before attaching.
    const [ctl] = await db
      .select({ id: socControls.id })
      .from(socControls)
      .where(and(eq(socControls.id, controlId), eq(socControls.tenantId, tenantId), eq(socControls.segmentId, segmentId)))
      .limit(1);
    if (!ctl) return c.json({ error: 'control not found' }, 404);

    const [evidence] = await db
      .insert(socEvidence)
      .values({
        tenantId,
        segmentId,
        controlId,
        title: body.title.trim(),
        evidenceType: body.evidenceType.trim(),
        url: body.url ?? null,
        note: body.note ?? null,
      })
      .returning();
    return c.json(evidence, 201);
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
    return c.json({ gates });
  });

  router.post('/policy-packs', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<PolicyPackInput>();
    const res = await createPolicyPack(c.env, db, tenantId, segmentId ?? null, {
      ...body, createdBy: c.get('userId'),
    });
    return 'error' in res ? c.json(res, 400) : c.json(res, 201);
  });

  router.patch('/policy-packs/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await c.req.json<PolicyPackInput>();
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
    const body = await c.req.json<PolicyGateInput>();
    const res = await createPolicyGate(c.env, db, c.get('tenantId'), c.req.param('id'), body);
    if ('error' in res) return c.json(res, res.error === 'pack not found' ? 404 : 400);
    return c.json(res, 201);
  });

  router.patch('/policy-gates/:gateId', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await c.req.json<PolicyGateInput>();
    const res = await updatePolicyGate(c.env, db, c.get('tenantId'), c.req.param('gateId'), body);
    if ('error' in res) return c.json(res, res.error === 'gate not found' ? 404 : 400);
    return c.json(res);
  });

  router.delete('/policy-gates/:gateId', requireRole(TenantRole.MANAGER), async (c) => {
    const res = await deletePolicyGate(c.env, db, c.get('tenantId'), c.req.param('gateId'));
    if ('error' in res) return c.json(res, 404);
    return c.json(res);
  });

  // Every other tracker is the same segment-scoped CRUD — one factory, mounted N times.
  mountTrackers(router, db, TRACKERS);

  return router;
}
