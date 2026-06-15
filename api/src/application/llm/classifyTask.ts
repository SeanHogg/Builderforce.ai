/**
 * Learned Model Routing (PRD 13) — the action-type CLASSIFIER.
 *
 * A first-pass FREE-model call that labels a task with one {@link ActionType}. Run
 * ONCE per task and cached on `tasks.action_type` (the column IS the cache), so
 * every re-run of the same ticket reuses the label — the cost amortizes to ~nothing.
 * Uses the free pool (`ideProxy`), so it spends nothing on paid vendors, and a
 * strict `json_schema` response_format to keep the output a clean enum.
 *
 * Best-effort by contract: ANY failure (gateway error, garbage output, kill switch)
 * resolves to 'other' and NEVER blocks or fails the run. The caller persists the
 * verdict; this module only computes it.
 */

import type { Env } from '../../env';
import { ACTION_TYPES, type ActionType, normalizeActionType, learnedRoutingEnabled } from './actionTypes';
import { ideProxy } from './LlmProxyService';

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
  '`data_migration` = moving/backfilling data; `other` = none of the above. Respond with JSON only.';

/** The strict JSON-schema the gateway enforces — a closed enum + a 0..1 confidence. */
const RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'task_action_type',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['action_type', 'confidence'],
      properties: {
        action_type: { type: 'string', enum: [...ACTION_TYPES] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

function coerceConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Classify a task into an {@link ActionType}. Returns `{ actionType: 'other',
 * confidence: 0 }` on the kill switch or any failure — never throws.
 */
export async function classifyTaskAction(
  env: Env,
  task: { title: string; description?: string | null },
): Promise<TaskClassification> {
  if (!learnedRoutingEnabled(env)) return { actionType: 'other', confidence: 0 };

  try {
    const userPrompt =
      `Title: ${task.title}\n` +
      (task.description ? `Description: ${task.description.slice(0, 4000)}\n` : '') +
      `\nClassify this ticket's primary action type.`;

    const result = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 256,
      response_format: RESPONSE_SCHEMA,
      useCase: 'task_classification',
    });

    if (result.response.status >= 400) return { actionType: 'other', confidence: 0 };
    const raw = (await result.response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown } }> }
      | null;
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { actionType: 'other', confidence: 0 };

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { actionType: 'other', confidence: 0 };
    }
    const obj = parsed as { action_type?: unknown; confidence?: unknown } | null;
    return {
      actionType: normalizeActionType(obj?.action_type),
      confidence: coerceConfidence(obj?.confidence),
    };
  } catch {
    return { actionType: 'other', confidence: 0 };
  }
}
