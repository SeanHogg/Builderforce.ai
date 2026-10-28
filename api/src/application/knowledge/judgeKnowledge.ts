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
import { JSON_OBJECT_FORMAT, completeJson } from '../llm/completeJson';

export const KNOWLEDGE_JUDGE_USE_CASE = 'knowledge_judge';
/** Items one judge request may carry (the review sends one per call). */
export const MAX_JUDGE_ITEMS = 8;
const MAX_TOKENS = 1_200;

export interface JudgeDeps {
  env: Env;
  tenantId: number;
  projectId: number;
  userId: string | null;
}

export function judgeKnowledge(deps: JudgeDeps, req: Pick<JudgementRequest, 'kind' | 'items'>): Promise<JudgementResult> {
  const ask = async (system: string, payload: unknown): Promise<unknown> => {
    const out = await completeJson(
      {
        kind: 'tenant', env: deps.env, tenantId: deps.tenantId,
        opts: { meterUseCase: KNOWLEDGE_JUDGE_USE_CASE, userId: deps.userId, projectId: deps.projectId },
      },
      { system, user: JSON.stringify(payload), schema: JSON_OBJECT_FORMAT, temperature: 0, maxTokens: MAX_TOKENS, useCase: KNOWLEDGE_JUDGE_USE_CASE },
    );
    return out.ok ? out.value : undefined;
  };
  return judgeWith(ask, req);
}
