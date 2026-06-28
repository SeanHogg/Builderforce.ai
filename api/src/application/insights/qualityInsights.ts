/**
 * LENS — "Quality" (the board-deck Quality slide): production reliability +
 * customer-support health that the existing lenses don't collect. Reads the new
 * collectors (prod_incidents, support_tickets, uptime_samples, migration 0236)
 * plus the existing qa_findings (defect aging) and produces:
 *
 *   - uptime % (avg daily sample, or 100 − incident downtime when no samples),
 *   - alerts count (is_alert_only incidents),
 *   - prod-incident count + MTTR hours (resolvedAt − startedAt) + monthly failure
 *     rate (incidents ÷ window-months),
 *   - support: total tickets, post-production bugs, distinct customers, tix-per-
 *     customer,
 *   - defect aging buckets (open qa_findings by age: 0-7 / 8-30 / 31-90 / 90+).
 *
 * Aggregation is pure ({@link summarizeQuality}) over already-fetched rows so it
 * is unit-testable without a DB; {@link computeQualityInsights} does the I/O.
 * Caching is owned by the route (mirrors aiImpactInsights / workforceMetrics).
 */

import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { prodIncidents, supportTickets, uptimeSamples, qaFindings } from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface IncidentRow {
  isAlertOnly: boolean;
  startedAt: Date;
  resolvedAt: Date | null;
}
export interface TicketRow {
  isBug: boolean;
  customerRef: string | null;
  openedAt: Date;
}
export interface UptimeRow { uptimePct: number; downtimeMinutes: number; }
export interface DefectRow { status: string | null; createdAt: Date; }

export interface DefectAgingBucket { bucket: string; count: number; }

export interface QualityInsights {
  windowDays: number;
  uptimePct: number | null;
  alertsCount: number;
  prodIncidents: {
    count: number;
    mttrHours: number | null;
    monthlyFailureRate: number;
  };
  postProductionBugs: number;
  support: {
    tickets: number;
    bugs: number;
    distinctCustomers: number;
    perCustomer: number | null;
  };
  defectAging: DefectAgingBucket[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Pure: assemble the Quality lens from already-fetched rows. `now` anchors the
 * aging buckets. Uptime prefers explicit samples; with none it falls back to
 * 100 − (incident downtime ÷ window) so the figure is never blank when incidents
 * exist. Defect aging counts only OPEN findings (a closed defect has no age).
 */
export function summarizeQuality(
  incidents: IncidentRow[],
  tickets: TicketRow[],
  uptime: UptimeRow[],
  defects: DefectRow[],
  windowDays: number,
  now: number,
): QualityInsights {
  const alerts = incidents.filter((i) => i.isAlertOnly);
  const realIncidents = incidents.filter((i) => !i.isAlertOnly);
  const incidentDurationsHrs = realIncidents
    .map((i) => ((i.resolvedAt ?? new Date(now)).getTime() - i.startedAt.getTime()) / HOUR_MS)
    .filter((h) => h >= 0);
  const mttr = realIncidents
    .filter((i) => i.resolvedAt != null)
    .map((i) => (i.resolvedAt!.getTime() - i.startedAt.getTime()) / HOUR_MS)
    .filter((h) => h >= 0);

  // Uptime: explicit daily samples first; else DERIVE from incident downtime
  // (the PagerDuty/Sentry incident stream gives real outage durations — an
  // ongoing incident counts downtime up to `now`). Uptime% = 100 − downtime/window.
  let uptimePct: number | null = null;
  if (uptime.length) {
    uptimePct = avg(uptime.map((u) => u.uptimePct));
  } else if (realIncidents.length) {
    const totalDowntimeHrs = incidentDurationsHrs.reduce((a, h) => a + h, 0);
    const windowHrs = windowDays * 24;
    uptimePct = windowHrs > 0 ? Math.round(Math.max(0, 100 - (totalDowntimeHrs / windowHrs) * 100) * 100) / 100 : null;
  }

  const bugs = tickets.filter((t) => t.isBug);
  const customers = new Set(tickets.map((t) => t.customerRef).filter((r): r is string => !!r));
  const months = Math.max(1, windowDays / 30);

  // Defect aging buckets over OPEN findings (qa_findings status vocabulary:
  // open | triaged | task_created | ignored | resolved — the first three are
  // still-open defects that have an age worth ranking).
  const OPEN_STATUSES = new Set(['open', 'triaged', 'task_created']);
  const open = defects.filter((d) => OPEN_STATUSES.has(d.status ?? 'open'));
  const buckets = [
    { bucket: '0-7d', lo: 0, hi: 7 },
    { bucket: '8-30d', lo: 8, hi: 30 },
    { bucket: '31-90d', lo: 31, hi: 90 },
    { bucket: '90d+', lo: 91, hi: Infinity },
  ];
  const defectAging: DefectAgingBucket[] = buckets.map((b) => ({
    bucket: b.bucket,
    count: open.filter((d) => {
      const ageDays = (now - d.createdAt.getTime()) / DAY_MS;
      return ageDays >= b.lo && ageDays <= b.hi;
    }).length,
  }));

  return {
    windowDays,
    uptimePct,
    alertsCount: alerts.length,
    prodIncidents: {
      count: realIncidents.length,
      mttrHours: avg(mttr),
      monthlyFailureRate: realIncidents.length / months,
    },
    postProductionBugs: bugs.length,
    support: {
      tickets: tickets.length,
      bugs: bugs.length,
      distinctCustomers: customers.size,
      perCustomer: customers.size ? tickets.length / customers.size : null,
    },
    defectAging,
  };
}

/** I/O: fetch the window and assemble the Quality lens. */
export async function computeQualityInsights(db: Db, tenantId: number, days: number): Promise<QualityInsights> {
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);

  const [incidents, tickets, uptime, defects] = await Promise.all([
    db.select({ isAlertOnly: prodIncidents.isAlertOnly, startedAt: prodIncidents.startedAt, resolvedAt: prodIncidents.resolvedAt })
      .from(prodIncidents)
      .where(and(eq(prodIncidents.tenantId, tenantId), gte(prodIncidents.startedAt, since))) as Promise<IncidentRow[]>,
    db.select({ isBug: supportTickets.isBug, customerRef: supportTickets.customerRef, openedAt: supportTickets.openedAt })
      .from(supportTickets)
      .where(and(eq(supportTickets.tenantId, tenantId), gte(supportTickets.openedAt, since))) as Promise<TicketRow[]>,
    db.select({ uptimePct: uptimeSamples.uptimePct, downtimeMinutes: uptimeSamples.downtimeMinutes })
      .from(uptimeSamples)
      .where(and(eq(uptimeSamples.tenantId, tenantId), gte(uptimeSamples.periodDay, since.toISOString().slice(0, 10)))) as Promise<UptimeRow[]>,
    db.select({ status: qaFindings.status, createdAt: qaFindings.createdAt })
      .from(qaFindings)
      .where(eq(qaFindings.tenantId, tenantId)) as Promise<DefectRow[]>,
  ]);

  return summarizeQuality(incidents, tickets, uptime, defects, days, now);
}
