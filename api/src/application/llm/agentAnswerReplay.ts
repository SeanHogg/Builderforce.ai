/**
 * Agent answer replay (PRD B4) — lets an agent's own sub-question ("what does
 * `resolveMembership` return?") be answered from the project's memory-first Q&A cache
 * instead of a fresh model call.
 *
 * A thin use case over `resolveMemoryAnswer` — the ONE memory-first decision the Brain's
 * first turn already uses — so every rule that makes a replay safe applies unchanged:
 *   • the `qa:v3` key carries the principal scope, so an answer produced for one person
 *     or host is never replayed to another;
 *   • work orders, status questions and bare continuations are never replayable
 *     (`memoryReplayable`), so "fix the box height" is never answered with old prose;
 *   • a cached answer about a file that has since changed is stale and dropped.
 *
 * Only the exact-repeat cache answers here. The Evermind leg is barred by passing
 * `toolsAvailable: true`: an agent run has tools, and an SSM that cannot call one must
 * not pre-empt a question whose answer lives behind a tool call.
 *
 * The `b4_agent_answer_replay` lever is checked by the CALLER (the loop that asks); this
 * function only answers. Never throws — a miss or any failure is `null`.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveMemoryAnswer } from './projectMemory';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export interface AgentReplayQuestion {
  tenantId: number;
  projectId: number | null;
  /** Who the run acts for — the replay is scoped to exactly this principal. */
  principal: {
    userId?: number | null;
    agentHostId?: string | null;
    /** The permission role the run acts under. Optional, but the key embeds it: an
     *  answer cached by the Brain route under `admin` replays only to `admin`. */
    role?: string | null;
  };
  question: string;
}

export interface AgentReplayAnswer {
  answer: string;
  source: 'memory';
}

/** Answer an agent sub-question from the project's Q&A cache, or `null` when not replayable. */
export async function replayAgentAnswer(env: unknown, db: unknown, q: AgentReplayQuestion): Promise<AgentReplayAnswer | null> {
  const question = (q.question ?? '').trim();
  const projectId = q.projectId;
  if (!question || projectId == null || !Number.isInteger(projectId) || projectId <= 0) return null;
  try {
    const hit = await resolveMemoryAnswer(env as Env, db as Db, q.tenantId, projectId, question, {
      toolsAvailable: true,
      principal: {
        userId: q.principal.userId != null ? String(q.principal.userId) : null,
        agentHostId: q.principal.agentHostId ?? null,
        role: q.principal.role ?? null,
      },
    });
    // Belt and braces: only a replay of an answer a real model produced counts here.
    if (!hit || hit.source !== 'qa-cache' || !hit.text.trim()) return null;
    return { answer: hit.text, source: 'memory' };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/llm/agentAnswerReplay.ts',
      operation: 'replayAgentAnswer',
      level: 'warning',
      context: { tenantId: q.tenantId, projectId },
    });
    return null;
  }
}
