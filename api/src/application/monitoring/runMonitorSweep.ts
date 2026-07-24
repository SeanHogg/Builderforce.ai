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

/**
 * Evaluate up to this many monitors at once. A single slow http_check monitor
 * (network latency / timeout) must not serialize the whole tenant's sweep behind it,
 * but an unbounded fan-out could exhaust the Worker's subrequest budget — so cap it.
 */
const SWEEP_CONCURRENCY = 8;

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

  const evaluateOne = async (m: typeof active[number]): Promise<void> => {
    try {
      const result = await svc.evaluateMonitor(m, env, now);
      if (result === 'skip') return;
      // Counter mutation is safe: JS is single-threaded, so these run to completion
      // between awaits without interleaving mid-statement.
      out.evaluated += 1;
      if (result === 'breach' && m.status !== 'breached') out.breached += 1;
      if (result === 'ok' && m.status === 'breached') out.recovered += 1;
      await svc.applyResult(m.tenantId, m, result, env);
    } catch (err) {
      console.error('[cron:monitors] monitor', m.id, err);
    }
  };

  // Bounded-concurrency pool: N workers pull from a shared cursor until drained, so a
  // slow monitor only stalls its own worker, not the entire sweep.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < active.length) {
      const m = active[cursor++];
      if (m) await evaluateOne(m);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, active.length) }, worker));

  return out;
}
