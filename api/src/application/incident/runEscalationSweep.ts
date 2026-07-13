/**
 * runEscalationSweep — the frequent-tick cron that drives time-based escalation.
 *
 * For every still-open (unacknowledged) incident across all tenants, ask
 * EscalationService whether a not-yet-fired escalation level's timer has elapsed and,
 * if so, page the next tier. Acknowledged / mitigated / resolved incidents are skipped
 * (acknowledging an incident is what stops the pages). No-op when nothing is open.
 */
import { eq } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { prodIncidents } from '../../infrastructure/database/schema';
import { EscalationService } from './EscalationService';
import type { Env } from '../../env';

export interface EscalationSweepResult {
  openIncidents: number;
  escalated: number;
}

export async function runEscalationSweep(env: Env): Promise<EscalationSweepResult> {
  const db = buildDatabase(env);
  const svc = new EscalationService(db);
  const open = await db.select().from(prodIncidents).where(eq(prodIncidents.status, 'open')).limit(500);
  let escalated = 0;
  for (const inc of open) {
    try {
      if (await svc.evaluateIncident(env, inc.tenantId, inc)) escalated += 1;
    } catch (err) {
      console.error('[cron:escalation] incident', inc.id, err);
    }
  }
  return { openIncidents: open.length, escalated };
}
