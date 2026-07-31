import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * WorkDeltaService — the single, modality-agnostic path for turning "a chat turn
 * changed code" into VISIBLE work.
 *
 * The problem it solves: an operator "just starts typing" in any surface (VS Code,
 * web Brain, an MCP client, the CLI, a cloud agent) and code gets added — but until
 * now that landed with ZERO project visibility. This service records the change as a
 * classified delta (improvement | fix | bug) in the `work_deltas` provenance ledger
 * AND mints an associated ticket so the work shows up on the board. When the change
 * came from a Brain chat, the ticket is tied back to that conversation via the
 * existing chat↔ticket lineage (link_type='created').
 *
 * DRY: every surface reaches this through ONE built-in MCP tool (`tickets.from_delta`
 * in builtinMcpService) — the gateway advertises that tool to the web Brain, VS Code
 * and external MCP clients alike, and the cloud agent loop calls it too. There is no
 * per-client copy of this logic.
 *
 * The minted ticket is opened in the `in_review` lane: the code exists (it was just
 * written) but is not yet merged/deployed. The merge/deploy → ticket-complete wiring
 * (githubWebhookRoutes / repoRoutes finalize) flips it to Done once it ships.
 */
import { and, eq, sql } from 'drizzle-orm';
import { workDeltas, tasks as tasksTable, projects as projectsTable } from '../../infrastructure/database/schema';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { TaskService } from '../task/TaskService';
import { ProjectService } from '../project/ProjectService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { ChatTicketService } from '../brain/ChatTicketService';
import { recordActivity, resolveActorByRef } from '../activity/activityLog';
import { TaskPriority, TaskStatus } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export const DELTA_KINDS = ['improvement', 'fix', 'bug'] as const;
export type DeltaKind = (typeof DELTA_KINDS)[number];

/**
 * The always-on instruction every coding surface prepends to its system prompt so
 * ad-hoc "just start typing" work is never invisible. It reinforces the
 * `tickets.from_delta` tool description (which all modalities already inherit via the
 * shared gateway MCP catalog). Kept here as the single source so surfaces don't drift.
 */
export const DELTA_DIRECTIVE =
  'Work visibility: when your turn ADDS or CHANGES code that is not already tracked by an existing ticket, record it before you finish — call the `tickets.from_delta` tool (advertised as `builtin_tickets_from_delta`) with a one-line summary, the kind (improvement | fix | bug), and the files you touched. This opens a ticket so the change is visible on the board and completes automatically once merged and deployed. Record one delta per meaningful change; skip trivial no-op edits.';

export interface RecordDeltaInput {
  projectId: number;
  /** Short one-line title of what changed (becomes the ticket title). */
  summary: string;
  /** Longer description of the change (becomes the ticket body). */
  detail?: string | null;
  /** Classification; derived from summary+detail when omitted. */
  kind?: DeltaKind;
  /** Files the change touched (string[]) — provenance + insight surfaces. */
  files?: string[];
  /** Interaction surface: 'ide' | 'web' | 'mcp' | 'cli' | 'cloud'. */
  modality?: string;
  /** Brain chat that produced the change (ties the ticket to the conversation). */
  chatId?: number | null;
  /** Existing project ticket that already tracks this change. Reused, never duplicated. */
  taskId?: number | null;
  /** User id or agent ref that authored the turn. */
  createdBy?: string | null;
  /** Create+link a ticket for the delta (default true). When false, only the
   *  provenance row is written (e.g. a trivial edit not worth a board item). */
  createTicket?: boolean;
}

export interface RecordDeltaResult {
  deltaId: number;
  kind: DeltaKind;
  taskId: number | null;
  taskKey: string | null;
  /** True when the delta was attached to an already-existing project ticket. */
  deduped: boolean;
}

/** Match the same project + normalized-title idempotency contract as tasks.create. */
function normalizedTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function existingTaskForDelta(
  db: Db,
  tenantId: number,
  projectId: number,
  summary: string,
  taskId?: number | null,
): Promise<{ id: number; key: string } | null> {
  // Task titles are capped at 500 characters when created below, so compare the
  // same representation. Whitespace/case normalization mirrors tasks.create.
  const title = normalizedTitle(summary.slice(0, 500));
  const [row] = await db
    .select({ id: tasksTable.id, key: tasksTable.key })
    .from(tasksTable)
    .innerJoin(projectsTable, eq(projectsTable.id, tasksTable.projectId))
    .where(and(
      eq(tasksTable.projectId, projectId),
      eq(tasksTable.archived, false),
      eq(projectsTable.tenantId, tenantId),
      taskId != null
        ? eq(tasksTable.id, taskId)
        : sql`lower(regexp_replace(btrim(${tasksTable.title}), '[[:space:]]+', ' ', 'g')) = ${title}`,
    ))
    .limit(1);
  return row ? { id: Number(row.id), key: row.key } : null;
}

/**
 * Deterministic classifier: repair language → 'fix', defect language → 'bug',
 * everything else → 'improvement'. Callers usually pass an explicit `kind` (the
 * agent decides), so this is only the fallback — no LLM round-trip on the hot path.
 */
export function classifyDelta(summary: string, detail?: string | null): DeltaKind {
  const t = `${summary} ${detail ?? ''}`.toLowerCase();
  const defect = /\b(bug|broken|crash(e[ds])?|regression|throw(s|n)?|exception|null ?pointer|npe|stack ?trace|fail(s|ed|ing)?|error|incorrect|wrong|unexpected)\b/.test(t);
  if (defect) {
    const repaired = /\b(fix(ed|es)?|resolv(e|ed|es)|repair(ed)?|patch(ed)?|correct(ed)?|address(ed)?|handle[ds]?)\b/.test(t);
    return repaired ? 'fix' : 'bug';
  }
  return 'improvement';
}

/** A bug gets HIGH priority (something is broken); fixes/improvements MEDIUM. */
function priorityForKind(kind: DeltaKind): TaskPriority {
  return kind === 'bug' ? TaskPriority.HIGH : TaskPriority.MEDIUM;
}

export class WorkDeltaService {
  private readonly tasks: TaskService;
  private readonly projects: ProjectService;
  private readonly chatTickets: ChatTicketService;

  constructor(private readonly db: Db, private readonly env: Env) {
    const taskRepo = new TaskRepository(db);
    const projectRepo = new ProjectRepository(db);
    this.tasks = new TaskService(taskRepo, projectRepo);
    this.projects = new ProjectService(projectRepo);
    this.chatTickets = new ChatTicketService(db, env);
  }

  /**
   * Record a code delta and (by default) mint the associated ticket.
   * Tenant-scoped via the project ownership check inside TaskService.createTask.
   */
  async record(tenantId: number, userId: string | null, input: RecordDeltaInput): Promise<RecordDeltaResult> {
    const summary = input.summary.trim();
    if (!summary) throw new Error('summary is required');
    const kind: DeltaKind = input.kind && DELTA_KINDS.includes(input.kind)
      ? input.kind
      : classifyDelta(summary, input.detail);
    const files = Array.isArray(input.files) ? input.files.filter((f) => typeof f === 'string') : undefined;
    const createdBy = input.createdBy ?? userId ?? null;
    const modality = (input.modality ?? 'unknown').slice(0, 32);
    const seg = await resolveSegment(this.db, tenantId).catch(() => null);

    let taskId: number | null = null;
    let taskKey: string | null = null;
    let deduped = false;

    if (input.createTicket !== false) {
      // A chat may create/assign the ticket first and then record the code delta.
      // Reuse that ticket under the same idempotency rule as tasks.create instead
      // of minting a second task for the same work (the Brain/VSIX duplicate path).
      const existing = await existingTaskForDelta(this.db, tenantId, input.projectId, summary, input.taskId);
      if (input.taskId != null && !existing) {
        throw new Error(`taskId ${input.taskId} is not an active ticket in project ${input.projectId}`);
      }
      if (existing) {
        taskId = existing.id;
        taskKey = existing.key;
        deduped = true;
      } else {
        const bodyParts: string[] = [];
        if (input.detail) bodyParts.push(input.detail);
        if (files && files.length) bodyParts.push(`\n\nFiles touched:\n${files.map((f) => `- ${f}`).join('\n')}`);
        bodyParts.push(`\n\n_Auto-captured from a ${modality} chat delta (${kind})._`);
        // The change is already written — open it in review, pending merge/deploy.
        const created = await this.tasks.createTask({
          projectId: input.projectId,
          title: summary.slice(0, 500),
          description: bodyParts.join(''),
          priority: priorityForKind(kind),
        }, tenantId);
        taskId = Number(created.id);
        taskKey = created.key;
        // Place it in the review lane WITHOUT firing the lane's autonomous agent —
        // the work exists; it just needs to ship. Direct status write (no lifecycle
        // side-effects) keeps this off the auto-run path.
        await this.db.update(tasksTable).set({ status: TaskStatus.IN_REVIEW, updatedAt: new Date() }).where(eq(tasksTable.id, taskId));
      }

      // Tie the ticket back to the conversation. An existing ticket is linked,
      // while a ticket minted by this delta is marked as created by the chat.
      if (input.chatId != null) {
        await this.chatTickets
          .linkTicket(tenantId, input.chatId, userId, {
            kind: 'task', ref: String(taskId), linkType: deduped ? 'linked' : 'created', createdBy,
          })
          .catch((error) => { /* best-effort lineage; never fail the delta on a link error */ 
            reportCaughtError(error, { source: "application/delta/WorkDeltaService.ts", operation: "record" });
          });
      }
    }

    const [row] = await this.db.insert(workDeltas).values({
      tenantId,
      segmentId: seg ?? undefined,
      projectId: input.projectId,
      taskId: taskId ?? undefined,
      chatId: input.chatId ?? undefined,
      modality,
      kind,
      summary: summary.slice(0, 2000),
      detail: input.detail ?? undefined,
      files: files ?? undefined,
      createdBy: createdBy ?? undefined,
    }).returning({ id: workDeltas.id });

    // Unified audit stream: a code change, attributed to its author (human, hire,
    // or agent — resolved from the createdBy ref). Fully best-effort: a failure in
    // actor resolution or the audit write must never fail the delta.
    try {
      const actor = await resolveActorByRef(this.env, this.db, tenantId, createdBy);
      await recordActivity(this.env, this.db, {
        tenantId,
        segmentId: seg ?? null,
        projectId: input.projectId,
        actor,
        verb: 'code.changed',
        targetType: taskId != null ? 'task' : 'project',
        targetId: taskId ?? input.projectId,
        targetLabel: summary.slice(0, 300),
        summary: `${kind}: ${summary.slice(0, 200)}`,
        metadata: { kind, modality, files: files ?? [], deltaId: row!.id, taskKey },
      });
    } catch (error) { /* audit is best-effort — never fail the delta on it */ 
      reportCaughtError(error, { source: "application/delta/WorkDeltaService.ts", operation: "record" });
    }

    return { deltaId: row!.id, kind, taskId, taskKey, deduped };
  }
}
