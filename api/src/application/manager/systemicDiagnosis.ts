import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * systemicDiagnosis — the AI Manager's step up from "this ticket is stuck" to
 * "these 313 tickets are one platform defect, and here is the ticket to fix it".
 *
 * ── THE FAILURE THIS CLOSES ──────────────────────────────────────────────────────
 * The manager's remedies are all per-ticket: assign it, dispatch it, reset its breaker,
 * ask its reviewer. Every one is correct in isolation and useless at scale, because the
 * measured stalls do not distribute across independent causes — they CONCENTRATE.
 * Tenant 1, 2026-07-26, 767 tickets: 313 shared `unassigned` (no lane on any board had
 * staffing), 149 shared an unsatisfied sign-off round-trip, 116 shared the failure
 * breaker. Assigning an owner to 313 tickets one five-minute pass at a time does not fix
 * "no lane is staffed"; it just spends 313 attempts discovering that again.
 *
 * A cohort that large is a configuration or platform defect wearing ticket costumes. The
 * right output is not 313 remedies, it is ONE ticket that names the defect. That is what
 * this module produces.
 *
 * ── WHY A MODEL, AND WHERE IT IS NOT TRUSTED ─────────────────────────────────────
 * The COUNT is measured, never inferred — {@link StallCensus} is arithmetic over the
 * whole ticket set. What the model adds is the step arithmetic cannot take: reading a
 * cohort's shape and naming the underlying defect and its remediation in language a
 * human can act on. So the model is asked only for prose, under a strict schema, on the
 * free pool (like `businessValueAI`, so grooming stays cost-free), and it is asked at
 * most once per cohort per project — not per ticket, not per pass.
 *
 * If the model is unavailable or malformed, {@link heuristicFinding} produces a
 * deterministic finding from the same measured facts. The finding is recorded either
 * way, tagged with its `source`, because a cohort of 313 must never go unreported just
 * because a model call failed.
 *
 * ── WHY IT CANNOT SPAM ───────────────────────────────────────────────────────────
 * Three independent bounds, because an unbounded ticket-filer is strictly worse than no
 * ticket-filer: a materiality threshold ({@link SYSTEMIC_COHORT_MIN}), a per-pass ceiling
 * ({@link MAX_FINDINGS_PER_PASS}), and a unique index on the open (tenant, project, cause)
 * row so a re-observed cohort REFRESHES its finding instead of filing another. A cohort
 * that shrinks below the threshold resolves its finding, so a genuine recurrence later
 * files a fresh one rather than resurrecting stale prose.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import { managerSystemicFindings, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import type { StallCause } from './stallTriage';
import type { StallCensus, CensusCohort } from './stallCensus';

/**
 * How many tickets must share ONE cause before it is a platform problem rather than
 * ticket work.
 *
 * Twelve is deliberate and matches `MAX_TRIAGE_PER_RUN`: at or below the per-pass deep
 * triage budget the manager can genuinely work the cohort ticket by ticket within a
 * pass or two, so a systemic finding would be noise. Above it, per-ticket remediation
 * provably cannot keep up — the cohort outruns the budget every pass, forever, which is
 * exactly the state the 313-ticket cohort was in for weeks.
 */
export const SYSTEMIC_COHORT_MIN = 12;

/** Findings raised in one pass. Each costs a model call; the cohorts are ranked by size. */
export const MAX_FINDINGS_PER_PASS = 2;

/**
 * Causes that can be systemic. A cause is listed here when a LARGE cohort of it implies
 * a shared defect — staffing, configuration, a broken round-trip.
 *
 * `live`, `moving` and `cooling_down` are absent because they are not stalls at all.
 * `blocked` and `merge_withheld` are absent because a large cohort of either is a
 * deliberate human choice (a dependency, a withheld merge authority), and filing a
 * defect ticket against a policy someone set on purpose is noise, not insight.
 */
const SYSTEMIC_CAUSES: ReadonlySet<StallCause> = new Set<StallCause>([
  'unassigned', 'managed_no_role', 'capability_gap', 'never_started', 'awaiting_signoff',
  'failure_breaker', 'human_gate', 'missing_deliverable', 'pr_conflict',
  'pr_unreconciled', 'build_failed', 'unknown',
]);

/** What one systemic cohort resolved to. */
export interface SystemicFinding {
  cause: StallCause;
  ticketCount: number;
  summary: string;
  remediation: string;
  source: 'ai' | 'heuristic';
  sampleTaskIds: number[];
}

export interface SystemicOutcome {
  /** Findings raised or refreshed this pass. */
  findings: SystemicFinding[];
  /** Platform-fix tickets actually created this pass. */
  ticketsCreated: number;
  /** Findings closed because their cohort fell below the threshold. */
  resolved: number;
  journal: Array<{ taskId: number | null; summary: string; detail: Record<string, unknown> }>;
}

/** Cohorts worth a systemic finding, largest first. PURE. */
export function selectSystemicCohorts(census: StallCensus, min = SYSTEMIC_COHORT_MIN): CensusCohort[] {
  return census.cohorts
    .filter((c) => c.count >= min && SYSTEMIC_CAUSES.has(c.cause))
    .sort((a, b) => b.count - a.count);
}

export const SYSTEMIC_DIAGNOSIS_PROMPT =
  'You are the engineering manager of an autonomous software-delivery platform. '
  + 'You are shown ONE measured fact: a number of tickets in a single project that are all stuck for the SAME reason. '
  + 'These are not independent ticket problems — a cohort this large means one underlying platform or configuration defect. '
  + 'Name that defect and the remediation. Be concrete and specific to the cause given; do not restate the count. '
  + 'summary: one or two sentences naming the most likely root cause. '
  + 'remediation: the concrete change that would clear the whole cohort, as an instruction an engineer can act on. '
  // SAFETY LIMITS ARE NOT THE DEFECT. Measured on the failure-breaker cohort: the model's
  // remediation was "raise the retry limit to 10-15 and re-dispatch", i.e. remove the one
  // guard that stops a retry storm — and this text is filed as a ticket an agent may work.
  // A breaker that keeps tripping is evidence of the thing it is catching.
  + 'NEVER propose raising, relaxing or disabling a safety limit (a failure breaker, a retry cap, a rate limit, '
  + 'an approval gate) as the remediation. A guard that keeps firing is evidence of the underlying failure, not its cause: '
  + 'diagnose what makes the runs fail. If you genuinely believe a limit is mis-set, say what evidence would justify changing it '
  + 'rather than instructing anyone to change it. '
  + 'Reply with JSON only.';

const RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'systemic_stall_finding',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'remediation'],
      properties: {
        summary: { type: 'string' },
        remediation: { type: 'string' },
      },
    },
  },
};

/**
 * One plain-English description per cause of what a LARGE cohort of it means, given to
 * the model as grounding. Without it the model only sees an enum value and invents a
 * plausible-sounding cause; with it, the prose stays anchored to what the platform
 * actually measured.
 */
const CAUSE_BRIEF: Record<string, string> = {
  unassigned: 'No agent is staffed on these tickets\' lanes and the tickets have no owner agent, so no dispatcher can ever pick them up.',
  managed_no_role: 'The board is lifecycle-managed, so every run must be attributed to a role the stage authorizes — and on these tickets no authorized role resolves to an agent. Assigning an owner does not help: on a managed board the assignee is the Coordinator, never the executor. The stage\'s authorized roles come from its requirement rows, or from its lane staffing when it declares none; either way an authorized role becomes dispatchable only when some agent staffed on that lane is CAPABLE of it. So the gap is a lane staffed with nobody who can act as the role the stage asks for.',
  capability_gap: 'Candidate agents exist but none holds the capabilities the lane requires.',
  never_started: 'These tickets have never had a single execution — nothing has ever attempted them.',
  awaiting_signoff: 'A required role sign-off for the current stage was asked for but never recorded, so the stage gate never opens.',
  failure_breaker: 'Consecutive failed runs tripped the safety breaker on each of these tickets, so autonomy stopped re-dispatching them.',
  human_gate: 'These lanes require a human approval that nobody has given.',
  missing_deliverable: 'These tickets reached review having produced no branch or pull request.',
  pr_conflict: 'These pull requests conflict with their base branch and cannot merge.',
  pr_unreconciled: 'The stored pull-request state disagrees with the provider.',
  build_failed: 'These tickets\' pull-request builds are red.',
  unknown: 'The stall taxonomy could not name a cause — the tickets are stuck for a reason the platform does not model.',
};

/**
 * Phrases that mean "make the guard weaker", paired with the guard they weaken.
 *
 * The prompt forbids this, but a prompt is a request, not an invariant — and the cost of
 * it being ignored is high: the remediation text is filed as a TICKET, and an agent that
 * works that ticket would be raising the retry ceiling on a platform whose runs are
 * already failing. So it is also checked, deterministically, after the fact.
 */
const WEAKENING_VERBS = /\b(increas\w*|rais\w*|relax\w*|loosen\w*|disabl\w*|remov\w*|bypass\w*|turn(ing)? off|lift\w*|higher|lower\w*)\b/i;
const SAFETY_LIMIT_NOUNS = /\b(breaker|retry limit|retry cap|retry threshold|max(imum)? (number of )?(consecutive )?(failures|retries|attempts)|failure (limit|cap|threshold|count)|rate limit|cooldown|approval gate|safety (limit|mechanism|threshold)|attempt (limit|cap|ceiling))\b/i;

/**
 * True when a remediation instructs someone to weaken a safety limit. PURE.
 *
 * Deliberately requires BOTH a weakening verb and a safety-limit noun, so "investigate why
 * the breaker keeps tripping" and "increase test coverage" both pass. The check is coarse
 * by design: a false positive costs one re-diagnosis, a false negative files a ticket that
 * tells an agent to remove a guard.
 */
export function proposesWeakeningSafetyLimit(remediation: string): boolean {
  return WEAKENING_VERBS.test(remediation) && SAFETY_LIMIT_NOUNS.test(remediation);
}

/** Deterministic finding from measured facts, when the model is unavailable. PURE. */
export function heuristicFinding(cohort: CensusCohort, projectId: number): SystemicFinding {
  const brief = CAUSE_BRIEF[cohort.cause] ?? 'These tickets share one stall cause.';
  const days = Math.floor(cohort.maxIdleMs / 86_400_000);
  return {
    cause: cohort.cause,
    ticketCount: cohort.count,
    summary:
      `${cohort.count} tickets in project ${projectId} are stalled with the same cause (${cohort.cause}), `
      + `the longest for ${days} day${days === 1 ? '' : 's'}. ${brief} `
      + 'A cohort this size is one platform or configuration defect, not independent ticket problems.',
    remediation:
      `Fix the shared cause rather than the ${cohort.count} tickets: ${brief} `
      + `Verify against the sample tickets (${cohort.sampleTaskIds.join(', ')}), then re-check the census — `
      + 'the cohort should collapse in one pass once the underlying defect is corrected.',
    source: 'heuristic',
    sampleTaskIds: cohort.sampleTaskIds,
  };
}

/**
 * Ask the model to name the root cause and remediation for one cohort. Never throws —
 * any failure returns null so {@link heuristicFinding} takes over and the cohort is
 * still reported.
 */
export async function diagnoseSystemicCohort(
  env: Env,
  cohort: CensusCohort,
  ctx: { projectId: number; stalled: number; managed: number; personaDirective?: string | null },
): Promise<SystemicFinding | null> {
  try {
    const days = Math.floor(cohort.maxIdleMs / 86_400_000);
    const userPrompt =
      `Project ${ctx.projectId} has ${ctx.managed} active tickets, ${ctx.stalled} of them stalled.\n`
      + `${cohort.count} of the stalled tickets share the cause "${cohort.cause}".\n`
      + `What that cause means in this platform: ${CAUSE_BRIEF[cohort.cause] ?? 'unclassified'}\n`
      + `Longest-stalled member has been stuck ${days} day${days === 1 ? '' : 's'}.\n`
      + `Example ticket ids: ${cohort.sampleTaskIds.join(', ')}\n\n`
      + 'Name the single underlying defect and the remediation that would clear this whole cohort.';

    const systemContent = ctx.personaDirective?.trim()
      ? `${SYSTEMIC_DIAGNOSIS_PROMPT}\n\nYou are diagnosing AS this manager — let your persona shape the judgement:\n${ctx.personaDirective.trim()}`
      : SYSTEMIC_DIAGNOSIS_PROMPT;

    const result = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 400,
      response_format: RESPONSE_SCHEMA,
      useCase: 'systemic_stall_diagnosis',
    });
    if (result.response.status >= 400) return null;
    const { content } = await readProxyChoice(result);
    if (!content) return null;

    const obj = JSON.parse(content) as Record<string, unknown>;
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
    const remediation = typeof obj.remediation === 'string' ? obj.remediation.trim() : '';
    if (!summary || !remediation) return null;
    // Fall back to the measured heuristic rather than file "raise the retry limit to 15"
    // as a work instruction. Returning null is what hands the cohort to
    // `heuristicFinding`, whose remediation is derived from CAUSE_BRIEF and can never
    // propose removing a guard.
    if (proposesWeakeningSafetyLimit(remediation)) return null;

    return {
      cause: cohort.cause,
      ticketCount: cohort.count,
      summary: summary.slice(0, 1200),
      remediation: remediation.slice(0, 2000),
      source: 'ai',
      sampleTaskIds: cohort.sampleTaskIds,
    };
  } catch {
    return null;
  }
}

/** The ticket body a systemic finding files. PURE — the wording is the deliverable. */
export function buildFindingDirective(f: SystemicFinding, projectId: number): string {
  return [
    `Platform defect: ${f.ticketCount} tickets stalled on "${f.cause}"`,
    '',
    `The AI Manager measured ${f.ticketCount} tickets in project ${projectId} stalled for the same reason.`,
    'A cohort this size is one underlying defect, not independent ticket problems — remediating the',
    'tickets individually cannot clear it.',
    '',
    '## Root cause',
    f.summary,
    '',
    '## Remediation',
    f.remediation,
    '',
    `## Evidence`,
    `Sample stalled tickets: ${f.sampleTaskIds.join(', ')}`,
    `Diagnosis source: ${f.source === 'ai' ? 'model' : 'deterministic fallback'}`,
    '',
    'Verify the fix by re-reading the manager stall census: this cohort should collapse.',
  ].join('\n');
}

/**
 * Raise (or refresh) systemic findings for a project's census, filing ONE platform-fix
 * ticket per new finding.
 *
 * `createTicket` is injected rather than imported so this module stays free of the
 * ManagerService import cycle, and so the ticket-creation path stays the ONE the rest of
 * the manager uses. Best-effort throughout — a systemic finding must never fail a pass.
 */
export async function raiseSystemicFindings(
  env: Env,
  db: Db,
  _runtimeService: RuntimeService,
  args: {
    tenantId: number;
    projectId: number;
    census: StallCensus;
    personaDirective?: string | null;
    /** Files the platform-fix ticket; returns its id. See {@link ManagerService.createManagerCoachingTask}. */
    createTicket: (directive: string, title: string) => Promise<number | null>;
    /** Re-arm an existing remediation ticket that completed without clearing its cohort. */
    ensureTicket?: (taskId: number) => Promise<boolean>;
  },
): Promise<SystemicOutcome> {
  const out: SystemicOutcome = { findings: [], ticketsCreated: 0, resolved: 0, journal: [] };
  const { tenantId, projectId, census } = args;

  try {
    const cohorts = selectSystemicCohorts(census);
    const liveCauses = new Set(cohorts.map((c) => c.cause));

    // Existing OPEN findings, so a re-observed cohort refreshes rather than re-files.
    const open = await db
      .select({
        id: managerSystemicFindings.id, cause: managerSystemicFindings.cause,
        remediation: managerSystemicFindings.remediation, createdTaskId: managerSystemicFindings.createdTaskId,
      })
      .from(managerSystemicFindings)
      .where(and(
        eq(managerSystemicFindings.tenantId, tenantId),
        eq(managerSystemicFindings.projectId, projectId),
        eq(managerSystemicFindings.status, 'open'),
      ))
      .catch(() => []);
    const openByCause = new Map(open.map((r) => [r.cause, r]));

    // A cohort that fell below the threshold is genuinely fixed (or drained) — close it,
    // so a later recurrence files a fresh finding instead of reviving stale prose.
    const stale = open.filter((r) => !liveCauses.has(r.cause as StallCause)).map((r) => r.id);
    if (stale.length) {
      const now = new Date();
      await db.update(managerSystemicFindings)
        .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
        .where(scopedToTenant(managerSystemicFindings, tenantId, inArray(managerSystemicFindings.id, stale)))
        .catch(() => undefined);
      out.resolved = stale.length;
    }

    let budget = MAX_FINDINGS_PER_PASS;
    for (const cohort of cohorts) {
      const existing = openByCause.get(cohort.cause);
      if (existing) {
        // Already reported. Refresh the count so the finding stays honest about scale,
        // and spend NO model call and NO ticket — this is the idempotent steady state.
        //
        // EXCEPT when the stored remediation tells an engineer to weaken a safety limit.
        // The refresh branch never rewrites prose, so a finding diagnosed before
        // `proposesWeakeningSafetyLimit` existed keeps instructing "raise the retry limit
        // to 10 or 15" for as long as its cohort survives — which, for a cohort of 116
        // breaker-tripped tickets, is indefinitely. Repair it in place from the measured
        // heuristic: deterministic, no model call, and no second ticket.
        const repair = proposesWeakeningSafetyLimit(existing.remediation ?? '')
          ? heuristicFinding(cohort, projectId)
          : null;
        const now = new Date();
        await db.update(managerSystemicFindings)
          .set({
            ticketCount: cohort.count, lastSeenAt: now, updatedAt: now,
            ...(repair ? { summary: repair.summary, remediation: repair.remediation, source: repair.source } : {}),
          })
          .where(scopedToTenant(managerSystemicFindings, tenantId, eq(managerSystemicFindings.id, existing.id)))
          .catch(() => undefined);
        // The finding's TICKET carries the same instruction, and the ticket is the artifact
        // an agent actually works — repairing only the row would leave the unsafe wording
        // exactly where it can be acted on.
        if (repair && existing.createdTaskId != null) {
          await db.update(tasks)
            .set({ description: buildFindingDirective(repair, projectId), updatedAt: now })
            .where(scopedToTenant(tasks, tenantId, eq(tasks.id, existing.createdTaskId)))
            .catch(() => undefined);
        }
        let recoveryTaskId = existing.createdTaskId;
        // Older findings could be created without a task (or with dispatch deliberately
        // disabled). Repair that historical diagnosis-only state in place.
        if (recoveryTaskId == null) {
          const executable = repair ?? heuristicFinding(cohort, projectId);
          recoveryTaskId = await args.createTicket(
            buildFindingDirective(executable, projectId),
            `Platform: ${cohort.count} tickets stalled on "${cohort.cause}"`,
          ).catch(() => null);
          if (recoveryTaskId != null) {
            await db.update(managerSystemicFindings)
              .set({ createdTaskId: recoveryTaskId, updatedAt: now })
              .where(scopedToTenant(managerSystemicFindings, tenantId, eq(managerSystemicFindings.id, existing.id)))
              .catch(() => undefined);
            out.ticketsCreated += 1;
          }
        } else if (args.ensureTicket) {
          await args.ensureTicket(recoveryTaskId).catch(() => false);
        }
        if (repair) {
          out.journal.push({
            taskId: recoveryTaskId ?? null,
            summary: `Rewrote the "${cohort.cause}" platform finding — its remediation proposed weakening a safety limit.`,
            detail: { cause: cohort.cause, ticketCount: cohort.count, repaired: 'remediation', source: repair.source },
          });
        }
        continue;
      }
      if (budget <= 0) break;
      budget -= 1;

      const finding = (await diagnoseSystemicCohort(env, cohort, {
        projectId,
        stalled: census.stalled,
        managed: census.managed,
        personaDirective: args.personaDirective,
      })) ?? heuristicFinding(cohort, projectId);

      const title = `Platform: ${cohort.count} tickets stalled on "${cohort.cause}"`;
      const createdTaskId = await args
        .createTicket(buildFindingDirective(finding, projectId), title)
        .catch(() => null);

      const now = new Date();
      await db.insert(managerSystemicFindings).values({
        tenantId, projectId,
        cause: finding.cause,
        ticketCount: finding.ticketCount,
        summary: finding.summary,
        remediation: finding.remediation,
        source: finding.source,
        createdTaskId,
        status: 'open',
        firstSeenAt: now, lastSeenAt: now, updatedAt: now,
      }).catch(() => undefined);

      out.findings.push(finding);
      if (createdTaskId != null) out.ticketsCreated += 1;
      out.journal.push({
        taskId: createdTaskId,
        summary:
          `${finding.ticketCount} tickets share one cause (${finding.cause}) — raised a platform finding`
          + `${createdTaskId != null ? ` and opened ticket #${createdTaskId}` : ''}.`,
        detail: {
          cause: finding.cause,
          ticketCount: finding.ticketCount,
          source: finding.source,
          sampleTaskIds: finding.sampleTaskIds,
          createdTaskId,
        },
      });
    }
  } catch (error) { /* a systemic finding must never fail the manager pass */ 
    reportCaughtError(error, { source: "application/manager/systemicDiagnosis.ts", operation: "raiseSystemicFindings" });
  }

  return out;
}

/** One open finding, for the Manager surface. */
export interface SystemicFindingRow {
  id: string;
  cause: StallCause;
  ticketCount: number;
  summary: string;
  remediation: string;
  source: string;
  createdTaskId: number | null;
  createdTaskKey: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** Open systemic findings for a project, largest cohort first. */
export async function listSystemicFindings(
  db: Db,
  args: { tenantId: number; projectId: number },
): Promise<SystemicFindingRow[]> {
  const rows = await db
    .select({
      id: managerSystemicFindings.id,
      cause: managerSystemicFindings.cause,
      ticketCount: managerSystemicFindings.ticketCount,
      summary: managerSystemicFindings.summary,
      remediation: managerSystemicFindings.remediation,
      source: managerSystemicFindings.source,
      createdTaskId: managerSystemicFindings.createdTaskId,
      createdTaskKey: tasks.key,
      firstSeenAt: managerSystemicFindings.firstSeenAt,
      lastSeenAt: managerSystemicFindings.lastSeenAt,
    })
    .from(managerSystemicFindings)
    .leftJoin(tasks, eq(tasks.id, managerSystemicFindings.createdTaskId))
    .where(and(
      eq(managerSystemicFindings.tenantId, args.tenantId),
      eq(managerSystemicFindings.projectId, args.projectId),
      eq(managerSystemicFindings.status, 'open'),
      isNull(managerSystemicFindings.resolvedAt),
    ))
    .orderBy(sql`${managerSystemicFindings.ticketCount} desc`)
    .limit(20)
    .catch(() => []);
  return rows as SystemicFindingRow[];
}
