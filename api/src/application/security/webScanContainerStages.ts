/**
 * webScanContainerStages — the IO seam between the Worker-side web scan and the
 * Node container that can do what the Worker cannot.
 *
 * TWO DIRECTIONS, ONE SEAM
 *   1. DISPATCH (Worker → container). `runWebScan` asks the container runtime for the
 *      TLS + CVE stages. When the container binding is absent, or the container fails
 *      its liveness probe, the stages come back marked `not_run` WITH A REASON —
 *      never omitted, because an omitted stage reads as a stage that passed.
 *   2. INGEST (container → Worker). The container posts each stage's OBSERVATION back
 *      (a certificate description, a set of response headers) and this module maps it
 *      through the pure evaluators into findings, then files them through the SAME
 *      `SecurityAuditService.recordFinding` path every other web-scan finding uses.
 *      There is no second persistence path and no second table: the findings land as
 *      SECURITY tickets on the same audit run, and the run is re-rolled-up so its
 *      score and counts include them.
 *
 * AUTHENTICATION follows the mechanism the container↔API boundary already uses
 * (`application/runtime/containerRunToken.ts`): an HMAC-SHA256 over `JWT_SECRET`,
 * scoped to exactly one id, recomputed and constant-time compared on the way back in.
 * The shared HMAC primitives come from `infrastructure/crypto/webhookHmac` rather
 * than being re-derived here. The subject string is DIFFERENT from the run token's
 * (`web-scan-stage:` vs `container-run:`), which is deliberate: a scan token must not
 * be usable to drive an agent execution that happens to carry the same number.
 *
 * TENANCY is never asserted by the container. The audit id in the payload is resolved
 * to its row, and the tenant comes off THAT row — the same "derive the run context
 * authoritatively" rule the container-op endpoint follows. A container that lied
 * about a tenant id would simply not be believed, because it is never asked.
 */
import { and, eq } from 'drizzle-orm';
import { hmacSha256Hex, timingSafeEqualHex } from '../../infrastructure/crypto/webhookHmac';
import { securityAudits } from '../../infrastructure/database/schema';
import { probeContainerHealth } from '../runtime/cloudDispatch';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { SecurityAuditService } from './SecurityAuditService';
import { openTaskMarkers } from './findingMarkers';
import { autoCloseResolved } from './webFindingLifecycle';
import { scoreFromSeverityCounts, type ScanContext, type WebFinding } from './WebSecurityScanner';
import { evaluateTls, type TlsObservation } from './tlsCertificateScan';
import { evaluateCveFindings, fingerprintSoftware, type SoftwareFingerprint } from './softwareFingerprint';
import { resolveAdvisoryFeed } from './advisoryFeed';
import {
  allStagesNotRun,
  allStagesRequested,
  describeStages,
  isWebScanStageId,
  mergeStageReport,
  parseStageReports,
  stageNotRun,
  stageOfCheckId,
  stageRan,
  type WebScanStageId,
  type WebScanStageReport,
} from './webScanStages';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The container endpoint that runs the stages (see api/container/server.mjs). The
 * return path — `POST /api/security/internal/web-scan-stage`, mounted in
 * securityReviewRoutes above authMiddleware — is spelled out in the container image
 * rather than imported: that file is plain ESM with no build step and cannot import
 * from this one, so the two ends are matched by the route's doc comment naming this
 * module and this comment naming that route.
 */
const CONTAINER_STAGE_PATH = '/web-scan';

// ── Per-scan token (mirrors containerRunToken's scheme, different subject) ─────

/** Mint the stage token for one audit run. */
export function mintWebScanStageToken(secret: string, auditId: number): Promise<string> {
  return hmacSha256Hex(secret, `web-scan-stage:${auditId}`);
}

/** Constant-time verify a presented stage token for `auditId`. */
export async function verifyWebScanStageToken(secret: string, auditId: number, presented: unknown): Promise<boolean> {
  if (typeof presented !== 'string' || !presented) return false;
  return timingSafeEqualHex(await mintWebScanStageToken(secret, auditId), presented);
}

// ── Dispatch (Worker → container) ─────────────────────────────────────────────

/** What the container is asked to observe. */
export interface WebScanStageRequest {
  auditId: number;
  /** The scanned origin, e.g. `https://example.com` — the finding marker's scope. */
  origin: string;
  /** Where the container reports back to. */
  internalBaseUrl: string;
  token: string;
  host: string;
  port: number;
}

export interface StageDispatchOutcome {
  /** The stage lines to record on the run right now. */
  stages: WebScanStageReport[];
  dispatched: boolean;
}

/**
 * Ask the container runtime to run the TLS + CVE stages for a scan.
 *
 * Never throws and never blocks the scan: a scan whose container is missing is a
 * complete, honest scan with two stages marked `not_run`, which is strictly better
 * than a scan that fails because an optional runtime is unavailable. The liveness
 * probe is the same one cloud dispatch uses — a Container DO acks a proxied request
 * even when the image cannot boot, so a bare binding proves nothing.
 */
export async function dispatchWebScanStages(
  env: Env,
  input: { auditId: number; origin: string },
): Promise<StageDispatchOutcome> {
  const at = new Date().toISOString();
  const ns = env.AGENT_CONTAINER;
  if (!ns) {
    return {
      dispatched: false,
      stages: allStagesNotRun(
        'no container runtime is bound to this deployment — the TLS handshake and CVE fingerprint stages need a Node process with a socket, which a Cloudflare Worker does not have',
        at,
      ),
    };
  }

  let url: URL;
  try {
    url = new URL(input.origin);
  } catch {
    return { dispatched: false, stages: allStagesNotRun(`the scanned origin "${input.origin}" could not be parsed`, at) };
  }
  // Plain HTTP has no certificate to inspect; saying so is a real result, not a failure.
  const tlsApplicable = url.protocol === 'https:';

  try {
    const stub = ns.get(ns.idFromName(`web-scan:${input.auditId}`));
    const healthy = await probeContainerHealth(stub as unknown as { fetch: (i: string, init?: RequestInit) => Promise<Response> });
    if (!healthy) {
      return {
        dispatched: false,
        stages: allStagesNotRun('the container runtime did not answer its health probe — the image is not deployed or could not boot', at),
      };
    }

    const request: WebScanStageRequest = {
      auditId: input.auditId,
      origin: input.origin,
      internalBaseUrl: (env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai').replace(/\/$/, ''),
      token: await mintWebScanStageToken(env.JWT_SECRET, input.auditId),
      host: url.hostname,
      port: url.port ? Number(url.port) : (tlsApplicable ? 443 : 80),
    };
    const res = await (stub as unknown as { fetch: (i: string, init?: RequestInit) => Promise<Response> })
      .fetch(`https://agent-container${CONTAINER_STAGE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    if (!res.ok) {
      return { dispatched: false, stages: allStagesNotRun(`the container runtime refused the stage request (HTTP ${res.status})`, at) };
    }

    const stages = allStagesRequested(at);
    if (!tlsApplicable) {
      // Replace only the TLS line: an http:// target genuinely has no certificate,
      // and `https-enforced` is already the finding that says so.
      return {
        dispatched: true,
        stages: stages.map((s) => (s.stage === 'tls'
          ? stageNotRun('tls', 'the target is served over plain HTTP, so there is no TLS certificate to inspect', at)
          : s)),
      };
    }
    return { dispatched: true, stages };
  } catch (e) {
    reportCaughtError(e, {
      source: 'application/security/webScanContainerStages.ts', operation: 'dispatchWebScanStages', level: 'warning',
      context: { logMessage: `[webScanStages] dispatch failed for audit ${input.auditId}: ${(e as Error).message}` },
    });
    return { dispatched: false, stages: allStagesNotRun(`the container runtime could not be reached (${(e as Error).message})`, at) };
  }
}

// ── Ingest (container → Worker) ───────────────────────────────────────────────

/** The observation the container gathers for the CVE stage. It fingerprints nothing
 *  itself — the mapping is pure and lives in `softwareFingerprint` so it is tested. */
export interface CveObservation {
  /** Lowercased response headers from a GET of the target. */
  headers: Record<string, string>;
  /** Bounded HTML body slice. */
  body: string;
}

/** What the container posts back, one call per stage. */
export interface WebScanStageIngestPayload {
  auditId: number;
  token: string;
  stage: WebScanStageId;
  /** Set when the stage failed inside the container; recorded as `not_run` + reason. */
  error?: string;
  tls?: TlsObservation;
  cve?: CveObservation;
}

export type StageIngestResult =
  | { ok: true; stage: WebScanStageId; recorded: number; duplicate: boolean }
  | { ok: false; status: 401 | 404 | 400; reason: string };

/** Reconstruct the pure evaluators' context from the audit row — the origin is the
 *  marker scope, and the marker is what dedupe and auto-close key on. */
function contextFor(origin: string): ScanContext {
  return { origin: origin.toLowerCase(), finalUrl: origin, headers: {}, cookies: [], httpProbe: 'unknown' };
}

/**
 * Record one container stage's result against its audit run.
 *
 * Idempotent per (audit, stage): {@link mergeStageReport} refuses a stage that has
 * already reported, so a redelivered callback returns `duplicate: true` having
 * written nothing. Findings additionally dedupe on their `[web:…]` marker against the
 * project's open tickets, exactly as the Worker-side findings do.
 */
export async function ingestWebScanStage(
  db: Db,
  env: Env,
  payload: WebScanStageIngestPayload,
): Promise<StageIngestResult> {
  const auditId = Number(payload?.auditId);
  if (!Number.isInteger(auditId) || auditId <= 0) return { ok: false, status: 400, reason: 'auditId is required' };
  if (!isWebScanStageId(payload?.stage)) return { ok: false, status: 400, reason: 'unknown stage' };
  if (!(await verifyWebScanStageToken(env.JWT_SECRET, auditId, payload?.token))) {
    return { ok: false, status: 401, reason: 'invalid stage token' };
  }

  // The tenant comes off the audit row, never off the request body.
  const [audit] = await db
    .select({
      id: securityAudits.id,
      tenantId: securityAudits.tenantId,
      projectId: securityAudits.projectId,
      targetUrl: securityAudits.targetUrl,
      stages: securityAudits.stages,
      summary: securityAudits.summary,
    })
    .from(securityAudits)
    .where(and(eq(securityAudits.id, auditId), eq(securityAudits.scanKind, 'web')))
    .limit(1);
  if (!audit) return { ok: false, status: 404, reason: 'scan not found' };

  const tenantId = audit.tenantId;
  const origin = audit.targetUrl ?? '';
  const at = new Date().toISOString();
  const existing = parseStageReports(audit.stages);

  // A stage that failed inside the container is a `not_run` with the real reason —
  // the one thing it must never be is absent.
  if (payload.error) {
    const merged = mergeStageReport(existing, stageNotRun(payload.stage, payload.error.slice(0, 500), at));
    if (!merged.accepted) return { ok: true, stage: payload.stage, recorded: 0, duplicate: true };
    await persistStages(db, tenantId, auditId, merged.stages, audit.summary);
    return { ok: true, stage: payload.stage, recorded: 0, duplicate: false };
  }

  const ctx = contextFor(origin);
  let findings: WebFinding[] = [];
  let ranReason: string | undefined;

  if (payload.stage === 'tls') {
    if (!payload.tls) return { ok: false, status: 400, reason: 'the tls stage requires a tls observation' };
    findings = evaluateTls(ctx, payload.tls, new Date());
  } else {
    const fingerprints: SoftwareFingerprint[] = fingerprintSoftware({
      headers: payload.cve?.headers ?? {},
      body: payload.cve?.body ?? '',
    });
    const feed = resolveAdvisoryFeed(env);
    const outcome = await feed.lookup(env, fingerprints);
    findings = evaluateCveFindings(ctx, fingerprints, outcome);
    ranReason = outcome.performed
      ? `${fingerprints.length} component version(s) fingerprinted and checked against the ${outcome.feedId} advisory feed`
      : `${fingerprints.length} component version(s) fingerprinted; advisory lookup not performed — ${outcome.reason ?? 'no feed configured'}`;
  }

  const merged = mergeStageReport(existing, stageRan(payload.stage, findings.length, ranReason, at));
  if (!merged.accepted) return { ok: true, stage: payload.stage, recorded: 0, duplicate: true };

  const recorded = await recordStageFindings(db, tenantId, auditId, audit.projectId, origin, findings);
  // Close THIS stage's findings that it no longer raises — the same deterministic
  // auto-close the Worker pass performs, scoped to the checks this stage owns. The
  // Worker pass deliberately cannot do it (it never raises these findings, so to it
  // they always look resolved), which is why the stage does it for itself.
  if (audit.projectId != null) {
    const stageId = payload.stage;
    await autoCloseResolved(
      db,
      tenantId,
      audit.projectId,
      origin,
      new Set(findings.map((f) => f.marker.toLowerCase())),
      (checkId) => stageOfCheckId(checkId) === stageId,
    ).catch((e) => {
      reportCaughtError(e, {
        source: 'application/security/webScanContainerStages.ts', operation: 'ingestWebScanStage', level: 'warning',
        context: { logMessage: `[webScanStages] auto-close failed for audit ${auditId}: ${(e as Error).message}` },
      });
    });
  }
  // The stage's own count is what the stage FOUND; `recorded` is what was newly
  // filed after dedupe. The report keeps the former so a re-scan of an unchanged
  // site does not look like the stage stopped finding anything.
  await persistStages(db, tenantId, auditId, merged.stages, audit.summary);
  await rerollAudit(db, tenantId, auditId);
  return { ok: true, stage: payload.stage, recorded, duplicate: false };
}

/** File a stage's findings as SECURITY tickets on the audit — the ONE finding path. */
async function recordStageFindings(
  db: Db,
  tenantId: number,
  auditId: number,
  projectId: number | null,
  origin: string,
  findings: WebFinding[],
): Promise<number> {
  if (findings.length === 0 || projectId == null) return 0;
  const seen = await openTaskMarkers(db, projectId, /\[web:[a-z0-9-]+:[^\]]+\]/i);
  const svc = new SecurityAuditService(db);
  let recorded = 0;
  for (const f of findings) {
    const key = f.marker.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await svc.recordFinding(tenantId, {
        auditId,
        title: `${f.title} ${f.marker}`,
        detail: f.detail,
        severity: f.severity,
        tsc: f.tsc,
        location: origin,
        recommendation: f.recommendation,
      });
      recorded += 1;
    } catch (e) {
      reportCaughtError(e, {
        source: 'application/security/webScanContainerStages.ts', operation: 'recordStageFindings', level: 'warning',
        context: { logMessage: `[webScanStages] failed to record ${f.marker}: ${(e as Error).message}` },
      });
    }
  }
  return recorded;
}

/** Persist the stage list on the audit row (tenant-scoped). */
async function persistStages(
  db: Db,
  tenantId: number,
  auditId: number,
  stages: WebScanStageReport[],
  priorSummary: string | null,
): Promise<void> {
  await db.update(securityAudits)
    .set({ stages, summary: withStageSentence(priorSummary, stages) })
    .where(and(eq(securityAudits.id, auditId), eq(securityAudits.tenantId, tenantId)));
}

/**
 * Re-roll the run's score + counts so a late stage's findings actually move the
 * headline number. Without this the stage's tickets exist and the panel lists them
 * while the score still describes a scan that had not finished — the same "looks
 * clean because the check had not run yet" failure the stage vocabulary exists to
 * eliminate, one layer down.
 */
async function rerollAudit(db: Db, tenantId: number, auditId: number): Promise<void> {
  try {
    const svc = new SecurityAuditService(db);
    // finishAudit recomputes findingsCount + both rollups from the ticket rows, so it
    // is the honest source for the new score — no count is carried by hand.
    // No summary passed: persistStages already wrote the stage sentence, and
    // finishAudit leaves the column untouched when none is supplied.
    await svc.finishAudit(tenantId, auditId, { status: 'complete' });
    const [row] = await db
      .select({ counts: securityAudits.countsBySeverity })
      .from(securityAudits)
      .where(and(eq(securityAudits.id, auditId), eq(securityAudits.tenantId, tenantId)))
      .limit(1);
    const counts = (row?.counts ?? {}) as Record<string, number>;
    await db.update(securityAudits)
      .set({ score: scoreFromSeverityCounts(counts) })
      .where(and(eq(securityAudits.id, auditId), eq(securityAudits.tenantId, tenantId)));
  } catch (e) {
    reportCaughtError(e, {
      source: 'application/security/webScanContainerStages.ts', operation: 'rerollAudit', level: 'warning',
      context: { logMessage: `[webScanStages] re-roll failed for audit ${auditId}: ${(e as Error).message}` },
    });
  }
}

/**
 * Replace (or append) the stage sentence on a run summary. Idempotent — the sentence
 * is delimited so a second stage report rewrites it instead of stacking a third copy.
 */
export function withStageSentence(summary: string | null | undefined, stages: WebScanStageReport[]): string {
  const base = (summary ?? '').split(' Stages — ')[0]!.trimEnd();
  const sentence = describeStages(stages);
  return sentence ? `${base} ${sentence}` : base;
}
