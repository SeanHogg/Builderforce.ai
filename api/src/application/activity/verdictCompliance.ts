/**
 * VERDICT COMPLIANCE — does autonomous review actually work, and which agent is the
 * non-reporter?
 *
 * A reviewer run that COMPLETES without calling `kanban.signoff` is indistinguishable,
 * from every throughput chart in the product, from one that returned a real verdict. The
 * per-slot symptom was closed first (`attestRoleRun` counts each silent run on the slot
 * and, at the ceiling, classifies it `exhausted` so the manager escalates instead of
 * re-asking forever). What that cannot answer is the RATE — and the rate is the single
 * number that says whether autonomous review works at all.
 *
 * The measurement is a join nothing else performs: every terminal `executions` row whose
 * payload carries a role (`reviewRole` for a judgement, `actAsRole` for a production)
 * against `ticket_role_signoffs` for the SAME (task, role, lane). A run with no matching
 * ledger row inside its own lifetime is a MISS.
 *
 * Broken out per agent — not only per tenant — because "reviews are 40% unanswered" is a
 * symptom and "gpt-oss-120b answers 4% of the time while Ada answers 96%" is a decision.
 * That is what lets a reviewer model be chosen on evidence instead of per-slot symptoms.
 *
 * SCOPE NOTES, so the number is read honestly:
 *  • Only TERMINAL runs count. A live/queued run has not had its chance yet.
 *  • FAILED runs are excluded from the denominator: a run that crashed owed no verdict,
 *    and counting it would blame the reviewer for an infrastructure failure.
 *  • A producer run (`actAsRole`) is scored the same way but reported separately, because
 *    `attestRoleRun` auto-credits producers — a producer miss is a platform gap, whereas
 *    a REVIEWER miss is an agent that did not do the one thing it was asked to do.
 *  • Matching is by (task, role) with the lane as a TIE-BREAK, mirroring `ledgerCovers`
 *    in `attestRoleRun`: an exact `lane:role` row wins, and a lane-less row applies to
 *    the role as a fallback. Two readers of the same ledger must never disagree about
 *    whether a verdict exists.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { executions, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { ExecutionStatus } from '../../domain/shared/types';
import { isAutoAttestedContribution } from '../kanban/signoffContribution';

/** One role-attributed run, reduced to what the match needs. PURE input. */
export interface RoleRunRow {
  executionId: number;
  taskId: number;
  roleKey: string;
  laneKey: string | null;
  /** `reviewRole` ⇒ a judgement was asked for; `actAsRole` ⇒ a deliverable was. */
  kind: 'reviewer' | 'producer';
  agentRef: string | null;
  completedAt: string;
}

/** One recorded verdict, reduced to what the match needs. PURE input. */
export interface VerdictRow {
  taskId: number;
  roleKey: string;
  laneKey: string | null;
  /** Credited by the platform from a finished run rather than judged by a member. */
  autoAttested: boolean;
  createdAt: string;
}

/** Compliance for one grouping key (a tenant, or one agent within it). */
export interface VerdictComplianceStats {
  /** `null` for the tenant total. */
  agentRef: string | null;
  /** Terminal, completed reviewer runs in the window. */
  reviewerRuns: number;
  /** …of which a verdict was recorded for the same (task, role, lane). */
  reviewerAnswered: number;
  /** …of which NO verdict exists. The number the whole module is for. */
  reviewerMissed: number;
  /** 0..100. `null` when there were no reviewer runs to judge. */
  missRatePercent: number | null;
  /** Producer runs, scored the same way but reported apart — see the module header. */
  producerRuns: number;
  producerMissed: number;
  /** Answered runs whose ONLY matching verdict was auto-attested by the platform.
   *  Counted inside `reviewerAnswered`, surfaced separately so "the platform closed
   *  it" is never mistaken for "the reviewer answered". */
  reviewerAutoAttestedOnly: number;
}

export interface VerdictComplianceReport {
  windowDays: number;
  generatedAt: string;
  totals: VerdictComplianceStats;
  /** Per-agent, worst miss rate first — the ranking that names the non-reporter. */
  byAgent: VerdictComplianceStats[];
  /** True when the run set hit {@link MAX_COMPLIANCE_RUNS} and was truncated. */
  truncated: boolean;
}

/** Hard ceiling on the scored run set — the same bound the lifecycle audit uses. */
export const MAX_COMPLIANCE_RUNS = 5000;

/** An agent needs at least this many reviewer runs before its rate is worth ranking. */
export const MIN_RUNS_FOR_AGENT_RANKING = 3;

const emptyStats = (agentRef: string | null): VerdictComplianceStats => ({
  agentRef,
  reviewerRuns: 0, reviewerAnswered: 0, reviewerMissed: 0, missRatePercent: null,
  producerRuns: 0, producerMissed: 0, reviewerAutoAttestedOnly: 0,
});

/**
 * Does the ledger carry a verdict for this run's slot? PURE.
 *
 * Mirrors `attestRoleRun.ledgerCovers` exactly — an exact `lane:role` row wins, a
 * lane-less row is the role-wide fallback — so the compliance report and the attestation
 * that acts on the same fact can never disagree about whether a verdict exists.
 *
 * Returns the matching verdict (so the caller can see whether it was auto-attested), or
 * null for a MISS.
 */
export function findCoveringVerdict(
  run: Pick<RoleRunRow, 'laneKey'>,
  verdicts: readonly VerdictRow[],
): VerdictRow | null {
  const exact = verdicts.find((v) => v.laneKey === run.laneKey);
  if (exact) return exact;
  return verdicts.find((v) => v.laneKey === null) ?? null;
}

/**
 * Fold role runs + verdicts into the per-agent and total compliance stats. PURE — the
 * whole decision is testable without a database.
 */
export function computeVerdictCompliance(
  runs: readonly RoleRunRow[],
  verdicts: readonly VerdictRow[],
): { totals: VerdictComplianceStats; byAgent: VerdictComplianceStats[] } {
  // Index the ledger by (task, role) once — the alternative is a scan per run.
  const byTaskRole = new Map<string, VerdictRow[]>();
  for (const v of verdicts) {
    const key = `${v.taskId}:${v.roleKey}`;
    const bucket = byTaskRole.get(key);
    if (bucket) bucket.push(v); else byTaskRole.set(key, [v]);
  }

  const totals = emptyStats(null);
  const byAgent = new Map<string, VerdictComplianceStats>();

  for (const run of runs) {
    const agentKey = run.agentRef ?? '(unattributed)';
    const agent = byAgent.get(agentKey) ?? emptyStats(run.agentRef);
    const covering = findCoveringVerdict(run, byTaskRole.get(`${run.taskId}:${run.roleKey}`) ?? []);

    for (const bucket of [totals, agent]) {
      if (run.kind === 'reviewer') {
        bucket.reviewerRuns += 1;
        if (covering) {
          bucket.reviewerAnswered += 1;
          if (covering.autoAttested) bucket.reviewerAutoAttestedOnly += 1;
        } else {
          bucket.reviewerMissed += 1;
        }
      } else {
        bucket.producerRuns += 1;
        if (!covering) bucket.producerMissed += 1;
      }
    }
    byAgent.set(agentKey, agent);
  }

  const withRate = (s: VerdictComplianceStats): VerdictComplianceStats => ({
    ...s,
    missRatePercent: s.reviewerRuns === 0 ? null : Math.round((s.reviewerMissed / s.reviewerRuns) * 100),
  });

  return {
    totals: withRate(totals),
    byAgent: [...byAgent.values()]
      .map(withRate)
      // Worst first, but only among agents with enough runs to mean anything; a
      // single-run agent at 100% would otherwise top a ranking meant to name a
      // systematic non-reporter.
      .sort((a, b) => {
        const rankable = (s: VerdictComplianceStats) => (s.reviewerRuns >= MIN_RUNS_FOR_AGENT_RANKING ? 1 : 0);
        return rankable(b) - rankable(a)
          || (b.missRatePercent ?? -1) - (a.missRatePercent ?? -1)
          || b.reviewerRuns - a.reviewerRuns;
      }),
  };
}

/**
 * Measure verdict compliance for a tenant over a window.
 *
 * Two set-based reads (role-attributed runs; the verdicts for exactly those tasks) —
 * no per-run fan-out. Cached for the same reason the sibling lenses are: it is a
 * read-heavy manager dashboard query over an append-only ledger.
 */
export async function getVerdictCompliance(
  env: Env,
  db: Db,
  args: { tenantId: number; windowDays?: number },
): Promise<VerdictComplianceReport> {
  const windowDays = Math.min(365, Math.max(1, args.windowDays ?? 30));
  return getOrSetCached(env, `insights:verdict-compliance:${args.tenantId}:${windowDays}`, async () => {
    const since = new Date(Date.now() - windowDays * 86_400_000);

    // ROLE-ATTRIBUTED RUNS. The role and lane live in the dispatch payload, which is
    // stored as text — cast to jsonb to read them rather than pulling every payload
    // across the wire and parsing it in the Worker.
    const roleKeyExpr = sql<string | null>`
      coalesce(${executions.payload}::jsonb ->> 'reviewRole', ${executions.payload}::jsonb ->> 'actAsRole')`;
    const runRows = await db
      .select({
        executionId: executions.id,
        taskId: executions.taskId,
        roleKey: roleKeyExpr,
        reviewRole: sql<string | null>`${executions.payload}::jsonb ->> 'reviewRole'`,
        laneKey: sql<string | null>`${executions.payload}::jsonb ->> 'laneKey'`,
        agentRef: executions.cloudAgentRef,
        completedAt: executions.completedAt,
      })
      .from(executions)
      .where(and(
        eq(executions.tenantId, args.tenantId),
        eq(executions.status, ExecutionStatus.COMPLETED),
        sql`${executions.completedAt} >= ${since.toISOString()}`,
        // Only rows whose payload is real JSON carrying a role. `jsonb_typeof` guards
        // the cast: a legacy plain-text payload would otherwise raise on `::jsonb`.
        sql`${executions.payload} is not null`,
        sql`left(btrim(${executions.payload}), 1) = '{'`,
        sql`(${executions.payload}::jsonb ? 'reviewRole' or ${executions.payload}::jsonb ? 'actAsRole')`,
      ))
      .limit(MAX_COMPLIANCE_RUNS + 1);

    const truncated = runRows.length > MAX_COMPLIANCE_RUNS;
    const scored = runRows.slice(0, MAX_COMPLIANCE_RUNS);

    const runs: RoleRunRow[] = scored.flatMap((r) => (r.roleKey ? [{
      executionId: Number(r.executionId),
      taskId: Number(r.taskId),
      roleKey: r.roleKey,
      laneKey: r.laneKey,
      kind: r.reviewRole ? 'reviewer' as const : 'producer' as const,
      agentRef: r.agentRef,
      completedAt: (r.completedAt as Date | null)?.toISOString() ?? new Date(0).toISOString(),
    }] : []));

    const taskIds = [...new Set(runs.map((r) => r.taskId))];
    const verdictRows = taskIds.length === 0 ? [] : await db
      .select({
        taskId: ticketRoleSignoffs.taskId,
        roleKey: ticketRoleSignoffs.roleKey,
        laneKey: ticketRoleSignoffs.laneKey,
        contribution: ticketRoleSignoffs.contribution,
        createdAt: ticketRoleSignoffs.createdAt,
      })
      .from(ticketRoleSignoffs)
      .where(and(
        eq(ticketRoleSignoffs.tenantId, args.tenantId),
        inArray(ticketRoleSignoffs.taskId, taskIds),
      ));

    const verdicts: VerdictRow[] = verdictRows.map((v) => ({
      taskId: Number(v.taskId),
      roleKey: v.roleKey,
      laneKey: v.laneKey,
      autoAttested: isAutoAttestedContribution(v.contribution as Record<string, unknown> | null),
      createdAt: (v.createdAt as Date).toISOString(),
    }));

    const { totals, byAgent } = computeVerdictCompliance(runs, verdicts);
    return { windowDays, generatedAt: new Date().toISOString(), totals, byAgent, truncated };
  }, { kvTtlSeconds: 300, l1TtlMs: 60_000 });
}
