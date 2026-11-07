/**
 * judgeKnowledge — the JudgementPort for browser hosts and on-prem (PRD 38 §4.8
 * `POST …/knowledge/judge`).
 *
 * The prompts, the per-item text cap, the loop and the validation are agent-tools'
 * `judgeWith` — the ONE judgement core every host runs (VS Code's local engines wrap it as
 * `completionJudgement`). This use case supplies only the `ask`: each question is ONE routed
 * model call through `completeJson` → `completeForTenant` — the tenant's connected account
 * and the gateway's cascade, metered in the usage ledger under
 * {@link KNOWLEDGE_JUDGE_USE_CASE} with the user and project, so spend and savings are
 * attributed exactly as for any call. No model is pinned: the gateway routes the use case
 * (its cheap tier for a short structured reply). A failed call answers `undefined`, which
 * the core's validators count as invalid — never stored.
 */
import type { JudgementRequest, JudgementResult } from '@seanhogg/builderforce-memory/knowledge';
import { judgeWith } from '@builderforce/agent-tools';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { JSON_OBJECT_FORMAT, completeJson, type CompleteJsonRequest } from '../llm/completeJson';
import { CLIENT_JSON_MAX_CHARS, type ClientSupplied } from '../llm/clientResult';
import { recordClientResultUsage } from '../llm/clientResultUsage';

export const KNOWLEDGE_JUDGE_USE_CASE = 'knowledge_judge';
/** Items one judge request may carry (the review sends one per call). */
export const MAX_JUDGE_ITEMS = 8;
const MAX_TOKENS = 1_200;

export interface JudgeDeps {
  env: Env;
  tenantId: number;
  projectId: number;
  userId: string | null;
  /** The usage ledger's database handle — only needed to record an accepted client result. */
  db?: Db;
}

/** The ONE request a judgement question is asked as — sent by {@link judgeKnowledge} and
 *  routed (never sent) by the review's cost estimate, so both read the same shape. */
export function judgeRequest(system: string, payload: unknown): CompleteJsonRequest {
  return { system, user: JSON.stringify(payload), schema: JSON_OBJECT_FORMAT, temperature: 0, maxTokens: MAX_TOKENS, useCase: KNOWLEDGE_JUDGE_USE_CASE };
}

/**
 * The `clientResult.json` of a judge request (PRD 42 Part D): the model's REPLY shape the
 * shared prompts ask for — `{ extract: [...] }` for an extract request, `{ compare: [...] }`
 * for a compare — covering every item. This only checks the envelope; the entries are then
 * validated by the SAME `validateExtract` / `validateCompare` the server's own model output
 * goes through (inside `judgeWith`), so a bad entry is counted `invalid`, never stored.
 */
export function clientJudgementSpec(kind: JudgementRequest['kind']): { kind: 'json'; validate: (v: unknown) => v is Record<string, unknown> } {
  const key = kind === 'compare' ? 'compare' : 'extract';
  return {
    kind: 'json',
    validate: (v): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v) && Array.isArray((v as Record<string, unknown>)[key])
      // The body-size gate trusts Content-Length; the parsed value's own size is the real cap.
      && JSON.stringify(v).length <= CLIENT_JSON_MAX_CHARS,
  };
}

export async function judgeKnowledge(
  deps: JudgeDeps,
  req: Pick<JudgementRequest, 'kind' | 'items'>,
  client?: ClientSupplied<Record<string, unknown>>,
): Promise<JudgementResult> {
  if (client) {
    // The device already answered: judge its reply with the shared validators, no model call.
    // An extract reply covers every item; each `judgeWith` question is handed only ITS entries,
    // exactly as a per-item model reply would be (a stray ref elsewhere is not this item's problem).
    // An item the device did not answer is counted invalid, like a failed server call.
    const result = await judgeWith(async (_system, payload) => {
      if (req.kind === 'compare') return { compare: client.value.compare };
      const mine = (client.value.extract as unknown[]).filter((e) => (e as { ref?: unknown } | null)?.ref === (payload as { ref: unknown }).ref);
      return mine.length > 0 ? { extract: mine } : undefined;
    }, req);
    if (deps.db) {
      await recordClientResultUsage(deps.db, deps.env, { tenantId: deps.tenantId, userId: deps.userId, projectId: deps.projectId, useCase: KNOWLEDGE_JUDGE_USE_CASE, provenance: client.provenance });
    }
    return result;
  }
  const ask = async (system: string, payload: unknown): Promise<unknown> => {
    const out = await completeJson(
      {
        kind: 'tenant', env: deps.env, tenantId: deps.tenantId,
        opts: { meterUseCase: KNOWLEDGE_JUDGE_USE_CASE, userId: deps.userId, projectId: deps.projectId },
      },
      judgeRequest(system, payload),
    );
    return out.ok ? out.value : undefined;
  };
  return judgeWith(ask, req);
}
