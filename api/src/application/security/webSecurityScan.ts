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
 */
import { and, desc, eq, ne, inArray, isNotNull } from 'drizzle-orm';
import { projects, tasks } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { SecurityAuditService } from './SecurityAuditService';
import { openTaskMarkers } from './findingMarkers';
import { scanWebTarget, normalizeScanTarget, ScanTargetError, type WebFinding } from './WebSecurityScanner';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * PURE decision: given the open tickets in a project, which ones should this re-scan
 * auto-close? A ticket is resolved when it carries a web marker for THIS origin that
 * the current scan no longer raises. Scoped to one origin's `[web:*]` markers so it
 * never touches SOC 2 / GitHub / manual tickets. Separated from IO so it is fully
 * unit-testable without a DB (mirrors the scanner's pure/IO split).
 */
export function selectResolvedTicketIds(
  openTickets: Array<{ id: number; title: string | null }>,
  origin: string,
  currentMarkers: Set<string>,
): number[] {
  const originLc = origin.toLowerCase();
  const out: number[] = [];
  for (const r of openTickets) {
    const m = /\[web:[a-z0-9-]+:([^\]]+)\]/i.exec(r.title ?? '');
    if (!m) continue;
    if ((m[1] ?? '').toLowerCase() !== originLc) continue; // only this site's findings
    if (currentMarkers.has(m[0].toLowerCase())) continue;   // still raised → keep open
    out.push(r.id);
  }
  return out;
}

/**
 * Auto-close SECURITY tickets from a prior scan of the SAME origin whose finding the
 * current scan no longer raises. Safe precisely because this scanner is deterministic:
 * a check that fired before and doesn't now is objectively resolved (unlike an
 * external alert feed's silence, which is ambiguous — see githubAlerts). Returns the
 * number closed.
 */
async function autoCloseResolved(db: Db, projectId: number, origin: string, currentMarkers: Set<string>): Promise<number> {
  const rows = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId),
      eq(tasks.archived, false),
      ne(tasks.status, TaskStatus.DONE),
    ));
  const toClose = selectResolvedTicketIds(rows, origin, currentMarkers);
  if (toClose.length === 0) return 0;
  await db.update(tasks)
    .set({ status: TaskStatus.DONE, updatedAt: new Date() })
    .where(inArray(tasks.id, toClose));
  return toClose.length;
}

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
  input: { targetUrl: string; projectId?: number; trigger?: 'cron' | 'manual'; agentRef?: string; fetchFn?: typeof fetch },
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
      console.warn(`[webSecurityScan] failed to record ${f.marker}: ${(e as Error).message}`);
    }
  }

  // Auto-close tickets for findings this deterministic re-scan no longer raises, and
  // use the real closed count as the baseline's "resolved" number.
  const currentMarkers = new Set(scan.findings.map((f) => f.marker.toLowerCase()));
  const resolvedFindings = await autoCloseResolved(db, projectId, scan.origin, currentMarkers);

  // Baseline: compare to the previous completed scan of the same URL.
  const prev = await svc.previousWebScan(tenantId, scan.origin, auditId);
  const baseline: ScanBaseline = {
    previousScore: prev?.score ?? null,
    previousFindings: prev?.findingsCount ?? null,
    scoreDelta: prev?.score != null ? scan.score - prev.score : null,
    newFindings: fresh.length,
    resolvedFindings,
  };

  const scorePhrase = prev?.score != null
    ? `Score ${prev.score} → ${scan.score}.`
    : `Score ${scan.score}/100.`;
  await svc.finishAudit(tenantId, auditId, {
    status: 'complete',
    score: scan.score,
    summary:
      `Scanned ${scan.origin}. ${scorePhrase} ${scan.findings.length} issue(s) found` +
      (deduped ? `, ${taskIds.length} newly filed (${deduped} already tracked)` : `, ${taskIds.length} filed`) +
      (scan.server ? `. Server: ${scan.server}.` : '.'),
  }).catch(() => {});

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
      });
      if (res.ok) { out.scanned += 1; out.findingsFiled += res.recorded; }
    } catch (e) {
      console.warn(`[webScanSweep] project ${row.id} scan failed: ${(e as Error).message}`);
    }
  }
  return out;
}
