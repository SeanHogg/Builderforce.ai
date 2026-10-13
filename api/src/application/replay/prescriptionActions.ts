/**
 * THE prescription actions (PRD 33 §5.1.4) — the writer of the action columns
 * (`status`, `action_kind`, `action_ref`, `dismiss_reason`, `decided_by`).
 *
 * `PRESCRIPTION_ACTIONS` is a registry of data rows: one per `REPLAY_PATHS
 * .prescriptionAction` verb, each with its trace verb and its `run`. The caller
 * (`runPrescriptionAction`) never branches on the action: it loads the row, asks
 * the lifecycle (`nextActions`) whether the action is open now, runs it, writes the
 * columns it returned, traces `replay.prescription.<action>` and bumps the site.
 *
 *   fix              a ticket with the brief; on a hosted app with a chosen coding
 *                    agent, `dispatchCloudRunForTask` with a `prescriptionFix` marker
 *                    that builds a PREVIEW release; a connected repo → the ticket asks
 *                    for a pull request. Never anything live.
 *   test             a DRAFT A/B test, live vs the fix's preview (`prescriptionReleases`)
 *   start-test       a person starts it
 *   follow-up        preview who/what first (optionally a drafted NEW sequence); `confirm`
 *                    enrols matched contacts (`prescriptionFollowUpAction.ts`)
 *   ticket           the brief as a ticket body (objection_pattern adds FAQ + talk track)
 *   dismiss          reason required; the sweep keeps the subject dismissed for 30 days
 *   publish-preview  the existing pointer move, by a person
 *   revert           republish the release that was live before (offered only on `worse`)
 *   copy-prompt / apply-page / apply-in-composer   the §5.2 page actions (`prescriptionPageActions.ts`)
 *
 * The row is CLAIMED before an action runs: one interactive transaction
 * (`inTransaction`) takes `SELECT … FOR UPDATE` on it and re-checks its status, so a
 * second, concurrent action on the same fix waits, then finds the status moved and
 * answers 409 — it never creates a second ticket or dispatches a second run. The
 * action's own writes (tasks, releases, other rows) go through `db`; only this row's
 * columns are written through the transaction. A failure rolls back and releases
 * the claim.
 */

import { and, eq } from 'drizzle-orm';
import {
  formatReplayMomentTrailer,
  type ReplayPrescriptionActionInput,
  type ReplayPrescriptionActionResultDto,
  type ReplayPrescriptionRouteAction,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import { inTransaction, type Db } from '../../infrastructure/database/connection';
import { ideAgents, projectRepositories, replayPrescriptions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { TaskType } from '../../domain/shared/types';
import { asJsonRecord } from '../../domain/shared/json';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { buildPrescriptionBrief, type BriefMode } from '../../domain/replay/prescriptions/brief';
import { encodeActionRef, type PrescriptionRefs } from '../../domain/replay/prescriptions/prescriptionState';
import { TaskService } from '../task/TaskService';
import { taskCreatedHook } from '../task/taskCreationHook';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { dispatchCloudRunForTask, dispatchError } from '../runtime/dispatchCloudRun';
import { humanDirected, stampExecutionAuthority } from '../runtime/executionAuthority';
import { composeDispatcherLabel } from '../runtime/dispatcherLabel';
import { buildRuntimeService } from '../../buildRuntimeService';
import { resolveHumanActor, SYSTEM_ACTOR, type ActorIdentity } from '../activity/activityLog';
import { loadPrescriptionRow, toPrescriptionDto, type PrescriptionRow } from './prescriptionReads';
import {
  createPrescriptionTest,
  hostedProjectOf,
  liveVersionToken,
  moveSiteTo,
  startPrescriptionTest,
} from './prescriptionReleases';
import { bumpSiteVersion } from './replayCacheKeys';
import { ReplayReadService } from './ReplayReadService';
import { ReplayHeatmapService } from './ReplayHeatmapService';
import { getSiteForTenant, type ReplaySiteRecord } from './replaySites';
import { recordReplayTrace, REPLAY_TRACE_VERBS, type ReplayTraceVerb } from './replayTrace';
import { PAGE_PRESCRIPTION_ACTIONS } from './prescriptionPageActions';
import { FOLLOW_UP_PRESCRIPTION_ACTION } from './prescriptionFollowUpAction';

const DISMISS_REASON_MAX = 500;

export interface ActionContext {
  env: Env;
  db: Db;
  scope: ReplayScope;
  site: ReplaySiteRecord;
  row: PrescriptionRow;
  refs: PrescriptionRefs;
  input: ReplayPrescriptionActionInput;
  actorId: string | null;
  now: Date;
}

/** The columns an action writes, and what it tells the caller. */
export interface ActionOutcome {
  /** `actionRef` raw is a §5.2 pending marker (`manual` | `composer`); `refs` encodes everything else. */
  set: Partial<Pick<PrescriptionRow, 'status' | 'actionKind' | 'dismissReason' | 'decidedBy' | 'actionRef'>> & { refs?: PrescriptionRefs };
  result?: Omit<ReplayPrescriptionActionResultDto, 'prescription'>;
  /** False for a preview that changed nothing (no trace, no write). */
  acted?: boolean;
}

export interface PrescriptionActionDef {
  action: ReplayPrescriptionRouteAction;
  verb: ReplayTraceVerb;
  run(ctx: ActionContext): Promise<ActionOutcome>;
  /**
   * True when this input only READS (a preview a person reviews before confirming):
   * it runs without the row claim, so a slow read (a drafted sequence is a model
   * call) never holds the prescription's row lock.
   */
  preview?(input: ReplayPrescriptionActionInput): boolean;
}

async function actorOf(ctx: ActionContext): Promise<ActorIdentity> {
  return ctx.actorId ? resolveHumanActor(ctx.env, ctx.db, ctx.scope.tenantId, ctx.actorId).catch(() => SYSTEM_ACTOR) : SYSTEM_ACTOR;
}

/** The project a ticket belongs to: the hosted app's, else the one the person chose. */
function ticketProjectOf(ctx: ActionContext): number {
  if (ctx.site.kind === 'hosted' && ctx.site.projectId !== null) return ctx.site.projectId;
  const projectId = Number(ctx.input.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new ValidationError('projectId is required for a ticket on an external site');
  return projectId;
}

/** The moment trailer `ticketEffect.effectFor` measures the ticket by (before = the live release now). */
async function momentTrailer(ctx: ActionContext): Promise<string> {
  const [release] = await new ReplayReadService(ctx.env, ctx.db).releases(ctx.scope);
  const route = ctx.row.pagePath ?? (await new ReplayHeatmapService(ctx.env, ctx.db).routes(ctx.scope))[0]?.route ?? null;
  if (!release || !route) return '';
  const evidence = asJsonRecord(ctx.row.finding).evidence;
  const first = Array.isArray(evidence) ? String(asJsonRecord(evidence[0]).recordingId ?? '') : '';
  const metric = ctx.row.ruleId === 'error_on_step' ? 'errors'
    : (asJsonRecord(ctx.row.acceptance).direction === 'down' ? 'frustrated' : 'conversions');
  return `\n\n${formatReplayMomentTrailer({
    siteId: ctx.site.id,
    recordingId: first || ctx.row.id,
    atMs: Number(Array.isArray(evidence) ? asJsonRecord(evidence[0]).atMs : 0) || 0,
    releaseKey: release.releaseKey,
    metric,
    route,
  })}`;
}

async function createBriefTask(ctx: ActionContext, mode: BriefMode, agentRef: string | null): Promise<number> {
  const projectId = ticketProjectOf(ctx);
  const finding = asJsonRecord(ctx.row.finding);
  const acceptance = asJsonRecord(ctx.row.acceptance);
  const brief = buildPrescriptionBrief({
    prescriptionId: ctx.row.id,
    ruleId: ctx.row.ruleId,
    params: asJsonRecord(finding.params) as Record<string, string | number>,
    pagePath: ctx.row.pagePath,
    selector: typeof finding.selector === 'string' ? finding.selector : null,
    label: typeof finding.label === 'string' ? finding.label : null,
    prescription: ctx.row.prescription,
    change: ctx.row.change,
    acceptance: typeof acceptance.metric === 'string' && (acceptance.direction === 'up' || acceptance.direction === 'down')
      ? { metric: acceptance.metric, direction: acceptance.direction, minVisits: Number(acceptance.minVisits) || 0 }
      : null,
    siteLabel: ctx.site.label || ctx.site.id,
    mode,
  });
  const tasks = new TaskService(new TaskRepository(ctx.db), new ProjectRepository(ctx.db), undefined, undefined, undefined, undefined, undefined, taskCreatedHook(ctx.db, ctx.env));
  const task = await tasks.createTask({
    projectId,
    title: brief.title,
    description: brief.description + await momentTrailer(ctx),
    taskType: TaskType.TASK,
    assignedAgentRef: agentRef,
    createdBy: await actorOf(ctx),
    createdVia: 'insights_prescription',
  }, ctx.scope.tenantId);
  return Number(task.toPlain().id);
}

/** An active cloud agent of this workspace, or null. */
async function agentOf(ctx: ActionContext): Promise<string | null> {
  const ref = typeof ctx.input.agentRef === 'string' ? ctx.input.agentRef.trim() : '';
  if (!ref) return null;
  const [agent] = await ctx.db.select({ id: ideAgents.id }).from(ideAgents)
    .where(scopedToTenant(ideAgents, ctx.scope.tenantId, eq(ideAgents.id, ref), eq(ideAgents.status, 'active'))).limit(1);
  if (!agent) throw new NotFoundError('Agent', ref);
  return agent.id;
}

async function repoConnected(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  const [repo] = await db.select({ id: projectRepositories.id }).from(projectRepositories)
    .where(scopedToTenant(projectRepositories, tenantId, eq(projectRepositories.projectId, projectId))).limit(1);
  return !!repo;
}

const fix: PrescriptionActionDef = {
  action: 'fix',
  verb: REPLAY_TRACE_VERBS.prescriptionFix,
  async run(ctx) {
    const hosted = ctx.site.kind === 'hosted' && ctx.site.projectId !== null;
    const agentRef = hosted ? await agentOf(ctx) : null;
    const mode: BriefMode = agentRef ? 'preview' : (await repoConnected(ctx.db, ctx.scope.tenantId, ticketProjectOf(ctx)) ? 'pr' : 'ticket');
    const taskId = await createBriefTask(ctx, mode, agentRef);
    let executionId: number | null = null;
    let refusal: string | null = agentRef ? null : (hosted ? 'No coding agent was chosen, so the fix is a ticket.' : 'An external site is fixed through its ticket.');
    if (agentRef) {
      const payload = stampExecutionAuthority(
        JSON.stringify({ cloudAgentRef: agentRef, prescriptionFix: { prescriptionId: ctx.row.id, siteId: ctx.site.id, preview: true } }),
        humanDirected(ctx.actorId, `Insights fix ${ctx.row.id}`),
      );
      const deferred: Promise<unknown>[] = [];
      const outcome = await dispatchCloudRunForTask(ctx.env, ctx.db, buildRuntimeService(ctx.env, ctx.db), (p) => { deferred.push(Promise.resolve(p)); }, {
        taskId,
        tenantId: ctx.scope.tenantId,
        payload,
        submittedBy: composeDispatcherLabel('insights', agentRef),
        force: true,
      }).catch(dispatchError);
      await Promise.allSettled(deferred);
      executionId = outcome.executionId;
      refusal = outcome.refusal?.message ?? null;
    }
    return {
      set: { status: 'applied', actionKind: 'fix', refs: { ...ctx.refs, taskId } },
      result: { taskId, executionId, refusal },
    };
  },
};

const ticket: PrescriptionActionDef = {
  action: 'ticket',
  verb: REPLAY_TRACE_VERBS.prescriptionTicket,
  async run(ctx) {
    const taskId = await createBriefTask(ctx, 'ticket', null);
    return { set: { status: 'applied', actionKind: 'ticket', refs: { ...ctx.refs, taskId } }, result: { taskId } };
  },
};

const dismiss: PrescriptionActionDef = {
  action: 'dismiss',
  verb: REPLAY_TRACE_VERBS.prescriptionDismiss,
  async run(ctx) {
    const reason = typeof ctx.input.reason === 'string' ? ctx.input.reason.trim() : '';
    if (!reason) throw new ValidationError('A reason is required to dismiss a fix');
    return { set: { status: 'dismissed', dismissReason: reason.slice(0, DISMISS_REASON_MAX), decidedBy: ctx.actorId } };
  },
};

const test: PrescriptionActionDef = {
  action: 'test',
  verb: REPLAY_TRACE_VERBS.prescriptionTest,
  async run(ctx) {
    if (!ctx.refs.previewRelease) throw new ConflictError('Test it needs the fix\'s preview release first');
    const testId = await createPrescriptionTest(ctx.db, ctx.site, ctx.row, ctx.refs.previewRelease);
    // Still `applied`: the test is a DRAFT until a person starts it.
    return { set: { status: 'applied', actionKind: 'test', refs: { ...ctx.refs, testId } }, result: { testId } };
  },
};

const startTestAction: PrescriptionActionDef = {
  action: 'start-test',
  verb: REPLAY_TRACE_VERBS.prescriptionStartTest,
  async run(ctx) {
    if (ctx.refs.testId === null) throw new ConflictError('There is no test to start');
    await startPrescriptionTest(ctx.env, ctx.db, ctx.site, ctx.refs.testId, await actorOf(ctx));
    return { set: { status: 'measuring' }, result: { testId: ctx.refs.testId } };
  },
};

const publishPreview: PrescriptionActionDef = {
  action: 'publish-preview',
  verb: REPLAY_TRACE_VERBS.prescriptionPublishPreview,
  async run(ctx) {
    if (!ctx.refs.previewRelease) throw new ConflictError('There is no preview to publish');
    const live = await liveVersionToken(ctx.db, ctx.scope.tenantId, hostedProjectOf(ctx.site));
    await moveSiteTo(ctx.env, ctx.db, ctx.site, ctx.refs.previewRelease);
    return {
      // A proved test stays `worked`; a published fix is now measured on its release.
      set: { status: ctx.row.status === 'worked' ? 'worked' : 'measuring', refs: { ...ctx.refs, liveRelease: live } },
    };
  },
};

const revert: PrescriptionActionDef = {
  action: 'revert',
  verb: REPLAY_TRACE_VERBS.prescriptionRevert,
  async run(ctx) {
    if (!ctx.refs.liveRelease) throw new ConflictError('There is no earlier release to go back to');
    await moveSiteTo(ctx.env, ctx.db, ctx.site, ctx.refs.liveRelease);
    // The earlier release is live again; Revert is not offered twice.
    return { set: { refs: { ...ctx.refs, liveRelease: null } } };
  },
};

/** Every action, as data. */
export const PRESCRIPTION_ACTIONS: readonly PrescriptionActionDef[] = [
  fix, test, startTestAction, FOLLOW_UP_PRESCRIPTION_ACTION, ticket, dismiss, publishPreview, revert,
  ...PAGE_PRESCRIPTION_ACTIONS,
];
const BY_ACTION = new Map(PRESCRIPTION_ACTIONS.map((a) => [a.action, a]));

/** Run one action a person chose. 404 for an unknown action or prescription; 409 when it is not open now. */
export async function runPrescriptionAction(
  env: Env,
  db: Db,
  scope: ReplayScope,
  prescriptionId: string,
  action: string,
  input: ReplayPrescriptionActionInput,
  opts: { actorId: string | null; now?: Date },
): Promise<ReplayPrescriptionActionResultDto> {
  const def = BY_ACTION.get(action as ReplayPrescriptionRouteAction);
  if (!def) throw new NotFoundError('Prescription action', action);
  const site = await getSiteForTenant(env, db, scope.tenantId, scope.siteId);
  const row = await loadPrescriptionRow(db, scope, prescriptionId);
  const context = { hostedCanvas: site.kind === 'hosted' && site.projectId !== null };
  const dto = toPrescriptionDto(row, 0, context);
  if (!dto.next.includes(def.action)) throw new ConflictError(`"${def.action}" is not open for this fix now`);
  const now = opts.now ?? new Date();
  const ctx: ActionContext = { env, db, scope, site, row, refs: dto.refs, input, actorId: opts.actorId, now };

  if (def.preview?.(input)) {
    const outcome = await def.run(ctx);
    return { prescription: dto, ...outcome.result };
  }

  const claimed = await inTransaction(db, async (tx) => {
    // The claim: held until this transaction ends, so a concurrent action waits here.
    const [current] = await tx
      .select({ status: replayPrescriptions.status, actionRef: replayPrescriptions.actionRef })
      .from(replayPrescriptions)
      .where(and(eq(replayPrescriptions.id, row.id), eq(replayPrescriptions.siteId, scope.siteId)))
      .limit(1)
      .for('update');
    if (!current || current.status !== row.status || current.actionRef !== row.actionRef) {
      throw new ConflictError('This fix changed while you were acting on it; reload it');
    }
    const outcome = await def.run(ctx);
    if (outcome.acted === false) return { outcome, updated: null };
    const { refs, ...columns } = outcome.set;
    const [updated] = await tx
      .update(replayPrescriptions)
      .set({
        ...columns,
        ...(refs ? { actionRef: encodeActionRef(refs) } : {}),
        decidedBy: columns.decidedBy ?? opts.actorId ?? row.decidedBy,
        updatedAt: now,
      })
      .where(and(eq(replayPrescriptions.id, row.id), eq(replayPrescriptions.status, row.status)))
      .returning();
    if (!updated) throw new ConflictError('This fix changed while you were acting on it; reload it');
    return { outcome, updated };
  });
  const { outcome, updated } = claimed;
  if (!updated) return { prescription: dto, ...outcome.result };

  await recordReplayTrace(env, db, {
    tenantId: scope.tenantId,
    siteId: scope.siteId,
    verb: def.verb,
    actorId: opts.actorId,
    metadata: { prescriptionId: row.id, ruleId: row.ruleId, ...(outcome.result ?? {}), followUp: undefined, prompt: undefined, selectors: undefined, targets: undefined },
  });
  await bumpSiteVersion(env, scope.siteId);
  return { prescription: toPrescriptionDto(updated, 0, context), ...outcome.result };
}
