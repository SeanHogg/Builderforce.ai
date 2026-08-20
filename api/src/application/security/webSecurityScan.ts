import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * webSecurityScan — runs {@link scanWebTarget} against a project's configured
 * website and files each finding through the SAME SecurityAuditService pipeline the
 * Security agent and GitHub alerts use (audit ledger + one access-restricted
 * SECURITY ticket per finding). This is the "configure a URL → get findings → they
 * become board work" seam.
 *
 * Mirrors githubAlerts.recordFindings deliberately: dedupe on a stable title marker
 * against OPEN tickets, wrap the fresh findings in ONE audit run, roll up a summary.
 * The one addition is a BASELINE: the run compares its score + finding set to the
 * previous completed scan of the same URL so the panel can show drift ("+2 new,
 * score 62 → 74").
 *
 * A run also carries STAGES: the peer-TLS and CVE checks that a Cloudflare Worker
 * cannot perform run from the Node container and report back through
 * {@link ingestWebScanStage}. The result always states what each of them did — ran,
 * requested, or not run and why — because a report that omits a check it never made
 * reads exactly like a report of a check that passed.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { projects, securityAudits } from '../../infrastructure/database/schema';
import { SecurityAuditService } from './SecurityAuditService';
import { openTaskMarkers } from './findingMarkers';
import { scanWebTarget, normalizeScanTarget, ScanTargetError, type WebFinding } from './WebSecurityScanner';
import { dispatchWebScanStages, withStageSentence } from './webScanContainerStages';
import { allStagesNotRun, type WebScanStageReport } from './webScanStages';
import { autoCloseResolved } from './webFindingLifecycle';

// The close rule lives in `webFindingLifecycle` so the container-stage ingest can
// share it without importing this module back. Re-exported because the existing
// importers (and its test) reach it through here.
export { selectResolvedTicketIds, autoCloseResolved, workerOwnedCheck, type CheckOwnership } from './webFindingLifecycle';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** How the current scan compares to the previous scan of the same URL. */
export interface ScanBaseline {
  previousScore: number | null;
  previousFindings: number | null;
  scoreDelta: number | null;
  /** Findings present now that weren't tracked before (new markers). */
  newFindings: number;
  /** Markers that were open before and are no longer raised (fixed since baseline). */
  resolvedFindings: number;
}

export type WebScanCode = 'invalid_url' | 'blocked_host' | 'no_project' | 'scan_failed';

export type WebScanResult =
  | {
      ok: true;
      auditId: number;
      projectId: number;
      targetUrl: string;
      finalUrl: string;
      score: number;
      recorded: number;
      deduped: number;
      taskIds: number[];
      findings: WebFinding[];
      baseline: ScanBaseline;
      /**
       * What the checks that CANNOT run in a Worker did — the peer-TLS and CVE
       * stages, which need a socket and an advisory feed respectively. Always
       * present, always naming a status and (when it is not 'ran') a reason: a
       * scan that silently omitted them would read as a scan those checks passed.
       */
      stages: WebScanStageReport[];
    }
  | { ok: false; code: WebScanCode; reason: string };

/**
 * Resolve the project a web scan files into: an explicit id (tenant-scoped) else the
 * tenant's most-recently-updated real (non-IDE-storage) project. A URL scan needs no
 * repo, so — unlike the SOC 2 audit — any project is a valid home for its tickets.
 */
export async function resolveScanProject(db: Db, tenantId: number, projectId?: number): Promise<number | null> {
  if (projectId != null) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    return row?.id ?? null;
  }
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.isIdeStorage, false)))
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Persist the configured scan target on a project (the "configure once" step). */
export async function setProjectScanTarget(db: Db, tenantId: number, projectId: number, url: string | null): Promise<string | null> {
  const normalized = url == null || url.trim() === '' ? null : normalizeScanTarget(url);
  await db.update(projects)
    .set({ securityTargetUrl: normalized ?? null, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  return normalized;
}

/** Read a project's configured scan target (tenant-scoped). */
export async function getProjectScanTarget(db: Db, tenantId: number, projectId: number): Promise<string | null> {
  const [row] = await db
    .select({ url: projects.securityTargetUrl })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return row?.url ?? null;
}

/**
 * Scan `targetUrl` and file its findings for `tenantId`. Synchronous (the scan is a
 * couple of HTTP round-trips) so the caller gets findings back in the same request —
 * the immediate-value payoff. Never throws for an operational failure; returns a
 * tagged result the route maps to a status code.
 */
export async function runWebScan(
  db: Db,
  tenantId: number,
  input: {
    targetUrl: string;
    projectId?: number;
    trigger?: 'cron' | 'manual';
    agentRef?: string;
    fetchFn?: typeof fetch;
    /** Worker env — required to reach the container runtime for the TLS/CVE stages.
     *  Omitted (unit tests, callers with no binding) ⇒ those stages report `not_run`
     *  with that as the stated reason, never silence. */
    env?: Env;
  },
): Promise<WebScanResult> {
  // Validate + scan first — no audit row is opened if the target is unscannable.
  let scan;
  try {
    scan = await scanWebTarget(input.targetUrl, { fetchFn: input.fetchFn });
  } catch (e) {
    if (e instanceof ScanTargetError) return { ok: false, code: e.code, reason: e.message };
    return { ok: false, code: 'scan_failed', reason: (e as Error).message || 'The site could not be reached.' };
  }

  const projectId = await resolveScanProject(db, tenantId, input.projectId);
  if (projectId == null) {
    return { ok: false, code: 'no_project', reason: 'No project to file findings into — create a project first.' };
  }

  const svc = new SecurityAuditService(db);
  const auditId = await svc.startAudit(tenantId, {
    projectId,
    agentRef: input.agentRef ?? 'web-scanner',
    trigger: input.trigger ?? 'manual',
    scanKind: 'web',
    targetUrl: scan.origin,
  });

  // Dedupe against OPEN web-scan tickets in this project (same marker grammar the
  // scanner stamps into each title).
  const seen = await openTaskMarkers(db, projectId, /\[web:[a-z0-9-]+:[^\]]+\]/i);
  const fresh: WebFinding[] = [];
  for (const f of scan.findings) {
    const key = f.marker.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(f);
  }
  const deduped = scan.findings.length - fresh.length;

  const taskIds: number[] = [];
  for (const f of fresh) {
    try {
      const rec = await svc.recordFinding(tenantId, {
        auditId,
        title: `${f.title} ${f.marker}`,
        detail: f.detail,
        severity: f.severity,
        tsc: f.tsc,
        location: scan.finalUrl,
        recommendation: f.recommendation,
      });
      taskIds.push(rec.taskId);
    } catch (e) {
      reportCaughtError(e, { source: "application/security/webSecurityScan.ts", operation: "runWebScan", level: 'warning', context: { logMessage: `[webSecurityScan] failed to record ${f.marker}: ${(e as Error).message}` } });
    }
  }

  // Auto-close tickets for findings this deterministic re-scan no longer raises, and
  // use the real closed count as the baseline's "resolved" number.
  const currentMarkers = new Set(scan.findings.map((f) => f.marker.toLowerCase()));
  const resolvedFindings = await autoCloseResolved(db, tenantId, projectId, scan.origin, currentMarkers);

  // Baseline: compare to the previous completed scan of the same URL.
  const prev = await svc.previousWebScan(tenantId, scan.origin, auditId);
  const baseline: ScanBaseline = {
    previousScore: prev?.score ?? null,
    previousFindings: prev?.findingsCount ?? null,
    scoreDelta: prev?.score != null ? scan.score - prev.score : null,
    newFindings: fresh.length,
    resolvedFindings,
  };

  // The checks a Worker physically cannot make: ask the container runtime for them.
  // This is dispatch only — the container posts its observations back through
  // `ingestWebScanStage`, which files their findings onto THIS audit run. When there
  // is no container the stages come back `not_run` carrying the reason, so the scan
  // is complete and honest either way.
  const dispatch = input.env
    ? await dispatchWebScanStages(input.env, { auditId, origin: scan.origin })
    : {
        dispatched: false,
        stages: allStagesNotRun('the scan ran without a runtime binding, so the container stages could not be requested'),
      };

  const scorePhrase = prev?.score != null
    ? `Score ${prev.score} → ${scan.score}.`
    : `Score ${scan.score}/100.`;
  const summary =
    `Scanned ${scan.origin}. ${scorePhrase} ${scan.findings.length} issue(s) found` +
    (deduped ? `, ${taskIds.length} newly filed (${deduped} already tracked)` : `, ${taskIds.length} filed`) +
    (scan.server ? `. Server: ${scan.server}.` : '.');
  await svc.finishAudit(tenantId, auditId, {
    status: 'complete',
    score: scan.score,
    summary: withStageSentence(summary, dispatch.stages),
  }).catch((error) => {
    reportCaughtError(error, { source: "application/security/webSecurityScan.ts", operation: "runWebScan" });
  });

  // Persisted separately from finishAudit: the stage list belongs to the run, not to
  // the rollup, and a failure to write it must not lose the finished audit.
  await db.update(securityAudits)
    .set({ stages: dispatch.stages })
    .where(and(eq(securityAudits.id, auditId), eq(securityAudits.tenantId, tenantId)))
    .catch((error) => {
      reportCaughtError(error, { source: "application/security/webSecurityScan.ts", operation: "runWebScan", level: 'warning' });
    });

  return {
    ok: true,
    auditId,
    projectId,
    targetUrl: scan.origin,
    finalUrl: scan.finalUrl,
    score: scan.score,
    recorded: taskIds.length,
    deduped,
    taskIds,
    findings: scan.findings,
    baseline,
    stages: dispatch.stages,
  };
}

/** Cap on projects re-scanned per weekly sweep tick (bounds Worker subrequests). */
const WEB_SCAN_SWEEP_CAP = 100;

export interface WebScanSweepResult {
  projectsWithTarget: number;
  scanned: number;
  findingsFiled: number;
  /** Projects skipped because the cap was hit — surfaced, never silently dropped. */
  skippedOverCap: number;
}

/**
 * Weekly sweep: re-scan every project that has a configured `security_target_url`,
 * so posture drift (a header that regressed, a newly exposed file) is caught without
 * anyone clicking Run. Best-effort per project; findings dedupe + resolved findings
 * auto-close through the same {@link runWebScan} path as a manual scan.
 */
export async function runWebScanSweep(env: Env): Promise<WebScanSweepResult> {
  const db = buildDatabase(env);
  const out: WebScanSweepResult = { projectsWithTarget: 0, scanned: 0, findingsFiled: 0, skippedOverCap: 0 };

  const rows = await db
    .select({ id: projects.id, tenantId: projects.tenantId, url: projects.securityTargetUrl })
    .from(projects)
    .where(and(isNotNull(projects.securityTargetUrl), eq(projects.isIdeStorage, false)))
    .orderBy(desc(projects.updatedAt));

  out.projectsWithTarget = rows.length;
  const batch = rows.slice(0, WEB_SCAN_SWEEP_CAP);
  out.skippedOverCap = rows.length - batch.length;

  for (const row of batch) {
    if (!row.url) continue;
    try {
      const res = await runWebScan(db, row.tenantId, {
        targetUrl: row.url,
        projectId: row.id,
        trigger: 'cron',
        agentRef: 'web-scanner',
        env,
      });
      if (res.ok) { out.scanned += 1; out.findingsFiled += res.recorded; }
    } catch (e) {
      reportCaughtError(e, { source: "application/security/webSecurityScan.ts", operation: "runWebScanSweep", level: 'warning', context: { logMessage: `[webScanSweep] project ${row.id} scan failed: ${(e as Error).message}` } });
    }
  }
  return out;
}
