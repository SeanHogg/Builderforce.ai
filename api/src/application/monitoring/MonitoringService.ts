import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * MonitoringService — active monitoring: diagram boards, monitor pins, and the
 * breach → incident bridge.
 *
 * A monitor watches something (heartbeat / http check / external webhook signal /
 * platform metric threshold). When it breaches it opens an incident (source
 * 'monitor', carrying the monitor's affected-system + severity) and fires the on-call
 * investigation loop that already exists — IncidentService.openIncident →
 * EscalationService.pageInitial → dispatchIncidentTriage. One open incident per
 * monitor at a time (idempotent); recovery notes the incident but leaves closure +
 * RCA to the on-call responder.
 *
 * Threshold evaluation reuses the alerts primitives (comparatorMatches / evaluateMetric)
 * so there is one metric-evaluation implementation, not two.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  monitoringBoards, monitors, monitorEvents, prodIncidents, incidentEvents,
} from '../../infrastructure/database/schema';
import { IncidentService } from '../incident/IncidentService';
import { EscalationService } from '../incident/EscalationService';
import { findTenantIncidentManagerRef, dispatchIncidentTriage } from '../incident/incidentDispatch';
import { comparatorMatches } from '../alerts/runAlertSweep';
import { evaluateMetric } from '../alerts/metricEvaluators';
import { fireEventTriggers } from '../workflow/eventTriggers';
import { BACKEND_HEALTH_MARKER } from '../backend/adapters/handlerEngineSource';
import type { EvaluateMetricArgs } from '../alerts/metricEvaluators';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export type MonitorType = 'heartbeat' | 'http_check' | 'webhook' | 'metric_threshold' | 'manual';
export type MonitorStatus = 'ok' | 'breached' | 'unknown';
/** A single evaluation outcome; 'skip' = not sweep-evaluated (webhook/manual). */
type EvalResult = 'ok' | 'breach' | 'unknown' | 'skip';

interface MonitorConfig {
  intervalSeconds?: number;   // heartbeat staleness window
  url?: string;               // http_check target
  expectedStatus?: number;    // http_check expected status (default: any 2xx)
  method?: string;            // http_check request method (default GET)
  headers?: Record<string, string>; // http_check request headers (e.g. an auth header)
  bodyMatch?: string;         // http_check: substring the response body must contain to be healthy
  metric?: string;            // metric_threshold: an AlertMetric
  comparator?: string;        // gt|lt|gte|lte
  threshold?: number;
  windowDays?: number;
}

type MonitorRow = typeof monitors.$inferSelect;

/**
 * A monitor as safely returned to a client: the signal webhook secret is stripped,
 * because a board/monitor read is MEMBER+ and the secret would let any member forge
 * signals. Whether a secret EXISTS is surfaced as a boolean; the full secret-bearing
 * signalUrl is minted only on the manager-gated GET /monitors/:id (via resolveSignalToken).
 */
export type PublicMonitor = Omit<MonitorRow, 'webhookSecret'> & { hasSignalSecret: boolean };

function toPublicMonitor(m: MonitorRow): PublicMonitor {
  const { webhookSecret, ...rest } = m;
  return { ...rest, hasSignalSecret: !!webhookSecret };
}

/** A short per-monitor secret token for the signal webhook. */
function newSecret(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * The board and the affected-system tag generated backend monitors carry.
 *
 * `affectedSystem` is the identity here, not the label: a label is editable by
 * anyone with the board open, and matching on one would make a redeploy create a
 * second monitor the moment somebody renamed the first.
 */
const DEPLOYED_BACKEND_BOARD = 'Deployed backends';
const DEPLOYED_BACKEND_SYSTEM = 'project-backend';

export class MonitoringService {
  constructor(private readonly db: Db) {}

  // ── Boards ─────────────────────────────────────────────────────────────────
  async createBoard(tenantId: number, input: { name: string; projectId?: number | null; imageKey?: string | null; imageWidth?: number | null; imageHeight?: number | null }) {
    const [row] = await this.db.insert(monitoringBoards).values({
      tenantId, name: input.name.slice(0, 255), projectId: input.projectId ?? null,
      imageKey: input.imageKey ?? null, imageWidth: input.imageWidth ?? null, imageHeight: input.imageHeight ?? null,
    }).returning();
    return row!;
  }

  async listBoards(tenantId: number) {
    const boards = await this.db.select().from(monitoringBoards)
      .where(eq(monitoringBoards.tenantId, tenantId)).orderBy(desc(monitoringBoards.updatedAt));
    // Attach a monitor count + worst status per board (small N; one grouped read).
    const counts = await this.db
      .select({ boardId: monitors.boardId, status: monitors.status, n: sql<number>`count(*)::int` })
      .from(monitors).where(eq(monitors.tenantId, tenantId)).groupBy(monitors.boardId, monitors.status);
    return boards.map((b) => {
      const mine = counts.filter((c) => c.boardId === b.id);
      const total = mine.reduce((a, c) => a + c.n, 0);
      const breached = mine.find((c) => c.status === 'breached')?.n ?? 0;
      return { ...b, monitorCount: total, breachedCount: breached };
    });
  }

  async getBoard(tenantId: number, boardId: string) {
    const [board] = await this.db.select().from(monitoringBoards)
      .where(and(eq(monitoringBoards.id, boardId), eq(monitoringBoards.tenantId, tenantId))).limit(1);
    if (!board) return null;
    const mons = await this.db.select().from(monitors)
      .where(eq(monitors.boardId, boardId)).orderBy(desc(monitors.createdAt));
    return { board, monitors: mons.map(toPublicMonitor) };
  }

  async updateBoard(tenantId: number, boardId: string, patch: { name?: string; projectId?: number | null; imageKey?: string | null; imageWidth?: number | null; imageHeight?: number | null }): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name.slice(0, 255);
    if (patch.projectId !== undefined) set.projectId = patch.projectId;
    if (patch.imageKey !== undefined) set.imageKey = patch.imageKey;
    if (patch.imageWidth !== undefined) set.imageWidth = patch.imageWidth;
    if (patch.imageHeight !== undefined) set.imageHeight = patch.imageHeight;
    await this.db.update(monitoringBoards).set(set).where(and(eq(monitoringBoards.id, boardId), eq(monitoringBoards.tenantId, tenantId)));
  }

  async deleteBoard(tenantId: number, boardId: string): Promise<void> {
    await this.db.delete(monitoringBoards).where(and(eq(monitoringBoards.id, boardId), eq(monitoringBoards.tenantId, tenantId)));
  }

  // ── Monitors ─────────────────────────────────────────────────────────────
  private async ownedBoard(tenantId: number, boardId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: monitoringBoards.id }).from(monitoringBoards)
      .where(and(eq(monitoringBoards.id, boardId), eq(monitoringBoards.tenantId, tenantId))).limit(1);
    return !!row;
  }

  async createMonitor(tenantId: number, boardId: string, input: {
    label: string; description?: string | null; posX?: number; posY?: number;
    monitorType?: MonitorType; config?: MonitorConfig; affectedSystem?: string | null;
    severity?: string; escalationPolicyId?: string | null; projectId?: number | null;
  }) {
    if (!(await this.ownedBoard(tenantId, boardId))) throw new Error('Board not found in workspace');
    const [board] = await this.db.select({ projectId: monitoringBoards.projectId }).from(monitoringBoards).where(eq(monitoringBoards.id, boardId)).limit(1);
    const [row] = await this.db.insert(monitors).values({
      tenantId, boardId,
      projectId: input.projectId ?? board?.projectId ?? null,
      label: input.label.slice(0, 255),
      description: input.description ?? null,
      posX: input.posX ?? 0.5, posY: input.posY ?? 0.5,
      monitorType: input.monitorType ?? 'webhook',
      config: (input.config ?? {}) as Record<string, unknown>,
      affectedSystem: input.affectedSystem ?? null,
      severity: input.severity ?? 'sev3',
      escalationPolicyId: input.escalationPolicyId ?? null,
      webhookSecret: newSecret(),
    }).returning();
    return row!;
  }

  /**
   * The board every self-hosted backend monitor lives on, created on first use.
   *
   * One board per workspace rather than one per project: a customer with six
   * projects deployed into their own cloud wants one page that answers "is any of
   * it down", and six boards holding one monitor each is a directory, not a view.
   */
  private async deployedBackendBoardId(tenantId: number): Promise<string> {
    const [existing] = await this.db
      .select({ id: monitoringBoards.id })
      .from(monitoringBoards)
      .where(and(eq(monitoringBoards.tenantId, tenantId), eq(monitoringBoards.name, DEPLOYED_BACKEND_BOARD)))
      .limit(1);
    if (existing) return existing.id;
    const board = await this.createBoard(tenantId, { name: DEPLOYED_BACKEND_BOARD });
    return board.id;
  }

  /**
   * Watch a backend that runs in the CUSTOMER's own cloud.
   *
   * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
   * A self-hosted strategy reports where it landed exactly once, at deploy time,
   * and nothing ever asks again. A CloudFormation stack deleted from the console,
   * a Cloud Run service scaled to zero revisions, an Azure app stopped for
   * billing — all three leave the platform showing a stale address as the place
   * to point provider webhooks at, and the first anyone hears of it is the
   * provider's retry log. That is a worse failure than the platform-hosted case
   * precisely because the thing that broke is somewhere we cannot see.
   *
   * ── WHY A MONITOR AND NOT A NEW SWEEP ─────────────────────────────────────
   * `runMonitorSweep` already evaluates `http_check` monitors every five minutes,
   * opens an incident on breach, pages on-call and dispatches triage. A second
   * sweep would be a second set of rules about what "down" means and who gets
   * woken up. The generated health route is a plain GET returning JSON, which is
   * exactly what an http_check consumes — so this is a row, not a mechanism.
   *
   * `bodyMatch` rather than status alone: a Function URL whose Lambda has been
   * deleted can still answer 200 from an edge, and a Cloud Run revision that
   * failed to start answers 503 through a load balancer that is itself healthy.
   * The generated engine only ever emits `"ok":true` when it is the thing
   * answering.
   *
   * Idempotent per project: a redeploy updates the URL in place rather than
   * accumulating one monitor per deployment.
   */
  async watchDeployedBackend(tenantId: number, input: {
    projectId: number;
    projectName: string;
    /** Origin the deployment reported, e.g. `https://acme-backend.example.workers.dev`. */
    deployedUrl: string;
    /** Path the generated engine serves its readiness on. */
    healthPath: string;
  }): Promise<void> {
    const url = `${input.deployedUrl.replace(/\/$/, '')}${input.healthPath}`;
    const config = { url, method: 'GET', bodyMatch: BACKEND_HEALTH_MARKER };

    const [existing] = await this.db
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(
        eq(monitors.tenantId, tenantId),
        eq(monitors.projectId, input.projectId),
        eq(monitors.affectedSystem, DEPLOYED_BACKEND_SYSTEM),
      ))
      .limit(1);

    if (existing) {
      // Re-activated as well as re-pointed: a project switched back to a
      // self-hosted strategy after a spell on the platform ingress must start
      // being watched again, and a monitor that stayed inactive would look
      // present and report nothing.
      await this.updateMonitor(tenantId, existing.id, { config, active: true });
      return;
    }

    await this.createMonitor(tenantId, await this.deployedBackendBoardId(tenantId), {
      label: `${input.projectName} — deployed backend`.slice(0, 255),
      description:
        'Generated by Builderforce when this project reported a self-hosted deployment. It asks the '
        + 'deployed backend\'s own readiness route whether it is answering. A breach means the address '
        + 'your providers are pointed at is not serving — check the deployment in your own cloud console.',
      monitorType: 'http_check',
      config,
      affectedSystem: DEPLOYED_BACKEND_SYSTEM,
      // A customer-facing backend that has stopped answering is not a sev3: every
      // webhook aimed at it is failing while it is down.
      severity: 'sev2',
      projectId: input.projectId,
    });
  }

  /**
   * Stop watching a project's deployed backend.
   *
   * Deactivated rather than deleted: the monitor carries its own breach history,
   * and a project that moves back to a self-hosted strategy should resume with
   * that history intact rather than as a fresh row with no past.
   */
  async unwatchDeployedBackend(tenantId: number, projectId: number): Promise<void> {
    await this.db
      .update(monitors)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(monitors.tenantId, tenantId),
        eq(monitors.projectId, projectId),
        eq(monitors.affectedSystem, DEPLOYED_BACKEND_SYSTEM),
      ));
  }

  async updateMonitor(tenantId: number, monitorId: string, patch: {
    label?: string; description?: string | null; posX?: number; posY?: number;
    monitorType?: MonitorType; config?: MonitorConfig; affectedSystem?: string | null;
    severity?: string; escalationPolicyId?: string | null; projectId?: number | null; active?: boolean;
  }): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['label', 'description', 'posX', 'posY', 'monitorType', 'affectedSystem', 'severity', 'escalationPolicyId', 'projectId', 'active'] as const) {
      if (patch[k] !== undefined) set[k] = patch[k];
    }
    if (patch.config !== undefined) set.config = patch.config as Record<string, unknown>;
    if (typeof patch.label === 'string') set.label = patch.label.slice(0, 255);
    await this.db.update(monitors).set(set).where(and(eq(monitors.id, monitorId), eq(monitors.tenantId, tenantId)));
  }

  async deleteMonitor(tenantId: number, monitorId: string): Promise<void> {
    await this.db.delete(monitors).where(and(eq(monitors.id, monitorId), eq(monitors.tenantId, tenantId)));
  }

  async getMonitor(tenantId: number, monitorId: string) {
    const [monitor] = await this.db.select().from(monitors)
      .where(and(eq(monitors.id, monitorId), eq(monitors.tenantId, tenantId))).limit(1);
    if (!monitor) return null;
    const events = await this.db.select().from(monitorEvents)
      .where(eq(monitorEvents.monitorId, monitorId)).orderBy(desc(monitorEvents.createdAt)).limit(100);
    return { monitor: toPublicMonitor(monitor), events };
  }

  /**
   * The signal webhook secret for a tenant-scoped monitor — used ONLY by the
   * manager-gated GET /monitors/:id to mint the signalUrl. Kept out of getMonitor so
   * the secret can never ride a MEMBER+ read.
   */
  async resolveSignalToken(tenantId: number, monitorId: string): Promise<string | null> {
    const [row] = await this.db.select({ webhookSecret: monitors.webhookSecret }).from(monitors)
      .where(and(eq(monitors.id, monitorId), eq(monitors.tenantId, tenantId))).limit(1);
    return row?.webhookSecret ?? null;
  }

  private async addEvent(tenantId: number, monitorId: string, e: { kind: string; status?: string | null; message?: string | null; incidentId?: string | null }): Promise<void> {
    await this.db.insert(monitorEvents).values({
      tenantId, monitorId, kind: e.kind, status: e.status ?? undefined, message: e.message ?? undefined, incidentId: e.incidentId ?? undefined,
    });
  }

  // ── Evaluation + breach/recovery ────────────────────────────────────────────

  /** Evaluate ONE monitor's current condition. 'skip' for signal-driven types. */
  async evaluateMonitor(monitor: MonitorRow, env: Env, now = new Date()): Promise<EvalResult> {
    const cfg = (monitor.config ?? {}) as MonitorConfig;
    switch (monitor.monitorType) {
      case 'heartbeat': {
        if (!monitor.lastSignalAt) return 'unknown';
        const intervalMs = Math.max(30, cfg.intervalSeconds ?? 300) * 1000;
        return now.getTime() - new Date(monitor.lastSignalAt).getTime() > intervalMs ? 'breach' : 'ok';
      }
      case 'http_check': {
        if (!cfg.url) return 'unknown';
        try {
          const method = (cfg.method ?? 'GET').toUpperCase();
          const headers = cfg.headers && Object.keys(cfg.headers).length ? cfg.headers : undefined;
          const res = await fetch(cfg.url, { method, redirect: 'follow', ...(headers ? { headers } : {}) });
          const okStatus = cfg.expectedStatus != null ? res.status === cfg.expectedStatus : res.ok;
          if (!okStatus) return 'breach';
          // Optional content assertion: the response body must contain a marker
          // (e.g. a health endpoint that returns 200 but reports "degraded").
          const wanted = cfg.bodyMatch?.trim();
          if (wanted) {
            const text = await res.text().catch(() => '');
            return text.includes(wanted) ? 'ok' : 'breach';
          }
          return 'ok';
        } catch { return 'breach'; }
      }
      case 'metric_threshold': {
        if (!cfg.metric || !cfg.comparator || cfg.threshold == null) return 'unknown';
        const { value } = await evaluateMetric(this.db, env, {
          tenantId: monitor.tenantId, metric: cfg.metric as EvaluateMetricArgs['metric'], scopeKind: monitor.projectId != null ? 'project' : 'tenant',
          projectId: monitor.projectId, windowDays: cfg.windowDays ?? 7,
        });
        if (value == null) return 'unknown';
        return comparatorMatches(value, cfg.comparator, cfg.threshold) ? 'breach' : 'ok';
      }
      default: return 'skip'; // webhook | manual — driven by recordSignal
    }
  }

  /** Apply an evaluation result: transition status and open/close the incident. */
  async applyResult(tenantId: number, monitor: MonitorRow, result: EvalResult, env: Env, message?: string): Promise<void> {
    if (result === 'skip') return;
    const now = new Date();
    await this.db.update(monitors).set({
      lastCheckedAt: now,
      consecutiveFailures: result === 'breach' ? monitor.consecutiveFailures + 1 : 0,
    }).where(eq(monitors.id, monitor.id));

    if (result === 'breach' && monitor.status !== 'breached') {
      await this.breach(tenantId, monitor, env, message ?? `Monitor "${monitor.label}" breached`);
    } else if (result === 'ok' && monitor.status === 'breached') {
      await this.recover(tenantId, monitor, message ?? `Monitor "${monitor.label}" recovered`);
    } else if (result === 'unknown' && monitor.status === 'unknown') {
      await this.addEvent(tenantId, monitor.id, { kind: 'check', status: 'unknown', message: message ?? null });
    }
  }

  /** Open the incident for a breached monitor (idempotent) + page + dispatch triage. */
  private async breach(tenantId: number, monitor: MonitorRow, env: Env, message: string): Promise<void> {
    // Idempotency: if a still-open incident is already linked, just note it.
    if (monitor.currentIncidentId) {
      const [open] = await this.db.select({ status: prodIncidents.status }).from(prodIncidents)
        .where(and(eq(prodIncidents.id, monitor.currentIncidentId), eq(prodIncidents.tenantId, tenantId))).limit(1);
      if (open && open.status !== 'resolved') {
        await this.addEvent(tenantId, monitor.id, { kind: 'breach', status: 'breached', message, incidentId: monitor.currentIncidentId });
        return;
      }
    }

    const incidents = new IncidentService(this.db);
    const incidentRef = await findTenantIncidentManagerRef(this.db, tenantId);
    const opened = await incidents.openIncident(tenantId, {
      title: `Monitor: ${monitor.label}`,
      description: `${message}\n\nOpened by monitor "${monitor.label}" (${monitor.monitorType}).`,
      severity: monitor.severity as 'sev1' | 'sev2' | 'sev3' | 'sev4',
      source: 'monitor',
      affectedSystem: monitor.affectedSystem ?? null,
      projectId: monitor.projectId ?? null,
      escalationPolicyId: monitor.escalationPolicyId ?? null,
      assignedAgentRef: incidentRef,
      actorRef: 'monitor',
    });

    await this.db.update(monitors).set({
      status: 'breached', currentIncidentId: opened.incidentId, lastStatusChangeAt: new Date(), updatedAt: new Date(),
    }).where(eq(monitors.id, monitor.id));
    await this.addEvent(tenantId, monitor.id, { kind: 'breach', status: 'breached', message, incidentId: opened.incidentId });

    // Fire any custom workflows listening for a monitor breach (best-effort — the
    // opened incident already fired incident-created; this is the monitor-scoped event
    // so a workflow can react to the alert itself, e.g. auto-remediate the system).
    try {
      await fireEventTriggers(this.db, {
        tenantId,
        eventType: 'monitor-breach',
        payload: {
          monitorId: monitor.id, label: monitor.label, monitorType: monitor.monitorType,
          severity: monitor.severity, affectedSystem: monitor.affectedSystem ?? null,
          incidentId: opened.incidentId, message,
        },
        sourceMonitorId: monitor.id,
        sourceIncidentId: opened.incidentId,
        match: { severity: monitor.severity, affectedSystem: monitor.affectedSystem ?? null, monitorType: monitor.monitorType },
      });
    } catch (error) { /* event-trigger dispatch is best-effort */ 
      reportCaughtError(error, { source: "application/monitoring/MonitoringService.ts", operation: "breach" });
    }

    // Page on-call + dispatch the Incident Manager to triage (best-effort).
    if (opened.created) {
      await new EscalationService(this.db).pageInitial(env, tenantId, opened.incidentId).catch((error) => {
        reportCaughtError(error, { source: "application/monitoring/MonitoringService.ts", operation: "breach" });
      });
      const detail = await incidents.getIncident(tenantId, opened.incidentId);
      await dispatchIncidentTriage(env, this.db, {
        tenantId, incidentId: opened.incidentId, boardTaskId: detail?.incident.boardTaskId ?? null, incidentRef,
      }).catch((error) => {
        reportCaughtError(error, { source: "application/monitoring/MonitoringService.ts", operation: "breach" });
      });
    }
  }

  /** Monitor recovered: flip to ok, note the (still-open) incident, unlink it. */
  private async recover(tenantId: number, monitor: MonitorRow, message: string): Promise<void> {
    if (monitor.currentIncidentId) {
      const [open] = await this.db.select({ status: prodIncidents.status }).from(prodIncidents)
        .where(and(eq(prodIncidents.id, monitor.currentIncidentId), eq(prodIncidents.tenantId, tenantId))).limit(1);
      if (open && open.status !== 'resolved') {
        await this.db.insert(incidentEvents).values({
          tenantId, incidentId: monitor.currentIncidentId, kind: 'note', actorRef: 'monitor',
          message: `${message} — monitor "${monitor.label}" is healthy again (incident left open for review/RCA).`,
        });
      }
    }
    await this.db.update(monitors).set({
      status: 'ok', currentIncidentId: null, lastStatusChangeAt: new Date(), consecutiveFailures: 0, updatedAt: new Date(),
    }).where(eq(monitors.id, monitor.id));
    await this.addEvent(tenantId, monitor.id, { kind: 'recovery', status: 'ok', message });
  }

  /**
   * External signal (webhook / heartbeat ping / manual test). status 'ok' refreshes the
   * heartbeat + recovers; 'breach' breaches. When a numeric `value` is given and the
   * monitor has a comparator/threshold, the value is evaluated. Tenant-scoped.
   */
  async recordSignal(tenantId: number, monitorId: string, signal: { status?: 'ok' | 'breach'; value?: number; message?: string | null }, env: Env): Promise<{ status: MonitorStatus }> {
    const [monitor] = await this.db.select().from(monitors)
      .where(and(eq(monitors.id, monitorId), eq(monitors.tenantId, tenantId))).limit(1);
    if (!monitor) throw new Error('Monitor not found in workspace');

    const now = new Date();
    await this.db.update(monitors).set({ lastSignalAt: now, updatedAt: now }).where(eq(monitors.id, monitorId));
    await this.addEvent(tenantId, monitorId, { kind: 'signal', status: signal.status ?? null, message: signal.message ?? null });

    let result: EvalResult;
    const cfg = (monitor.config ?? {}) as MonitorConfig;
    if (signal.status) {
      result = signal.status === 'breach' ? 'breach' : 'ok';
    } else if (signal.value != null && cfg.comparator && cfg.threshold != null) {
      result = comparatorMatches(signal.value, cfg.comparator, cfg.threshold) ? 'breach' : 'ok';
    } else {
      result = 'ok'; // a bare heartbeat ping = healthy
    }
    await this.applyResult(tenantId, { ...monitor, lastSignalAt: now }, result, env, signal.message ?? undefined);
    const [after] = await this.db.select({ status: monitors.status }).from(monitors).where(eq(monitors.id, monitorId)).limit(1);
    return { status: (after?.status ?? 'unknown') as MonitorStatus };
  }

  /** Resolve a monitor's webhook secret by id (for the unauthenticated signal route). */
  async monitorForSignal(monitorId: string): Promise<{ id: string; tenantId: number; webhookSecret: string | null } | null> {
    const [row] = await this.db.select({ id: monitors.id, tenantId: monitors.tenantId, webhookSecret: monitors.webhookSecret })
      .from(monitors).where(eq(monitors.id, monitorId)).limit(1);
    return row ?? null;
  }

  // ── Reporting ────────────────────────────────────────────────────────────

  /** Incident + monitor rollup for the reporting view. */
  async getReport(tenantId: number) {
    const monitorStatus = await this.db
      .select({ status: monitors.status, n: sql<number>`count(*)::int` })
      .from(monitors).where(eq(monitors.tenantId, tenantId)).groupBy(monitors.status);
    let mTotal = 0, mOk = 0, mBreached = 0, mUnknown = 0;
    for (const r of monitorStatus) {
      mTotal += r.n;
      if (r.status === 'ok') mOk = r.n;
      else if (r.status === 'breached') mBreached = r.n;
      else mUnknown += r.n;
    }
    const monitorRollup = { total: mTotal, ok: mOk, breached: mBreached, unknown: mUnknown };

    const incs = await this.db.select({
      id: prodIncidents.id, title: prodIncidents.title, severity: prodIncidents.severity, status: prodIncidents.status,
      affectedSystem: prodIncidents.affectedSystem, startedAt: prodIncidents.startedAt, resolvedAt: prodIncidents.resolvedAt, source: prodIncidents.source,
    }).from(prodIncidents).where(eq(prodIncidents.tenantId, tenantId)).orderBy(desc(prodIncidents.startedAt)).limit(500);

    const bySeverity: Record<string, number> = {};
    const bySystem: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let open = 0;
    const mttrs: number[] = [];
    for (const i of incs) {
      if (i.status !== 'resolved') open += 1;
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
      const sys = i.affectedSystem ?? 'Unclassified';
      bySystem[sys] = (bySystem[sys] ?? 0) + 1;
      bySource[i.source] = (bySource[i.source] ?? 0) + 1;
      if (i.resolvedAt) mttrs.push((new Date(i.resolvedAt).getTime() - new Date(i.startedAt).getTime()) / 60_000);
    }
    const mttrMinutes = mttrs.length ? Math.round(mttrs.reduce((a, b) => a + b, 0) / mttrs.length) : null;

    return {
      monitors: monitorRollup,
      incidents: {
        total: incs.length, open, bySeverity, bySystem, bySource, mttrMinutes,
        recent: incs.slice(0, 10),
      },
    };
  }
}
