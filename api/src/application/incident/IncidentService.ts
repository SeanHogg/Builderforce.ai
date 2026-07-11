/**
 * IncidentService — the write + read path for incident management.
 *
 * Answers "where does an incident live" with a BRIDGE (the chosen data model):
 *   • prod_incidents (migration 0236, extended in 0325) is the system of record —
 *     severity, status, MTTR timestamps, escalation state, the war-room chat.
 *   • Each incident also mints a first-class INCIDENT board task (taskType='incident',
 *     migration 0325) so the Incident Manager agent works it with all the existing
 *     lane/dispatch machinery — the exact sibling of the Security agent's SECURITY
 *     task. task.incidentId ↔ prodIncidents.boardTaskId keep the two in lockstep.
 *
 * Reached from three surfaces, all DRY through this one service:
 *   1. the Incident Manager agent's `incidents.*` built-in MCP tools (any runtime);
 *   2. the ITSM poll fork (itsmIngest) when a Freshdesk/Freshservice ticket reads as
 *      an incident;
 *   3. the /api/incidents HTTP routes (manual open + the war-room UI).
 *
 * Notifications/escalation live in EscalationService + incidentNotifier — this service
 * only owns the incident record, its board task, its war room, and its timeline.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  prodIncidents,
  tasks as tasksTable,
  incidentEvents,
  brainChats,
  projects,
} from '../../infrastructure/database/schema';
import { TaskService } from '../task/TaskService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskType, TaskPriority } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';

/** sev1 (most severe) … sev4. */
export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
export type IncidentStatus = 'open' | 'acknowledged' | 'mitigated' | 'resolved';

/** Map an incident severity to the bridged board task's priority. */
const SEVERITY_PRIORITY: Record<IncidentSeverity, TaskPriority> = {
  sev1: TaskPriority.URGENT,
  sev2: TaskPriority.HIGH,
  sev3: TaskPriority.MEDIUM,
  sev4: TaskPriority.LOW,
};

/** Map an ITSM ticket priority word to an incident severity. */
export function priorityToSeverity(priority: string | null | undefined): IncidentSeverity {
  switch ((priority ?? '').toLowerCase()) {
    case 'urgent': case 'critical': return 'sev1';
    case 'high': return 'sev2';
    case 'low': return 'sev4';
    default: return 'sev3';
  }
}

/**
 * Best-effort heuristic: guess which system an incident pertains to from its text.
 * Only a first pass for the auto-ingest path; the Incident Manager agent refines it
 * via the `incidents.classify` tool. Returns null when nothing matches.
 */
const SYSTEM_KEYWORDS: Array<[string, RegExp]> = [
  ['Database', /\b(database|db|postgres|mysql|sql|query|deadlock)\b/i],
  ['Payments', /\b(payment|billing|invoice|stripe|charge|checkout|refund)\b/i],
  ['Authentication', /\b(auth|login|sign[- ]?in|password|sso|oauth|token|session)\b/i],
  ['Email', /\b(email|smtp|mailbox|inbox|deliverability|bounce)\b/i],
  ['Network', /\b(network|dns|vpn|latency|timeout|connectivity|firewall)\b/i],
  ['API', /\b(api|endpoint|webhook|integration|rate[- ]?limit|5\d\d error)\b/i],
  ['Storage', /\b(storage|disk|s3|bucket|upload|file)\b/i],
  ['Frontend', /\b(ui|frontend|page|browser|render|css|javascript)\b/i],
];
export function guessAffectedSystem(text: string | null | undefined): string | null {
  const s = String(text ?? '');
  for (const [name, re] of SYSTEM_KEYWORDS) if (re.test(s)) return name;
  return null;
}

export interface OpenIncidentInput {
  title: string;
  description?: string | null;
  severity?: IncidentSeverity;
  /** pagerduty|sentry|datadog|freshdesk|freshservice|manual|agent. */
  source?: string;
  externalRef?: string | null;
  externalUrl?: string | null;
  affectedSystem?: string | null;
  projectId?: number | null;
  assignedAgentRef?: string | null;
  escalationPolicyId?: string | null;
  /** Open the on-call war-room chat immediately. */
  openWarRoom?: boolean;
  actorRef?: string | null;
}

export interface OpenIncidentResult {
  incidentId: string;
  boardTaskId: number | null;
  warRoomChatId: number | null;
  created: boolean;
}

export class IncidentService {
  private readonly tasks: TaskService;

  constructor(private readonly db: Db) {
    this.tasks = new TaskService(new TaskRepository(db), new ProjectRepository(db));
  }

  /** Most-recently-updated project for the tenant (a home for the board task). */
  private async pickProject(tenantId: number, projectId?: number | null): Promise<number | null> {
    if (projectId != null) {
      const [row] = await this.db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1);
      if (row) return row.id;
    }
    const [row] = await this.db.select({ id: projects.id }).from(projects)
      .where(eq(projects.tenantId, tenantId)).orderBy(desc(projects.updatedAt)).limit(1);
    return row?.id ?? null;
  }

  /** Existing incident for a source+externalRef (idempotent re-ingest), or null. */
  private async findByExternal(tenantId: number, source: string, externalRef: string) {
    const [row] = await this.db.select().from(prodIncidents)
      .where(and(
        eq(prodIncidents.tenantId, tenantId),
        eq(prodIncidents.source, source),
        eq(prodIncidents.externalRef, externalRef),
      )).limit(1);
    return row ?? null;
  }

  /**
   * Open an incident: a prod_incidents record + a bridged INCIDENT board task +
   * optionally a war-room chat + a 'created' timeline event. Idempotent by
   * (source, externalRef): a re-open returns the existing incident (created:false).
   */
  async openIncident(tenantId: number, input: OpenIncidentInput): Promise<OpenIncidentResult> {
    const title = String(input.title || '').trim().slice(0, 255);
    if (!title) throw new Error('incident title is required');

    const source = input.source ?? 'manual';
    if (input.externalRef) {
      const existing = await this.findByExternal(tenantId, source, input.externalRef);
      if (existing) {
        return { incidentId: existing.id, boardTaskId: existing.boardTaskId ?? null, warRoomChatId: existing.warRoomChatId ?? null, created: false };
      }
    }

    const severity = input.severity ?? 'sev3';
    const affectedSystem = input.affectedSystem ?? guessAffectedSystem(`${title}\n${input.description ?? ''}`);
    const projectId = await this.pickProject(tenantId, input.projectId);

    const [incident] = await this.db.insert(prodIncidents).values({
      tenantId,
      projectId: projectId ?? undefined,
      title,
      severity,
      status: 'open',
      source,
      externalRef: input.externalRef ?? undefined,
      externalUrl: input.externalUrl ?? undefined,
      affectedSystem: affectedSystem ?? undefined,
      assignedAgentRef: input.assignedAgentRef ?? undefined,
      escalationPolicyId: input.escalationPolicyId ?? undefined,
      impact: input.description ?? undefined,
    }).returning();
    const incidentId = incident!.id;

    // Bridge: mint the INCIDENT board task in a project (skipped when the tenant has
    // no project — the incident record still stands on its own).
    let boardTaskId: number | null = null;
    if (projectId != null) {
      // The description carries the triage brief so the agent triages (not codes) this
      // incident regardless of how the run is dispatched — the explicit triage dispatch
      // (payload marker + steering) OR the always-on autonomous executor picking up an
      // agent-owned ticket. Mirrors the Security agent's anchor-task instruction.
      const brief = [
        `INCIDENT (incident \`${incidentId}\`, ${severity}) from ${source}. This is HELP-DESK TRIAGE, not a code change.`,
        input.description ? `\nSource ticket:\n${input.description}` : '',
        `\nWork out WHICH SYSTEM this pertains to and record it with incidents.classify; set an accurate severity with incidents.update; page whoever is on call with oncall.page; post what you find/do with incidents.add_note. Do NOT write code.`,
      ].join('');
      const created = await this.tasks.createTask({
        projectId,
        title: title.slice(0, 500),
        description: brief,
        priority: SEVERITY_PRIORITY[severity],
        taskType: TaskType.INCIDENT,
        assignedAgentRef: input.assignedAgentRef ?? undefined,
      }, tenantId);
      boardTaskId = Number(created.id);
      await this.db.update(tasksTable).set({
        incidentSeverity: severity,
        incidentStatus: 'triage',
        incidentSystem: affectedSystem ?? undefined,
        incidentId,
        updatedAt: new Date(),
      }).where(eq(tasksTable.id, boardTaskId));
      await this.db.update(prodIncidents).set({ boardTaskId, updatedAt: new Date() }).where(eq(prodIncidents.id, incidentId));
    }

    await this.addEvent(tenantId, incidentId, { kind: 'created', actorRef: input.actorRef ?? source, message: `Incident opened: ${title}` });
    if (affectedSystem) await this.addEvent(tenantId, incidentId, { kind: 'classified', actorRef: input.actorRef ?? source, message: `Affected system: ${affectedSystem}` });
    if (input.assignedAgentRef) await this.addEvent(tenantId, incidentId, { kind: 'assigned', actorRef: input.assignedAgentRef, message: 'Incident Manager assigned' });

    let warRoomChatId: number | null = null;
    if (input.openWarRoom) warRoomChatId = await this.ensureWarRoom(tenantId, incidentId, title, projectId);

    return { incidentId, boardTaskId, warRoomChatId, created: true };
  }

  /** Open (or return) the on-call war-room chat for an incident — a persisted Brain
   *  "incident" chat humans and agents both post into. */
  async ensureWarRoom(tenantId: number, incidentId: string, title?: string, projectId?: number | null): Promise<number> {
    const [inc] = await this.db.select({ id: prodIncidents.id, chatId: prodIncidents.warRoomChatId, title: prodIncidents.title, projectId: prodIncidents.projectId })
      .from(prodIncidents).where(and(eq(prodIncidents.id, incidentId), eq(prodIncidents.tenantId, tenantId))).limit(1);
    if (!inc) throw new Error('Incident not found in workspace');
    if (inc.chatId != null) return inc.chatId;

    const [chat] = await this.db.insert(brainChats).values({
      tenantId,
      projectId: (projectId ?? inc.projectId) ?? undefined,
      origin: 'incident',
      title: `War room — ${(title ?? inc.title).slice(0, 480)}`,
      visibility: 'shared',
    }).returning({ id: brainChats.id });
    const chatId = chat!.id;
    await this.db.update(prodIncidents).set({ warRoomChatId: chatId, updatedAt: new Date() }).where(eq(prodIncidents.id, incidentId));
    await this.addEvent(tenantId, incidentId, { kind: 'note', actorRef: 'system', message: 'On-call war room opened' });
    return chatId;
  }

  /** Set the classified affected system (agent's `incidents.classify`). */
  async classify(tenantId: number, incidentId: string, system: string, actorRef?: string | null): Promise<void> {
    const sys = String(system || '').trim().slice(0, 120);
    if (!sys) throw new Error('system is required');
    const [inc] = await this.db.update(prodIncidents)
      .set({ affectedSystem: sys, updatedAt: new Date() })
      .where(and(eq(prodIncidents.id, incidentId), eq(prodIncidents.tenantId, tenantId)))
      .returning({ boardTaskId: prodIncidents.boardTaskId });
    if (!inc) throw new Error('Incident not found in workspace');
    if (inc.boardTaskId != null) {
      await this.db.update(tasksTable).set({ incidentSystem: sys, updatedAt: new Date() }).where(eq(tasksTable.id, inc.boardTaskId));
    }
    await this.addEvent(tenantId, incidentId, { kind: 'classified', actorRef: actorRef ?? 'system', message: `Affected system: ${sys}` });
  }

  /** Patch severity/status/impact/rootCause; mirror status+severity onto the task. */
  async updateIncident(
    tenantId: number,
    incidentId: string,
    patch: { severity?: IncidentSeverity; status?: IncidentStatus; impact?: string | null; rootCause?: string | null; actorRef?: string | null },
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.severity) set.severity = patch.severity;
    if (patch.impact !== undefined) set.impact = patch.impact;
    if (patch.rootCause !== undefined) set.rootCause = patch.rootCause;
    if (patch.status) {
      set.status = patch.status;
      if (patch.status === 'acknowledged') set.acknowledgedAt = new Date();
      if (patch.status === 'resolved') set.resolvedAt = new Date();
    }
    const [inc] = await this.db.update(prodIncidents).set(set)
      .where(and(eq(prodIncidents.id, incidentId), eq(prodIncidents.tenantId, tenantId)))
      .returning({ boardTaskId: prodIncidents.boardTaskId });
    if (!inc) throw new Error('Incident not found in workspace');

    if (inc.boardTaskId != null && (patch.status || patch.severity)) {
      const tset: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.severity) { tset.incidentSeverity = patch.severity; tset.priority = SEVERITY_PRIORITY[patch.severity]; }
      if (patch.status) tset.incidentStatus = patch.status === 'open' ? 'triage' : patch.status === 'acknowledged' ? 'investigating' : patch.status;
      await this.db.update(tasksTable).set(tset).where(eq(tasksTable.id, inc.boardTaskId));
    }

    if (patch.status) {
      await this.addEvent(tenantId, incidentId, {
        kind: patch.status === 'resolved' ? 'resolved' : 'status_change',
        actorRef: patch.actorRef ?? 'system',
        message: `Status → ${patch.status}`,
      });
    }
  }

  /** Append one timeline / notification event. */
  async addEvent(
    tenantId: number,
    incidentId: string,
    event: { kind?: string; actorRef?: string | null; message?: string | null; channel?: string | null; target?: string | null; level?: number | null },
  ): Promise<void> {
    await this.db.insert(incidentEvents).values({
      tenantId,
      incidentId,
      kind: event.kind ?? 'note',
      actorRef: event.actorRef ?? undefined,
      message: event.message ?? undefined,
      channel: event.channel ?? undefined,
      target: event.target ?? undefined,
      level: event.level ?? undefined,
    });
  }

  /**
   * Fork target for itsmIngest: open an incident for a help-desk ticket that reads as
   * one. Idempotent by (source, externalRef). Returns null when the ticket is not an
   * incident type. `assignedAgentRef` (the tenant's Incident Manager) is stamped so
   * the board task is agent-owned.
   */
  async ingestFromTicket(
    tenantId: number,
    ticket: { source: string; externalRef: string; externalUrl?: string | null; title: string; body?: string | null; priority?: string | null; ticketType?: string | null },
    assignedAgentRef?: string | null,
  ): Promise<{ incidentId: string; created: boolean } | null> {
    const type = (ticket.ticketType ?? '').toLowerCase();
    const isIncident = /incident|problem|outage|major/.test(type) || /outage|down|not working|unavailable|critical/i.test(`${ticket.title} ${ticket.body ?? ''}`);
    if (!isIncident) return null;
    const res = await this.openIncident(tenantId, {
      title: ticket.title,
      description: ticket.body ?? null,
      severity: priorityToSeverity(ticket.priority),
      source: ticket.source,
      externalRef: ticket.externalRef,
      externalUrl: ticket.externalUrl ?? null,
      assignedAgentRef: assignedAgentRef ?? null,
      openWarRoom: false,
      actorRef: assignedAgentRef ?? ticket.source,
    });
    return { incidentId: res.incidentId, created: res.created };
  }

  /** Incidents for a tenant, newest first (optionally only the active ones). */
  async listIncidents(tenantId: number, opts: { activeOnly?: boolean; limit?: number } = {}) {
    const conds = [eq(prodIncidents.tenantId, tenantId)];
    if (opts.activeOnly) conds.push(sql`${prodIncidents.status} <> 'resolved'`);
    return this.db.select().from(prodIncidents)
      .where(and(...conds))
      .orderBy(desc(prodIncidents.startedAt))
      .limit(opts.limit ?? 50);
  }

  /** One incident + its timeline (the war-room / detail view). */
  async getIncident(tenantId: number, incidentId: string) {
    const [incident] = await this.db.select().from(prodIncidents)
      .where(and(eq(prodIncidents.id, incidentId), eq(prodIncidents.tenantId, tenantId))).limit(1);
    if (!incident) return null;
    const timeline = await this.db.select().from(incidentEvents)
      .where(eq(incidentEvents.incidentId, incidentId))
      .orderBy(desc(incidentEvents.createdAt))
      .limit(200);
    return { incident, timeline };
  }
}
