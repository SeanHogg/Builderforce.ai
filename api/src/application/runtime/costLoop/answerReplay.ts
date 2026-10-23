/**
 * B4 — agent answer replay on the cloud run's memory recall (lever
 * `b4_agent_answer_replay`).
 *
 * `memory_recall` is the cloud agent's "what do we already know about X?" — the factual
 * question about the project it asks before re-reading files. The Brain may well have
 * answered that question already: its project Q&A cache holds grounded answers, scoped
 * to the tenant, the project and the principal. So a recall first asks
 * `replayAgentAnswer`; on a hit the run gets that answer as the tool result, marked
 * `replayed`, without the recall round trip (and without the model re-deriving it from
 * source). On a miss — or with the lever off — the recall runs exactly as before.
 *
 * The principal is the run's: its agent and the permission role every cloud run acts
 * under (`CLOUD_RUN_TENANT_ROLE`) — the `qa:v3` key embeds the role, so only an answer
 * cached under that same principal replays. There is no cache WRITE here: a recall's
 * result is stored facts, not a model-produced answer to the question, so caching it
 * under the Q&A key would replay non-answers. Answers enter the cache where a model
 * answers a question (`cacheProjectAnswer`'s callers).
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { MemoryCapability, MemoryRecallResult } from '@builderforce/agent-tools';
import { replayAgentAnswer } from '../../llm/agentAnswerReplay';
import { CLOUD_RUN_TENANT_ROLE } from '../cloudAgentTools';

export interface AnswerReplayScope {
  env: unknown;
  db: unknown;
  tenantId: number;
  projectId: number | null;
  /** The cloud agent the run acts as — the replay is scoped to exactly this principal. */
  agentRef?: string | null;
}

/** The memory capability with replay in front of `recall`; the capability itself while the lever is off. */
export function withAnswerReplay(memory: MemoryCapability, scope: AnswerReplayScope): MemoryCapability {
  if (!isCostLeverOn(scope.env, 'b4_agent_answer_replay', scope.tenantId)) return memory;
  return {
    ...memory,
    async recall(query: string, limit?: number): Promise<MemoryRecallResult> {
      const hit = await replayAgentAnswer(scope.env, scope.db, {
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        principal: { agentHostId: scope.agentRef ?? null, userId: null, role: CLOUD_RUN_TENANT_ROLE },
        question: query,
      });
      if (!hit) return memory.recall(query, limit);
      const replayed: MemoryRecallResult & { replayed: true; source: string; note: string } = {
        ok: true,
        query,
        entries: [{ key: 'replayed-answer', content: hit.answer, origin: `replay:${hit.source}` }],
        replayed: true,
        source: hit.source,
        note: 'Replayed from the project\'s answered-question memory (a grounded answer to this exact question). Use it; recall again with a narrower query if it does not cover what you need.',
      };
      return replayed;
    },
  };
}
