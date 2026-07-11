/**
 * runMonitorSweep — the frequent-tick (every 5 min) cron that evaluates sweep-driven
 * monitors: heartbeat staleness, HTTP checks, and metric thresholds. Webhook/manual
 * monitors are signal-driven and skipped here. A breach opens an incident + pages
 * on-call via MonitoringService.applyResult. Best-effort per monitor.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { monitors } from '../../infrastructure/database/schema';
import { MonitoringService } from './MonitoringService';
import type { Env } from '../../env';

const SWEEP_TYPES = ['heartbeat', 'http_check', 'metric_threshold'];

export interface MonitorSweepResult {
  evaluated: number;
  breached: number;
  recovered: number;
}

export async function runMonitorSweep(env: Env): Promise<MonitorSweepResult> {
  const db = buildDatabase(env);
  const svc = new MonitoringService(db);
  const active = await db.select().from(monitors)
    .where(and(eq(monitors.active, true), inArray(monitors.monitorType, SWEEP_TYPES)))
    .limit(1000);

  const out: MonitorSweepResult = { evaluated: 0, breached: 0, recovered: 0 };
  const now = new Date();
  for (const m of active) {
    try {
      const result = await svc.evaluateMonitor(m, env, now);
      if (result === 'skip') continue;
      out.evaluated += 1;
      if (result === 'breach' && m.status !== 'breached') out.breached += 1;
      if (result === 'ok' && m.status === 'breached') out.recovered += 1;
      await svc.applyResult(m.tenantId, m, result, env);
    } catch (err) {
      console.error('[cron:monitors] monitor', m.id, err);
    }
  }
  return out;
}
