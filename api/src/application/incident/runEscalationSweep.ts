import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * runEscalationSweep — the frequent-tick cron that drives time-based escalation.
 *
 * For every still-open (unacknowledged) incident across all tenants, ask
 * EscalationService whether a not-yet-fired escalation level's timer has elapsed and,
 * if so, page the next tier. Acknowledged / mitigated / resolved incidents are skipped
 * (acknowledging an incident is what stops the pages). No-op when nothing is open.
 *
 * It also keeps the KV-gated cron tick open WHILE an unacknowledged incident still has a further
 * level to fire and that level is due within the floor interval, so a 15-minute page is not left
 * waiting for the 30-minute floor. Once the ladder is exhausted nothing is signalled: an incident
 * nobody acknowledges for days must not hold Neon awake for days.
 */
import { eq } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { prodIncidents } from '../../infrastructure/database/schema';
import { EscalationService } from './EscalationService';
import { floorIntervalMs, signalPendingWorkIfDueWithin } from '../runtime/cronWorkSignal';
import type { Env } from '../../env';

export interface EscalationSweepResult {
  openIncidents: number;
  escalated: number;
  /** Earliest epoch-ms a further level is due across the open incidents, or null when every
   *  ladder is exhausted (or no open incident has a policy). */
  nextLevelDueAtMs: number | null;
}

export async function runEscalationSweep(env: Env, db: Db = buildDatabase(env)): Promise<EscalationSweepResult> {
  const svc = new EscalationService(db);
  const open = await db.select().from(prodIncidents).where(eq(prodIncidents.status, 'open')).limit(500);
  let escalated = 0;
  let nextLevelDueAtMs: number | null = null;
  for (const inc of open) {
    try {
      const outcome = await svc.evaluateIncident(env, inc.tenantId, inc);
      if (outcome.escalated) escalated += 1;
      if (outcome.nextLevelDueAtMs != null) {
        nextLevelDueAtMs = nextLevelDueAtMs == null ? outcome.nextLevelDueAtMs : Math.min(nextLevelDueAtMs, outcome.nextLevelDueAtMs);
      }
    } catch (err) {
      reportCaughtError(err, { source: "application/incident/runEscalationSweep.ts", operation: "runEscalationSweep", context: { logMessage: '[cron:escalation] incident', details: inc.id } });
    }
  }
  // A level further out than the floor interval is left to the floor sweep, which re-evaluates it.
  await signalPendingWorkIfDueWithin(env, nextLevelDueAtMs, Date.now(), floorIntervalMs(env));
  return { openIncidents: open.length, escalated, nextLevelDueAtMs };
}
