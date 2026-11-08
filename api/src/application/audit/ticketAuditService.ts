import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Ticket role/diagnostic audit engine — pillar 1.
 *
 * Records role SIGN-OFFS as work happens, then computes per-ticket coverage: for
 * every REQUIRED role / diagnostic / review the ticket's lanes declare (up to and
 * including its current lane), was it satisfied? Any unmet required check flags the
 * ticket for review and records a manager 'flag' action — this is the Manager AI
 * agent's ticket-coverage diagnostic. The verdict is denormalised onto the task so
 * the board renders a flag chip cheaply.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  boards,
  swimlaneRequirements,
  swimlanes,
  tasks,
  ticketAudits,
  ticketRoleSignoffs,
  toolRuns,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { recordManagerAction } from '../manager/ManagerService';
import { computeCoverage, verdictSignature, type AuditSignals, type RequirementInput } from './auditRules';
import type { CoverageResult, UnmetRequirement } from './auditRules';
import { requirementApplies } from '../kanban/types';
import { hasNonDraftPr, loadTaskPrSignal } from '../kanban/taskPrSignal';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { isReviewRole } from '../kanban/roleCatalog';
import { loadRoleRoster, humanIsRoleCapable } from '../kanban/roleCapability';
import { publishSignoffToPr } from '../validation/publishReviewToPr';
import { authoredPrdRoleSections, findTaskPrimarySpec } from '../prd/taskPrd';

const flaggedKey = (tenantId: number) => `audit:flagged:${tenantId}`;

/** How long an unchanged verdict may go without its `computed_at` being refreshed. The
 *  manager pass re-audits the same tickets every few minutes; rewriting an identical
 *  row each time was ~1.45M writes on 953 rows. A day keeps "last audited" meaningful. */
const AUDIT_REFRESH_MS = 24 * 60 * 60_000;

export interface TicketAuditResult extends CoverageResult {
  taskId: number;
  boardId: string | null;
}

/** The verdict a role can record. `waived`/`delegated` require a reason and are
 *  role-capability gated at the route (they weaken the standard, so must be audited). */
export type SignoffVerdict = 'approved' | 'changes_requested' | 'waived' | 'delegated';

/** The verifiable work backing a sign-off — what makes it more than a rubber stamp. */
export interface SignoffContribution {
  executionId?: number;
  prdRevision?: number;
  prUrl?: string;
  diffFiles?: string[];
  reviewThreadRef?: string;
  toolRunId?: string;
  /**
   * True when the PLATFORM recorded this entry from a finished run rather than the member
   * recording a verdict of its own (see `attestRoleRun.ts`). Flagged rather than hidden:
   * an auto-attested producer credit is a legitimate accountability record, but a reader
   * auditing who actually judged the work must be able to tell the two apart, and
   * `getAccountability` must never count one as a considered review.
   */
  autoAttested?: boolean;
}

export interface SignoffInput {
  taskId: number;
  roleKey: string;
  laneKey?: string | null;
  memberKind?: string | null;
  memberRef?: string | null;
  memberName?: string | null;
  verdict?: SignoffVerdict;
  summary?: string | null;
  contribution?: SignoffContribution | null;
  waiveReason?: string | null;
  /**
   * Mirror a review-role verdict onto the PR (default true). The Validator bridge
   * (`kanban/validatorSlotBridge.ts`) passes false: `reviews.record` already posted the
   * review via `publishReviewToPr`, so the bridged sign-off must not post it again.
   */
  publishToPr?: boolean;
}

export class TicketAuditService {
  constructor(private readonly db: Db) {}

  /** Record a role sign-off (append-only accountability record), then recompute the
   *  ticket's audit. Returns the audit AND the new sign-off id so callers can link it
   *  to a manifest participant. */
  async recordSignoff(env: Env, tenantId: number, input: SignoffInput): Promise<TicketAuditResult & { signoffId: string }> {
    const signoffId = crypto.randomUUID();
    await this.db.insert(ticketRoleSignoffs).values({
      id: signoffId,
      tenantId,
      taskId: input.taskId,
      laneKey: input.laneKey ?? null,
      roleKey: input.roleKey,
      memberKind: input.memberKind ?? null,
      memberRef: input.memberRef ?? null,
      memberName: input.memberName ?? null,
      verdict: input.verdict ?? 'approved',
      summary: input.summary ?? null,
      contribution: input.contribution ?? null,
      waiveReason: input.waiveReason ?? null,
      createdAt: new Date(),
    });
    const audit = await this.computeAudit(env, tenantId, input.taskId);

    // Mirror the sign-off onto the ticket's pull request. A reviewer's verdict
    // that lives only in the sign-off ledger is invisible to whoever is deciding
    // whether to merge — which is the one moment it exists to inform. Only
    // REVIEW-shaped verdicts are published: an 'approved' from a role that merely
    // participated (e.g. the BA confirming scope) is accountability, not a code
    // review, and posting every role's sign-off would bury the ones that matter.
    //
    // Best-effort and after the ledger write, so GitHub can never cost us the record.
    if (input.publishToPr !== false && isReviewRole(input.roleKey)) {
      await publishSignoffToPr(env, this.db, tenantId, input.taskId, {
        roleKey: input.roleKey,
        verdict: input.verdict ?? 'approved',
        summary: input.summary ?? null,
        reviewerName: input.memberName ?? null,
      }).catch((error) => {
        reportCaughtError(error, { source: "application/audit/ticketAuditService.ts", operation: "recordSignoff" });
      });
    }

    return { ...audit, signoffId };
  }

  /**
   * Compute (and persist) the coverage audit for one ticket. Applicable
   * requirements = those on lanes at or before the ticket's current lane position.
   */
  async computeAudit(env: Env, tenantId: number, taskId: number): Promise<TicketAuditResult> {
    const [task] = await this.db
      .select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status, taskType: tasks.taskType, actionType: tasks.actionType })
      .from(tasks)
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
      .limit(1);
    if (!task) throw new Error('task not found');

    const board = await findCanonicalBoard(this.db, task.projectId, tenantId);
    // The `has_pr` predicate's input — resolved once for the whole requirement scan so
    // every lane's requirements agree about whether this ticket has a pull request.
    const hasPr = hasNonDraftPr(await loadTaskPrSignal(this.db, tenantId, taskId));

    let reqs: RequirementInput[] = [];
    if (board) {
      const laneRows = await this.db
        .select({ id: swimlanes.id, key: swimlanes.key, name: swimlanes.name, position: swimlanes.position })
        .from(swimlanes)
        .where(eq(swimlanes.boardId, board.id))
        .orderBy(asc(swimlanes.position));
      const currentLane = laneRows.find((l) => l.key === task.status);
      // Lanes the ticket has reached (position <= current). If the status matches no
      // lane, audit every lane so nothing silently escapes coverage.
      const applicable = currentLane ? laneRows.filter((l) => l.position <= currentLane.position) : laneRows;
      const laneById = new Map(applicable.map((l) => [l.id, l]));
      if (applicable.length) {
        const reqRows = await this.db
          .select()
          .from(swimlaneRequirements)
          .where(scopedToTenant(swimlaneRequirements, tenantId, inArray(swimlaneRequirements.swimlaneId, applicable.map((l) => l.id))));
        reqs = reqRows
          .filter((r) => laneById.has(r.swimlaneId))
          // Ticket-type / condition scoping: a requirement only counts for the ticket
          // types it applies to (a Security ticket requires the security role; a docs
          // ticket doesn't require QA). Shared with the manifest + gate for consistency.
          .filter((r) => requirementApplies({ ticketType: r.ticketType, condition: r.condition }, { taskType: task.taskType, actionType: task.actionType, hasPr }))
          .map((r): RequirementInput => {
            const lane = laneById.get(r.swimlaneId)!;
            return {
              laneKey: lane.key,
              laneName: lane.name,
              kind: r.kind as RequirementInput['kind'],
              ref: r.ref,
              responsibility: (r.responsibility as RequirementInput['responsibility']) ?? undefined,
              isRequired: r.isRequired,
              description: r.description ?? undefined,
              quorum: r.quorum,
            };
          });
      }
    }

    const signals = await this.gatherSignals(env, tenantId, task.projectId, taskId, reqs.map((r) => r.ref));
    const coverage = computeCoverage(reqs, signals);

    // Prior verdict, read BEFORE the upsert overwrites it — the flag journal below
    // is change-driven, not pass-driven.
    const [previous] = await this.db
      .select({
        status: ticketAudits.status, missing: ticketAudits.missing, coverage: ticketAudits.coverage,
        requiredCount: ticketAudits.requiredCount, satisfiedCount: ticketAudits.satisfiedCount,
        boardId: ticketAudits.boardId, computedAt: ticketAudits.computedAt,
      })
      .from(ticketAudits)
      .where(and(eq(ticketAudits.tenantId, tenantId), eq(ticketAudits.taskId, taskId)))
      .limit(1);

    const now = new Date();
    const boardId = board?.id ?? null;
    const missingJson = JSON.stringify(coverage.missing);
    // Compare BEFORE writing: an identical verdict is the common case, and the stored row
    // (and the denormalised task columns below) already say it.
    const rowChanged = !previous
      || previous.status !== coverage.status
      || Number(previous.coverage) !== Number(coverage.coverage)
      || previous.requiredCount !== coverage.requiredCount
      || previous.satisfiedCount !== coverage.satisfiedCount
      || previous.missing !== missingJson
      || (previous.boardId ?? null) !== boardId
      || !previous.computedAt
      || now.getTime() - new Date(previous.computedAt).getTime() > AUDIT_REFRESH_MS;

    if (rowChanged) {
      await this.db
        .insert(ticketAudits)
        .values({
          taskId,
          tenantId,
          boardId,
          status: coverage.status,
          coverage: coverage.coverage,
          requiredCount: coverage.requiredCount,
          satisfiedCount: coverage.satisfiedCount,
          missing: missingJson,
          computedAt: now,
        })
        .onConflictDoUpdate({
          target: ticketAudits.taskId,
          set: {
            boardId,
            status: coverage.status,
            coverage: coverage.coverage,
            requiredCount: coverage.requiredCount,
            satisfiedCount: coverage.satisfiedCount,
            missing: missingJson,
            computedAt: now,
          },
        });
    }

    // Written only when the ticket's denormalised verdict actually differs.
    await this.db
      .update(tasks)
      .set({ auditStatus: coverage.status, auditFlagCount: coverage.missing.length })
      .where(scopedToTenant(
        tasks, tenantId, eq(tasks.id, taskId),
        sql`(${tasks.auditStatus} IS DISTINCT FROM ${coverage.status} OR ${tasks.auditFlagCount} IS DISTINCT FROM ${coverage.missing.length})`,
      ));

    // Journal the flag only when the verdict actually changed (newly flagged, or the
    // set of unmet checks moved). An unchanged verdict is already visible on the
    // ticket + the flagged list — re-recording it every pass buries the feed.
    const previousSignature = previous
      ? verdictSignature(previous.status, safeParseMissing(previous.missing))
      : null;
    const changed = verdictSignature(coverage.status, coverage.missing) !== previousSignature;
    if (coverage.status === 'flagged' && changed) {
      await recordManagerAction(this.db, {
        tenantId,
        projectId: task.projectId,
        taskId,
        actionType: 'flag',
        summary: `Ticket audit: ${coverage.missing.length} required ${coverage.missing.length === 1 ? 'check' : 'checks'} unmet`,
        detail: { missing: coverage.missing },
      });
    }

    if (rowChanged) await invalidateCached(env, flaggedKey(tenantId));
    return { ...coverage, taskId, boardId };
  }

  /** Read the stored audit for a ticket (missing parsed). */
  async getAudit(_env: Env, tenantId: number, taskId: number): Promise<
    { status: string; coverage: number; requiredCount: number; satisfiedCount: number; missing: UnmetRequirement[] } | null
  > {
    const [row] = await this.db
      .select()
      .from(ticketAudits)
      .where(and(eq(ticketAudits.tenantId, tenantId), eq(ticketAudits.taskId, taskId)))
      .limit(1);
    if (!row) return null;
    return {
      status: row.status,
      coverage: row.coverage,
      requiredCount: row.requiredCount,
      satisfiedCount: row.satisfiedCount,
      missing: safeParseMissing(row.missing),
    };
  }

  /** Flagged tickets for the workspace (optionally one project). Cached. */
  async listFlagged(env: Env, tenantId: number, projectId?: number): Promise<
    Array<{ taskId: number; title: string; status: string; projectId: number; missing: UnmetRequirement[]; coverage: number }>
  > {
    const all = await getOrSetCached(env, flaggedKey(tenantId), async () => {
      const rows = await this.db
        .select({
          taskId: ticketAudits.taskId,
          coverage: ticketAudits.coverage,
          missing: ticketAudits.missing,
          title: tasks.title,
          status: tasks.status,
          projectId: tasks.projectId,
        })
        .from(ticketAudits)
        .innerJoin(tasks, eq(ticketAudits.taskId, tasks.id))
        .where(and(eq(ticketAudits.tenantId, tenantId), eq(ticketAudits.status, 'flagged')));
      return rows.map((r) => ({
        taskId: r.taskId, title: r.title, status: r.status, projectId: r.projectId,
        coverage: r.coverage, missing: safeParseMissing(r.missing),
      }));
    });
    return projectId ? all.filter((r) => r.projectId === projectId) : all;
  }

  /**
   * Build the audit's evidence signals for one ticket. Beyond the coarse role-key
   * sets, this resolves PER-ROLE verification inputs (PRD §5.6/§5.9):
   *  - `signedOffRoles` — which member refs actually signed off as each role (from the
   *    ledger), so the engine can re-check capability at read time, not only at write;
   *  - `roleCapableRefs` — which agents + humans are role-capable of each required role
   *    on this project, so a gap records who COULD have signed, and a backfilled or
   *    bug-written ledger row by a non-capable member does not satisfy the requirement.
   * Both are best-effort: a roster load failure degrades to the legacy membership-only
   * behaviour rather than failing the audit.
   */
  private async gatherSignals(
    env: Env,
    tenantId: number,
    projectId: number,
    taskId: number,
    requiredRoleKeys: string[],
  ): Promise<AuditSignals> {
    const [signoffs, diagnostics, prdRow] = await Promise.all([
      this.db
        .select({ roleKey: ticketRoleSignoffs.roleKey, verdict: ticketRoleSignoffs.verdict, memberKind: ticketRoleSignoffs.memberKind, memberRef: ticketRoleSignoffs.memberRef, createdAt: ticketRoleSignoffs.createdAt })
        .from(ticketRoleSignoffs)
        .where(eq(ticketRoleSignoffs.taskId, taskId))
        .orderBy(asc(ticketRoleSignoffs.createdAt)),
      this.db
        .select({ toolId: toolRuns.toolId, result: toolRuns.result, createdAt: toolRuns.createdAt })
        .from(toolRuns)
        .where(eq(toolRuns.taskId, taskId))
        .orderBy(asc(toolRuns.createdAt)),
      // The task's primary PRD, for the per-role SECTION-AUTHORED evidence. One
      // indexed lookup on a path that already issues two; null (no PRD yet) simply
      // contributes no roles, so nothing regresses on a ticket without one.
      findTaskPrimarySpec(this.db, taskId).catch(() => null),
    ]);

    // Latest verdict per role wins (append-only ledger; a later approval clears an
    // earlier changes-requested and vice-versa).
    const latest = new Map<string, string>();
    const performed = new Set<string>();
    // Per-role signer refs (PRD §5.9 Who): roleKey → the member refs that signed as it.
    // Drives the engine's capability re-check — a backfilled or bug-written ledger row
    // by a non-role-capable member must not satisfy the requirement.
    const signedOffRoles = new Map<string, Set<string>>();
    for (const s of signoffs) {
      latest.set(s.roleKey, s.verdict);
      performed.add(s.roleKey);
      const ref = s.memberRef?.trim();
      if (ref) {
        const set = signedOffRoles.get(s.roleKey) ?? new Set<string>();
        set.add(ref);
        signedOffRoles.set(s.roleKey, set);
      }
    }
    const approvedRoles = new Set<string>();
    const changesRequestedRoles = new Set<string>();
    for (const [role, verdict] of latest) {
      if (verdict === 'changes_requested') changesRequestedRoles.add(role);
      // 'delegated' = handed to another actor, not yet satisfied → leave unmet.
      else if (verdict === 'delegated') { /* still outstanding */ }
      // 'approved' and 'waived' (an audited, reasoned exception) both satisfy coverage.
      else approvedRoles.add(role);
    }

    // Diagnostic pass/fail: a tool's ToolResult carries an optional 0..5 `score`. The
    // LATEST run per tool decides — score present & below threshold ⇒ failed (does not
    // satisfy); score absent ⇒ satisfied-by-existence (legacy, backward-compatible).
    const ranDiagnostics = new Set<string>();
    const failedDiagnostics = new Set<string>();
    const latestScore = new Map<string, number | null>();
    for (const d of diagnostics) {
      ranDiagnostics.add(d.toolId);
      const score = d.result && typeof d.result === 'object' && 'score' in d.result ? (d.result as { score?: number | null }).score ?? null : null;
      latestScore.set(d.toolId, score); // ordered asc by createdAt ⇒ last write is latest
    }
    for (const [toolId, score] of latestScore) {
      if (score != null && score < DIAGNOSTIC_PASS_THRESHOLD) failedDiagnostics.add(toolId);
    }

    // Per-role capability map (PRD §5.9): roleKey → the member refs (agents + humans)
    // role-capable of acting AS that role on this project. Lets the engine re-check a
    // signer's capability at READ time and lets a gap record who COULD have signed.
    // Agent refs come from the one capability oracle; humans are checked per pin /
    // discipline. Best-effort: a failure here degrades to the legacy membership-only
    // rule (the maps stay empty ⇒ `hasCapableSigner` returns true).
    const roleCapableRefs = new Map<string, Set<string>>();
    if (requiredRoleKeys.length) {
      try {
        const roster = await loadRoleRoster(env, this.db, tenantId, projectId);
        const humanRefs = new Set<string>();
        for (const set of signedOffRoles.values()) for (const r of set) humanRefs.add(r);
        for (const roleKey of new Set(requiredRoleKeys)) {
          const capable = new Set<string>();
          for (const c of roster.candidates(roleKey)) capable.add(c.ref);
          // A human signer counts as capable when pinned or discipline-matched — checked
          // per human ref that actually signed (bounded by the ledger, not the user table).
          for (const ref of humanRefs) {
            if (capable.has(ref)) continue;
            if (await humanIsRoleCapable(this.db, tenantId, ref, roleKey, projectId)) capable.add(ref);
          }
          if (capable.size) roleCapableRefs.set(roleKey, capable);
        }
      } catch (error) {
        reportCaughtError(error, { source: 'application/audit/ticketAuditService.ts', operation: 'gatherSignals.roleCapableRefs' });
      }
    }

    return {
      approvedRoles,
      changesRequestedRoles,
      ranDiagnostics,
      failedDiagnostics,
      sectionAuthoredRoles: new Set(authoredPrdRoleSections(prdRow?.prd ?? null)),
      performedRoles: performed,
      signedOffRoles,
      roleCapableRefs,
    };
  }
}

/** Pass mark for a scored diagnostic requirement (ToolResult.score is 0..5). A run at
 *  or above this satisfies; below it, the requirement stays unmet. */
const DIAGNOSTIC_PASS_THRESHOLD = 3;

function safeParseMissing(raw: string | null): UnmetRequirement[] {
  if (!raw) return [];
  try {
    const p: unknown = JSON.parse(raw);
    return Array.isArray(p) ? (p as UnmetRequirement[]) : [];
  } catch {
    return [];
  }
}
