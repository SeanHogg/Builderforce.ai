/**
 * Learned Model Routing (PRD 13) — the action-type CLASSIFIER.
 *
 * Labels a task with one {@link ActionType}. Run ONCE per task and cached on
 * `tasks.action_type` (the column IS the cache), so every re-run of the same ticket
 * reuses the label.
 *
 * Two passes, cheapest first:
 *   1. The LEXICAL classifier every host shares (`@builderforce/workload`). A verdict
 *      at or above its confidence floor is the answer — no model call at all.
 *   2. Only an ambiguous ticket asks the free pool (`ideProxy`, spends nothing on paid
 *      vendors) with a strict `json_schema` response_format to keep the output a
 *      clean enum.
 *
 * Best-effort by contract: ANY failure (gateway error, garbage output, kill switch)
 * resolves to 'other' and NEVER blocks or fails the run. The caller persists the
 * verdict; this module only computes it.
 *
 * DEFERRED (PRD D6, lever `d6_batch_api`): when the caller hands a `deferral` (the task
 * row it will cache the verdict on), the LLM pass is queued on a provider batch instead
 * of awaited. The LEXICAL verdict is the immediate answer the run routes on and caches;
 * {@link taskActionTypeBatchHandler} overwrites `tasks.action_type` when the batch
 * settles, so every later run of the ticket routes on the model's label.
 *
 * SPECIALIST (lever `e2_specialists`): when a cheap model is admitted for
 * `task_action_type`, the synchronous pass hints it; while none is admitted, a sampled
 * share of answered requests becomes the job's eval set.
 */

import { eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { extractJsonPayload } from '../../domain/shared/json';
import { ACTION_TYPES, type ActionType, normalizeActionType, learnedRoutingEnabled } from '@builderforce/learned-routing';
import { classifyRunAction, MIN_CONFIDENCE } from '@builderforce/workload';
import { completeJson, jsonSchemaFormat } from './completeJson';
import { deriveAllocationCategory } from './allocationCategories';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { deferLlmCall } from './batch/deferLlmCall';
import type { BatchCallbackHandler } from './batch/batchCallbacks';
import type { DeferredLlmRequest } from './batch/batchTypes';
import { resolveSpecialist } from './specialists/resolveSpecialist';
import { captureSpecialistSample, type SpecialistRequest } from './specialists/evalCaseStore';

export interface TaskClassification {
  actionType: ActionType;
  confidence: number;
}

const SYSTEM_PROMPT =
  'You are a precise software-task classifier. Given a coding ticket, return the SINGLE action type that best ' +
  'describes the primary work. Choose exactly one of: ' +
  ACTION_TYPES.join(', ') +
  '. Guidance: `sql` = database queries/schema/migrations-as-SQL; `frontend_ui` = UI components, styling, client pages; ' +
  '`backend_api` = server routes, services, API endpoints; `refactor` = restructuring without behaviour change; ' +
  '`bugfix` = fixing a defect; `tests` = adding/fixing tests; `docs` = documentation; `devops_ci` = CI/CD, build, deploy, infra config; ' +
  '`data_migration` = moving/backfilling data; `analysis` = research or assessment whose output is findings; ' +
  '`provisioning` = creating/configuring an external resource whose state is the deliverable; `decision` = an explicit approval or written decision; ' +
  '`other` = none of the above. Classify the DELIVERABLE, not the subject: a ticket to write a PRD, spec, design doc, RFC ' +
  'or research write-up is `analysis` (or `docs`) even when the system it describes is an API or a UI. Respond with JSON only.';

/** The strict JSON-schema the gateway enforces — a closed enum + a 0..1 confidence. */
const RESPONSE_SCHEMA = jsonSchemaFormat('task_action_type', {
  type: 'object',
  additionalProperties: false,
  required: ['action_type', 'confidence'],
  properties: {
    action_type: { type: 'string', enum: [...ACTION_TYPES] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
});

function coerceConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

const MAX_TOKENS = 256;

function userPromptFor(task: { title: string; description?: string | null }): string {
  return (
    `Title: ${task.title}\n` +
    (task.description ? `Description: ${task.description.slice(0, 4000)}\n` : '') +
    `\nClassify this ticket's primary action type.`
  );
}

/** The classifier's model output → a verdict. One reading for the sync and batch paths. */
export function classificationFrom(value: unknown): TaskClassification {
  const obj = value as { action_type?: unknown; confidence?: unknown } | null;
  return {
    actionType: normalizeActionType(obj?.action_type),
    confidence: coerceConfidence(obj?.confidence),
  };
}

/** The same request the synchronous pass sends, in the queue's vendor-neutral shape. */
export function classificationBatchRequest(task: { title: string; description?: string | null }): DeferredLlmRequest {
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPromptFor(task) },
    ],
    maxTokens: MAX_TOKENS,
    temperature: 0,
    responseFormat: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
  };
}

/** Who the classification is for — gates the specialist lever and scopes its eval sample. */
export interface ClassificationScope {
  tenantId?: number | null;
}

/** The task row the caller caches the verdict on — what a deferred pass needs to land. */
export interface ClassificationDeferral extends ClassificationScope {
  db: Db;
  tenantId: number;
  taskId: number;
}

function isDeferral(scope: ClassificationScope | undefined): scope is ClassificationDeferral {
  return !!scope && 'db' in scope && 'taskId' in scope;
}

/** The synchronous pass in the eval-case shape the specialist sweep replays. */
function classificationSampleRequest(task: { title: string; description?: string | null }): SpecialistRequest {
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPromptFor(task) },
    ],
    max_tokens: MAX_TOKENS,
    response_format: RESPONSE_SCHEMA,
  };
}

/**
 * Classify a task into an {@link ActionType}. Returns `{ actionType: 'other',
 * confidence: 0 }` on the kill switch or any failure — never throws.
 */
export async function classifyTaskAction(
  env: Env,
  task: { title: string; description?: string | null },
  scope?: ClassificationScope | ClassificationDeferral,
): Promise<TaskClassification> {
  if (!learnedRoutingEnabled(env)) return { actionType: 'other', confidence: 0 };

  // The title is the instruction; the description is context the classifier discounts.
  const lexical = classifyRunAction([task.title, task.description ?? ''].join('\n\n'));
  if (lexical.actionType !== 'other' && lexical.confidence >= MIN_CONFIDENCE) return lexical;

  // Nobody waits for the model's label: the lexical verdict answers now, the batch later.
  const deferral = isDeferral(scope) ? scope : undefined;
  const tenantId = scope?.tenantId ?? null;
  if (deferral) {
    const queued = await deferLlmCall(env, deferral.db, {
      tenantId: deferral.tenantId,
      taskId: deferral.taskId,
      kind: 'task_action_type',
      request: classificationBatchRequest(task),
      payload: { taskId: deferral.taskId },
    });
    if (queued.deferred) return lexical;
  }

  try {
    const specialist = await resolveSpecialist(env, tenantId, 'task_action_type');
    const out = await completeJson(
      { kind: 'ide', env },
      {
        ...(specialist ? { model: specialist.model } : {}),
        system: SYSTEM_PROMPT,
        user: userPromptFor(task),
        schema: RESPONSE_SCHEMA,
        temperature: 0,
        maxTokens: MAX_TOKENS,
        useCase: 'task_classification',
      },
    );
    if (!out.ok) return { actionType: 'other', confidence: 0 };
    if (!specialist) {
      void captureSpecialistSample(env, { jobId: 'task_action_type', tenantId, request: classificationSampleRequest(task) });
    }
    return classificationFrom(out.value);
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/classifyTask.ts', operation: 'classifyTaskAction', level: 'warning' });
    return { actionType: 'other', confidence: 0 };
  }
}

/**
 * Settles a deferred classification: the write the synchronous caller does after
 * {@link classifyTaskAction} (label + confidence + the co-derived allocation category),
 * over the lexical verdict cached at run start. A manual allocation is never replaced.
 */
export const taskActionTypeBatchHandler: BatchCallbackHandler = {
  async settle({ db }, job, completion) {
    const taskId = Number(job.callbackPayload.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('task_action_type job has no taskId');
    const parsed = extractJsonPayload(completion.content);
    if (parsed === null) throw new Error('classifier batch answer was not JSON');
    const verdict = classificationFrom(parsed);
    const [row] = await db
      .select({ title: tasks.title, description: tasks.description })
      .from(tasks)
      .where(scopedToTenant(tasks, job.tenantId, eq(tasks.id, taskId)))
      .limit(1);
    if (!row) return; // the task was deleted while the batch ran — nothing to label
    const allocationCategory = deriveAllocationCategory({ actionType: verdict.actionType, title: row.title, description: row.description });
    await db.update(tasks)
      .set({
        actionType: verdict.actionType,
        actionTypeConfidence: verdict.confidence,
        allocationCategory: sql`CASE WHEN ${tasks.allocationCategorySource} = 'derived' THEN ${allocationCategory} ELSE ${tasks.allocationCategory} END`,
      })
      .where(scopedToTenant(tasks, job.tenantId, eq(tasks.id, taskId)));
  },
};
