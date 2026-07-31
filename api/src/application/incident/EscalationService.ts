/**
 * EscalationService — timed escalation policies and the engine that pages the next
 * tier when an incident goes unacknowledged.
 *
 * A policy matches incidents (optionally by severity) and owns ordered levels. Each
 * level fires at `afterMinutes` past the incident start, paging its target (an on-call
 * rotation, a specific user, a business contact, or a war-room note) through the
 * enabled channels — until someone acknowledges or resolves the incident.
 *
 * pageInitial() fires level 1 the moment an incident opens; runEscalationSweep drives
 * evaluateIncident() on the frequent cron tick to fire later levels as their timers
 * elapse. Both funnel through pageLevel() → incidentNotifier, so paging is DRY.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { escalationPolicies, escalationLevels, prodIncidents, incidentEvents } from '../../infrastructure/database/schema';
import { OnCallService } from './OnCallService';
import { notifyIncident, type IncidentSummary } from './incidentNotifier';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

type LevelRow = typeof escalationLevels.$inferSelect;

export class EscalationService {
  private readonly onCall: OnCallService;
  constructor(private readonly db: Db) {
    this.onCall = new OnCallService(db);
  }

  // ── Policy / level CRUD ────────────────────────────────────────────────────
  async createPolicy(tenantId: number, input: { name: string; description?: string | null; matchSeverity?: string | null; projectId?: number | null }) {
    const [row] = await this.db.insert(escalationPolicies).values({
      tenantId, name: input.name.slice(0, 255), description: input.description ?? undefined,
      matchSeverity: input.matchSeverity ?? undefined, projectId: input.projectId ?? undefined,
    }).returning();
    return row!;
  }

  async listPolicies(tenantId: number) {
    const policies = await this.db.select().from(escalationPolicies)
      .where(eq(escalationPolicies.tenantId, tenantId)).orderBy(asc(escalationPolicies.name));
    const out = [];
    for (const p of policies) {
      const levels = await this.db.select().from(escalationLevels)
        .where(eq(escalationLevels.policyId, p.id)).orderBy(asc(escalationLevels.level));
      out.push({ ...p, levels });
    }
    return out;
  }

  private async ownedPolicy(tenantId: number, policyId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: escalationPolicies.id }).from(escalationPolicies)
      .where(and(eq(escalationPolicies.id, policyId), eq(escalationPolicies.tenantId, tenantId))).limit(1);
    return !!row;
  }

  async addLevel(tenantId: number, policyId: string, input: { level?: number; afterMinutes: number; targetKind?: string; targetRef?: string | null; notifyTeams?: boolean; notifySlack?: boolean; notifyEmail?: boolean }) {
    if (!(await this.ownedPolicy(tenantId, policyId))) throw new Error('Policy not found in workspace');
    const existing = await this.db.select({ level: escalationLevels.level }).from(escalationLevels).where(eq(escalationLevels.policyId, policyId));
    const [row] = await this.db.insert(escalationLevels).values({
      tenantId, policyId,
      level: input.level ?? existing.length + 1,
      afterMinutes: input.afterMinutes,
      targetKind: input.targetKind ?? 'oncall_rotation',
      targetRef: input.targetRef ?? undefined,
      notifyTeams: input.notifyTeams ?? true,
      notifySlack: input.notifySlack ?? true,
      notifyEmail: input.notifyEmail ?? true,
    }).returning();
    return row!;
  }

  async deleteLevel(tenantId: number, levelId: string): Promise<void> {
    await this.db.delete(escalationLevels).where(and(eq(escalationLevels.id, levelId), eq(escalationLevels.tenantId, tenantId)));
  }

  async deletePolicy(tenantId: number, policyId: string): Promise<void> {
    await this.db.delete(escalationPolicies).where(and(eq(escalationPolicies.id, policyId), eq(escalationPolicies.tenantId, tenantId)));
  }

  // ── Paging engine ──────────────────────────────────────────────────────────

  /** Resolve the escalation policy for an incident: its pinned policy, else the
   *  tenant's active policy matching the incident severity (or any-severity). */
  private async resolvePolicy(tenantId: number, incident: { escalationPolicyId: string | null; severity: string }): Promise<{ policyId: string; levels: LevelRow[] } | null> {
    let policyId = incident.escalationPolicyId;
    if (!policyId) {
      const [p] = await this.db.select({ id: escalationPolicies.id }).from(escalationPolicies)
        .where(and(
          eq(escalationPolicies.tenantId, tenantId),
          eq(escalationPolicies.active, true),
          sql`(${escalationPolicies.matchSeverity} IS NULL OR ${escalationPolicies.matchSeverity} = ${incident.severity})`,
        ))
        .orderBy(desc(escalationPolicies.matchSeverity)) // a severity-specific match sorts before the NULL catch-all
        .limit(1);
      policyId = p?.id ?? null;
    }
    if (!policyId) return null;
    const levels = await this.db.select().from(escalationLevels)
      .where(eq(escalationLevels.policyId, policyId)).orderBy(asc(escalationLevels.level));
    return { policyId, levels };
  }

  /** Expand a level's target into assignee-encoded member refs to page. */
  private async targetMemberRefs(tenantId: number, level: LevelRow): Promise<string[]> {
    if (!level.targetRef && level.targetKind !== 'team_chat') return [];
    switch (level.targetKind) {
      case 'oncall_rotation': return (await this.onCall.resolveOnCall(tenantId, level.targetRef!)).map((m) => m.memberRef);
      case 'user':            return [`u:${level.targetRef}`];
      case 'contact':         return [`contact:${level.targetRef}`];
      case 'team_chat':       return []; // war-room note only (no external recipient)
      default:                return [];
    }
  }

  /** Page one escalation level for an incident + record the escalation on the record. */
  private async pageLevel(env: Env, tenantId: number, incident: IncidentSummary & { escalationPolicyId: string | null }, level: LevelRow, note: string): Promise<void> {
    const memberRefs = await this.targetMemberRefs(tenantId, level);
    await notifyIncident(env, this.db, {
      tenantId, incident, memberRefs, level: level.level,
      notifyTeams: level.notifyTeams, notifySlack: level.notifySlack, notifyEmail: level.notifyEmail, note,
    });

    // On-call AGENT members ('c:<ref>') have no external notification channel — page
    // them by ENGAGING the agent: dispatch an incident-triage run against the bridged
    // ticket assigned to that agent. dispatchIncidentTriage guards against double-
    // dispatch, so this no-ops when the ticket is already being worked (e.g. the
    // Incident Manager the open-time dispatch already engaged). Best-effort; recorded.
    const agentRefs = [...new Set(memberRefs.filter((r) => r.startsWith('c:')).map((r) => r.slice(2)).filter(Boolean))];
    if (agentRefs.length) {
      const [row] = await this.db.select({ boardTaskId: prodIncidents.boardTaskId })
        .from(prodIncidents).where(and(eq(prodIncidents.id, incident.id), eq(prodIncidents.tenantId, tenantId))).limit(1);
      if (row?.boardTaskId != null) {
        const { dispatchIncidentTriage } = await import('./incidentDispatch');
        for (const agentRef of agentRefs) {
          const dispatched = await dispatchIncidentTriage(env, this.db, {
            tenantId, incidentId: incident.id, boardTaskId: row.boardTaskId, incidentRef: agentRef,
          });
          await this.db.insert(incidentEvents).values({
            tenantId, incidentId: incident.id, kind: 'notified', actorRef: 'system',
            channel: 'agent', target: agentRef.slice(0, 255), level: level.level,
            message: dispatched ? 'Dispatched on-call agent to triage' : 'On-call agent already engaged',
          });
          if (dispatched) break; // one triage run per page; the rest are recorded as engaged
        }
      }
    }
    await this.db.update(prodIncidents).set({
      escalationLevel: level.level,
      escalationPolicyId: incident.escalationPolicyId ?? undefined,
      lastEscalatedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(prodIncidents.id, incident.id));
    await this.db.insert(incidentEvents).values({
      tenantId, incidentId: incident.id, kind: 'escalated', actorRef: 'system', level: level.level,
      message: `Escalated to L${level.level} (${level.targetKind})`,
    });
  }

  /** Fire the first escalation level the moment an incident opens (initial page).
   *  With no policy, pages the global channels + managers directly. */
  async pageInitial(env: Env, tenantId: number, incidentId: string): Promise<void> {
    const [inc] = await this.db.select().from(prodIncidents)
      .where(and(eq(prodIncidents.id, incidentId), eq(prodIncidents.tenantId, tenantId))).limit(1);
    if (!inc || inc.status === 'resolved') return;
    const summary: IncidentSummary & { escalationPolicyId: string | null } = {
      id: inc.id, title: inc.title, severity: inc.severity, status: inc.status,
      affectedSystem: inc.affectedSystem ?? null, escalationPolicyId: inc.escalationPolicyId ?? null,
    };
    const resolved = await this.resolvePolicy(tenantId, summary);
    if (resolved?.levels.length) {
      summary.escalationPolicyId = resolved.policyId;
      await this.pageLevel(env, tenantId, summary, resolved.levels[0]!, 'Initial page');
    } else {
      // No policy — hit the global channels + managers so the page is never dropped.
      await notifyIncident(env, this.db, { tenantId, incident: summary, memberRefs: [], level: 0, note: 'Initial page (no escalation policy configured)' });
      await this.db.update(prodIncidents).set({ escalationLevel: 1, lastEscalatedAt: new Date(), updatedAt: new Date() }).where(eq(prodIncidents.id, incidentId));
    }
  }

  /** Sweep step: if an incident is still unacknowledged and a not-yet-fired level's
   *  timer has elapsed, fire the next due level. Returns true when it escalated. */
  async evaluateIncident(env: Env, tenantId: number, inc: typeof prodIncidents.$inferSelect): Promise<boolean> {
    if (inc.status === 'resolved' || inc.status === 'acknowledged' || inc.status === 'mitigated') return false;
    const summary: IncidentSummary & { escalationPolicyId: string | null } = {
      id: inc.id, title: inc.title, severity: inc.severity, status: inc.status,
      affectedSystem: inc.affectedSystem ?? null, escalationPolicyId: inc.escalationPolicyId ?? null,
    };
    const resolved = await this.resolvePolicy(tenantId, summary);
    if (!resolved?.levels.length) return false;
    summary.escalationPolicyId = resolved.policyId;

    const elapsedMin = (Date.now() - new Date(inc.startedAt).getTime()) / 60_000;
    // The next level above the one already reached whose timer has elapsed.
    const due = resolved.levels.find((l) => l.level > inc.escalationLevel && l.afterMinutes <= elapsedMin);
    if (!due) return false;
    await this.pageLevel(env, tenantId, summary, due, `Escalation L${due.level} — unacknowledged for ${Math.round(elapsedMin)}m`);
    return true;
  }
}
