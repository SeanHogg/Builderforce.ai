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
  prodIncidentImplicatedTasks,
  tasks as tasksTable,
  incidentEvents,
  brainChats,
  projects,
} from '../../infrastructure/database/schema';
import { TicketParticipantsService, type AccountabilityReport } from '../kanban/ticketParticipants';
import { TaskService } from '../task/TaskService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskType, TaskPriority, TaskStatus } from '../../domain/shared/types';
import { publishKnowledgeDoc } from '../knowledge/publishKnowledgeDoc';
import { recordIncidentLearning } from './incidentLearning';
import { fireEventTriggers } from '../workflow/eventTriggers';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

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

/**
 * Map an incident's lifecycle status to the bridged board task's LANE, so the kanban
 * column and the incident record never drift. The triage run itself holds the lane
 * (RuntimeService), so this is the single writer of the incident ticket's lane.
 */
const INCIDENT_STATUS_TO_LANE: Record<IncidentStatus, TaskStatus> = {
  open: TaskStatus.IN_PROGRESS,          // actively being triaged
  acknowledged: TaskStatus.IN_PROGRESS,  // acknowledged, investigation underway
  mitigated: TaskStatus.IN_REVIEW,       // mitigated, pending verification / RCA
  resolved: TaskStatus.DONE,             // closed out
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

/** Render a structured RCA / post-mortem markdown body from the incident + inputs. */
function buildRcaMarkdown(
  inc: { title: string; severity: string; affectedSystem: string | null; source: string; startedAt: Date; resolvedAt: Date | null; impact: string | null; externalUrl: string | null },
  input: { summary?: string | null; rootCause?: string | null; impact?: string | null; contributingFactors?: string | null; resolution?: string | null; whatWentWell?: string | null; whatWentWrong?: string | null },
  actionItems: Array<{ title: string; detail?: string | null }>,
): string {
  const started = new Date(inc.startedAt);
  const resolved = inc.resolvedAt ? new Date(inc.resolvedAt) : null;
  const mttrMin = resolved ? Math.round((resolved.getTime() - started.getTime()) / 60_000) : null;
  const lines = [
    `# RCA — ${inc.title}`,
    '',
    `| | |`,
    `|---|---|`,
    `| **Severity** | ${inc.severity} |`,
    `| **Affected system** | ${inc.affectedSystem ?? '—'} |`,
    `| **Source** | ${inc.source} |`,
    `| **Started** | ${started.toISOString()} |`,
    `| **Resolved** | ${resolved ? resolved.toISOString() : '—'} |`,
    `| **Time to resolve** | ${mttrMin != null ? `${mttrMin} min` : '—'} |`,
    inc.externalUrl ? `| **Source ticket** | ${inc.externalUrl} |` : '',
    '',
    `## Summary`,
    input.summary ?? '_—_',
    '',
    `## Impact`,
    input.impact ?? inc.impact ?? '_—_',
    '',
    `## Root cause`,
    input.rootCause ?? '_—_',
    '',
    `## Contributing factors`,
    input.contributingFactors ?? '_—_',
    '',
    `## Resolution`,
    input.resolution ?? '_—_',
    '',
    `## What went well`,
    input.whatWentWell ?? '_—_',
    '',
    `## What went wrong`,
    input.whatWentWrong ?? '_—_',
    '',
    `## Action items`,
    actionItems.length
      ? actionItems.map((a) => `- [ ] **${a.title}**${a.detail ? ` — ${a.detail}` : ''}`).join('\n')
      : '_None_',
  ];
  return lines.filter((l) => l !== '').join('\n');
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
        `\nFirst search the knowledge base with knowledge.search for prior similar incidents / known-errors. Work out WHICH SYSTEM this pertains to and record it with incidents.classify; set an accurate severity with incidents.update; page whoever is on call with oncall.page; post what you find/do with incidents.add_note. When resolved, publish an RCA with incidents.postmortem (root cause + action items). Do NOT write code.`,
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

    // Fire any custom workflows listening for a new incident (best-effort — a
    // workflow can automate the response: notify stakeholders, run a runbook, etc.).
    try {
      await fireEventTriggers(this.db, {
        tenantId,
        eventType: 'incident-created',
        payload: { incidentId, title, severity, source, affectedSystem: affectedSystem ?? null, projectId },
        sourceIncidentId: incidentId,
        match: { severity, affectedSystem: affectedSystem ?? null, incidentSource: source },
      });
    } catch { /* event-trigger dispatch is best-effort */ }

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
      .returning({ boardTaskId: prodIncidents.boardTaskId, severity: prodIncidents.severity, affectedSystem: prodIncidents.affectedSystem, source: prodIncidents.source });
    if (!inc) throw new Error('Incident not found in workspace');

    if (inc.boardTaskId != null && (patch.status || patch.severity)) {
      const tset: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.severity) { tset.incidentSeverity = patch.severity; tset.priority = SEVERITY_PRIORITY[patch.severity]; }
      if (patch.status) {
        tset.incidentStatus = patch.status === 'open' ? 'triage' : patch.status === 'acknowledged' ? 'investigating' : patch.status;
        // Mirror the incident status onto the board LANE so the kanban column tracks the
        // incident (the triage run no longer moves the lane itself — see RuntimeService).
        tset.status = INCIDENT_STATUS_TO_LANE[patch.status];
      }
      await this.db.update(tasksTable).set(tset).where(eq(tasksTable.id, inc.boardTaskId));
    }

    if (patch.status) {
      await this.addEvent(tenantId, incidentId, {
        kind: patch.status === 'resolved' ? 'resolved' : 'status_change',
        actorRef: patch.actorRef ?? 'system',
        message: `Status → ${patch.status}`,
      });

      // Fire custom workflows listening for a status transition (and, on resolve, the
      // dedicated incident-resolved event — e.g. auto-draft a post-mortem). Best-effort.
      const payload = { incidentId, status: patch.status, severity: inc.severity, affectedSystem: inc.affectedSystem, source: inc.source };
      const match = { severity: inc.severity, affectedSystem: inc.affectedSystem };
      try {
        await fireEventTriggers(this.db, { tenantId, eventType: 'incident-status-change', payload, sourceIncidentId: incidentId, match: { ...match, status: patch.status } });
        if (patch.status === 'resolved') {
          await fireEventTriggers(this.db, { tenantId, eventType: 'incident-resolved', payload, sourceIncidentId: incidentId, match });
        }
      } catch { /* event-trigger dispatch is best-effort */ }
    }
  }

  /**
   * Publish a post-incident review (RCA / lessons-learned) as a first-class, versioned
   * Knowledge article, file the action items as remediation tasks, and back-link the
   * incident to the doc. The learning half of incident management — reached by the
   * agent's `incidents.postmortem` tool on resolve and by the manual route.
   *
   * Returns the knowledge doc id + url + the remediation task ids so the caller can
   * ALSO feed the learning into Evermind (so the workforce stops repeating the cause).
   */
  async publishPostmortem(
    tenantId: number,
    incidentId: string,
    input: {
      summary?: string | null;
      rootCause?: string | null;
      impact?: string | null;
      contributingFactors?: string | null;
      resolution?: string | null;
      whatWentWell?: string | null;
      whatWentWrong?: string | null;
      actionItems?: Array<{ title: string; detail?: string | null }>;
      docType?: 'postmortem' | 'known_error';
      actorRef?: string | null;
    },
    env?: Env,
  ): Promise<{ docId: string; url: string; actionItemTaskIds: number[]; incidentTitle: string; affectedSystem: string | null }> {
    const [inc] = await this.db.select().from(prodIncidents)
      .where(and(eq(prodIncidents.id, incidentId), eq(prodIncidents.tenantId, tenantId))).limit(1);
    if (!inc) throw new Error('Incident not found in workspace');

    const rootCause = input.rootCause ?? inc.rootCause ?? null;
    const actionItems = (input.actionItems ?? []).filter((a) => a.title?.trim());
    const content = buildRcaMarkdown(inc, { ...input, rootCause }, actionItems);

    const docType = input.docType ?? 'postmortem';
    const { id: docId } = await publishKnowledgeDoc(this.db, env, {
      tenantId,
      projectId: inc.projectId ?? null,
      docType,
      title: `RCA: ${inc.title}`.slice(0, 255),
      summary: (input.summary ?? rootCause ?? inc.impact ?? `Post-incident review for ${inc.title}`)?.slice(0, 500) ?? null,
      content,
      tags: ['rca', 'incident', `incident:${incidentId}`, ...(inc.affectedSystem ? [inc.affectedSystem] : []), inc.severity],
      sourceIncidentId: incidentId,
      createdBy: null,
    });
    const url = `/knowledge/documents/${docId}`;

    // File the action items as remediation follow-up tasks, linked to the incident.
    const actionItemTaskIds: number[] = [];
    if (inc.projectId != null && actionItems.length) {
      for (const item of actionItems) {
        const task = await this.tasks.createTask({
          projectId: inc.projectId,
          title: `Remediation: ${item.title}`.slice(0, 500),
          description: `${item.detail ?? ''}\n\nFollow-up action item from the RCA for incident "${inc.title}" (${url}).`.trim(),
          priority: TaskPriority.HIGH,
          taskType: TaskType.TASK,
        }, tenantId);
        const taskId = Number(task.id);
        await this.db.update(tasksTable).set({ incidentId, updatedAt: new Date() }).where(eq(tasksTable.id, taskId));
        actionItemTaskIds.push(taskId);
      }
    }

    // Back-link the incident → the RCA doc; persist the confirmed root cause.
    await this.db.update(prodIncidents).set({
      postmortemUrl: url,
      rootCause: rootCause ?? undefined,
      updatedAt: new Date(),
    }).where(eq(prodIncidents.id, incidentId));

    await this.addEvent(tenantId, incidentId, {
      kind: 'note', actorRef: input.actorRef ?? 'agent',
      message: `Post-mortem published (${url})${actionItemTaskIds.length ? ` — ${actionItemTaskIds.length} remediation action item(s) filed` : ''}`,
    });

    // Feed the lesson into the project's Evermind so the workforce stops repeating the
    // cause (best-effort, project-scoped, never fails the post-mortem).
    const learned = await recordIncidentLearning(env, tenantId, {
      projectId: inc.projectId ?? null,
      title: inc.title,
      severity: inc.severity,
      affectedSystem: inc.affectedSystem ?? null,
      rootCause,
      whatWentWrong: input.whatWentWrong ?? null,
      resolution: input.resolution ?? null,
    });
    if (learned) await this.addEvent(tenantId, incidentId, { kind: 'note', actorRef: 'system', message: 'Lesson contributed to Evermind — the workforce will avoid repeating this cause' });

    return { docId, url, actionItemTaskIds, incidentTitle: inc.title, affectedSystem: inc.affectedSystem ?? null };
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

  /** Link a DELIVERY ticket implicated in this incident (PRD §5.10) — the change whose
   *  ship caused the regression, so RCA can pull its Accountability Report. Idempotent. */
  async linkImplicatedTask(tenantId: number, incidentId: string, args: { taskId: number; relation?: string; note?: string | null; createdBy?: string | null }): Promise<void> {
    await this.db
      .insert(prodIncidentImplicatedTasks)
      .values({ tenantId, incidentId, taskId: args.taskId, relation: args.relation ?? 'implicated', note: args.note ?? null, createdBy: args.createdBy ?? null })
      .onConflictDoUpdate({
        target: [prodIncidentImplicatedTasks.incidentId, prodIncidentImplicatedTasks.taskId],
        set: { relation: args.relation ?? 'implicated', note: args.note ?? null },
      });
  }

  async unlinkImplicatedTask(tenantId: number, incidentId: string, taskId: number): Promise<void> {
    await this.db.delete(prodIncidentImplicatedTasks).where(and(
      eq(prodIncidentImplicatedTasks.tenantId, tenantId),
      eq(prodIncidentImplicatedTasks.incidentId, incidentId),
      eq(prodIncidentImplicatedTasks.taskId, taskId),
    ));
  }

  /**
   * The implicated delivery tickets for an incident, EACH with its Accountability
   * Report — the RCA's concrete "was the process followed?" answer: which roles signed
   * off, with what evidence, and where the process was skipped/waived. Feeds the
   * postmortem view and process-improvement aggregation.
   */
  async listImplicatedTasks(env: Env, tenantId: number, incidentId: string): Promise<Array<{ taskId: number; title: string; status: string; relation: string; note: string | null; accountability: AccountabilityReport }>> {
    const rows = await this.db
      .select({ taskId: prodIncidentImplicatedTasks.taskId, relation: prodIncidentImplicatedTasks.relation, note: prodIncidentImplicatedTasks.note, title: tasksTable.title, status: tasksTable.status })
      .from(prodIncidentImplicatedTasks)
      .innerJoin(tasksTable, eq(tasksTable.id, prodIncidentImplicatedTasks.taskId))
      .where(and(eq(prodIncidentImplicatedTasks.tenantId, tenantId), eq(prodIncidentImplicatedTasks.incidentId, incidentId)));
    const participants = new TicketParticipantsService(this.db);
    return Promise.all(rows.map(async (r) => ({
      taskId: r.taskId, title: r.title, status: r.status, relation: r.relation, note: r.note,
      accountability: await participants.getAccountability(env, tenantId, r.taskId),
    })));
  }
}
